# Context

Domain vocabulary used across the codebase. Use these terms exactly. Add new
terms here as the design crystallises — sharpen fuzzy ones in place.

## Apple Books storage

- **Library** — the writable `BKLibrary*.sqlite` Core Data store under
  `~/Library/Containers/com.apple.iBooksX/...`. Owns books, collections, and
  the join table between them.
- **Annotations DB** — the separate `AEAnnotation*.sqlite` Core Data store.
  Owns highlights, notes, and bookmarks. Joined to the Library by
  `ZASSETID` (string), not by `Z_PK`. Reads go through the same query
  path as the Library; writes (note edits, soft-deletes) go through a
  parallel `LibraryMutation` instance backed by the AEAnnotation file.
- **Asset / Book** — a book row in the Library (`ZBKLIBRARYASSET`). The
  natural identifier is `ZASSETID` (string); the internal one is `Z_PK`.
- **Collection** — a user-curated grouping of Assets (`ZBKCOLLECTION`).
  Natural identifier `ZCOLLECTIONID` (uppercased UUID); internal `Z_PK`.
- **Collection Member** — one row in the Library's join table
  (`Z_*COLLECTIONS`) tying an Asset to a Collection with a sort key.
- **Annotation** — a highlight, note, or bookmark (`ZAEANNOTATION`). Natural
  identifier `ZANNOTATIONUUID`; internal `Z_PK`. Soft-deleted by
  `ZANNOTATIONDELETED = 1`.

## Core Data conventions

Apple Books is a Core Data store, so every table follows Core Data's row
discipline. Forgetting any of these on a write produces silent corruption or
sync failure.

- **`Z_PK`** — the row's primary key.
- **`Z_ENT`** — the entity-type integer (one per table). Must match the value
  in `Z_PRIMARYKEY` for that entity.
- **`Z_OPT`** — optimistic-lock version. Starts at `1` on insert; **must be
  incremented on every UPDATE** or Core Data may reject the change or
  trigger merge conflicts on iCloud sync.
- **`Z_PRIMARYKEY`** — Core Data's PK-allocator table. To insert a row,
  bump `Z_MAX` for that entity and use the new value as `Z_PK`. Schema
  validation checks the expected collection/member entity mappings and
  rejects missing, ambiguous, exhausted, or lagging allocators.
- **Core Data epoch** — 2001-01-01 00:00:00 UTC. All `ZLOCALMODDATE` /
  `ZLASTMODIFICATION` / `ZANNOTATION*DATE` fields are seconds since this
  epoch (offset `978307200` from Unix epoch).

## Identifier shape

- **Apple Books identifier** — a string accepted at the tool boundary that is
  *either* the natural key (UUID for Collections / Annotations, `ZASSETID`
  for Assets) *or* the internal `Z_PK` rendered as decimal. Resolution to
  the internal `Z_PK` is one well-defined operation per entity. Look up the
  natural key first; only a missing natural key permits positive, whole-decimal,
  safe-integer PK fallback (leading zeros are allowed). Canonical UUIDs are
  compared case-insensitively for Collections / Annotations; Asset IDs stay
  case-sensitive. Resolve identity before checking deletion state, so a
  deleted natural key cannot redirect an operation to another row's PK.

## Architecture (this codebase)

```
                          ┌─────────────────────────────────┐
                          │  MCP client (Claude / Cursor /  │
                          │  Copilot) over stdio            │
                          └────────────────┬────────────────┘
                                           │ JSON-RPC
                          ┌────────────────▼────────────────┐
                          │  src/server.ts                  │
                          │  MCP tool handlers (24 tools)   │
                          └────────┬───────────────┬────────┘
                                   │ READ          │ WRITE
                                   ▼               ▼
                  ┌────────────────────────┐  ┌────────────────────────┐
                  │ src/db/books.ts        │  │ src/db/collections.ts  │
                  │ src/db/annotations.ts  │  │   addBookToCollectionTx│
                  │ src/db/collections.ts  │  │   removeBook…Tx        │
                  │   (read fns)           │  │   createCollectionTx   │
                  │                        │  │   deleteCollectionTx   │
                  │ via createDb(...)      │  │   (pure descriptions)  │
                  │ → Zod-validated rows   │  │ src/db/backups.ts      │
                  └────────────┬───────────┘  │   listLibraryBackups   │
                               │              │   restoreLibrary…      │
                               │              └────────────┬───────────┘
                               │                           │ describes change
                               │              ┌────────────▼───────────┐
                               │              │ src/db/library-        │
                               │              │   mutation.ts          │
                               │              │   ┌──────────────────┐ │
                               │              │   │ mutate(fn, opts) │ │
                               │              │   │ listBackups()    │ │
                               │              │   │ restore(handle)  │ │
                               │              │   └──────────────────┘ │
                               │              │   • snapshot           │
                               │              │   • verifySnapshot     │
                               │              │   • quit Books         │
                               │              │   • BEGIN IMMEDIATE    │
                               │              │   • run fn(LibraryTx)  │
                               │              │   • COMMIT / ROLLBACK  │
                               │              │   • launch Books       │
                               │              │   • MutationResult<T>  │
                               │              └────┬───────────────┬───┘
                               │                   │               │
                               │              ┌────▼────┐    ┌─────▼─────┐
                               │              │ Library │    │ BooksApp  │
                               │              │ Store   │    │ Port      │
                               │              │ (port)  │    │ (port)    │
                               │              └────┬────┘    └─────┬─────┘
                               │                   │               │
                ┌──────────────┴──────┐ ┌──────────┴──────┐ ┌──────┴──────────┐
                ▼                     ▼ ▼                 ▼ ▼                 ▼
        ┌──────────────┐    ┌─────────────────────┐ ┌─────────────────────────┐
        │ src/db/      │    │  PRODUCTION         │ │  TEST                   │
        │ connection.ts│    │  ───────────        │ │  ───────────            │
        │  read-only   │    │  filesystem-        │ │  FakeLibraryStore       │
        │  Database    │    │    LibraryStore     │ │   (in-memory SQLite,    │
        │  handles     │    │   (real .sqlite,    │ │    seeded fixture)      │
        │              │    │    SQLite snapshot, │ │                         │
        │              │    │    integrity-check, │ │  FakeBooksAppPort       │
        │              │    │    rotation)        │ │   (no-op, records       │
        │              │    │                     │ │    call order)          │
        │              │    │  osascript-         │ │                         │
        │              │    │    BooksAppPort     │ │                         │
        │              │    │   (osascript +      │ │                         │
        │              │    │    pgrep + open -a) │ │                         │
        └──────┬───────┘    └──────────┬──────────┘ └─────────────────────────┘
               │                       │
               ▼                       ▼
        ┌──────────────┐        ┌─────────────────────────────────┐
        │ AEAnnotation │        │ ~/Library/Containers/           │
        │ *.sqlite     │        │   com.apple.iBooksX/Data/       │
        │ (Annotations │        │   Documents/BKLibrary/          │
        │  DB —        │        │   BKLibrary*.sqlite (Library)   │
        │  read +      │        │   + .backup-<timestamp> files   │
        │  write)      │        │                                 │
        └──────────────┘        └─────────────────────────────────┘
```

**Reading the diagram.** Reads (left rail) go straight from MCP tools through
the read-only domain helpers to the real `.sqlite` files via
`connection.ts`. Writes (right rail) describe their change as a pure
`*Tx(tx, …)` function and hand it to **Library Mutation**, which owns the
entire safety ceremony behind a one-method seam. The two **ports** at the
bottom of the right rail (Library Store, Books App Control) are where
production and test diverge — production opens the real Apple Books files
and shells out to `osascript`; tests substitute fake application control and
use both in-memory adapters and the real filesystem store over disposable
SQLite fixtures. This covers byte-level snapshot/restore behavior as well as
call ordering without touching `~/Library/Containers/...` or the real Books.app.

## Architecture (this codebase) — terms

- **Library Mutation** — the deepened module that owns every write to the
  Library. Three entry points: `mutate(fn)` for transactional changes,
  `listBackups()` to enumerate previous snapshots, and `restore(handle)`
  to roll the Library back to one. Mutations and restores own their safety
  ceremony behind the seam: verified snapshots, stopped Books.app, guarded
  database work, and a structured result. Books is relaunched only after a
  successful commit or verified restore. Listing backups is read-only. The two
  production stores coordinate the shared Books.app lifecycle.
- **Library Tx** — the handle the caller receives inside a `mutate` callback.
  Exposes Core Data row helpers (`insert`, `update`, `softDelete`) that bake
  in `Z_PK` / `Z_ENT` / `Z_OPT` / mtime discipline, plus `query` / `run`
  for the rest. Callers never see `BEGIN` / `COMMIT` / `ROLLBACK`.
- **Mutation Error** — a thrown error inside a `mutate` callback that signals
  a *user-facing* problem ("Book not found") rather than a system failure.
  The mutation surfaces its message verbatim; system errors return a
  sanitised "Operation failed" with the backup path.
- **Library Store** — the seam over the Library's filesystem and lifecycle:
  locate the `.sqlite` file, create and validate a standalone SQLite snapshot,
  publish it without collisions, rotate unprotected backups, and hand out
  database handles. Library and Annotations use a shared injectable filesystem
  implementation so its behavior is exercised on temporary databases.
- **Restore Lease** — the exclusive SQLite connection held across a restore's
  safety snapshot, restoration, verification, and recovery. Cached handles are
  closed before acquiring it. The macOS `sqlite3` utility performs restoration
  through SQLite rather than a live-file swap; competing database users cause
  safe refusal, not forced WAL/shared-memory deletion. The selected backup and
  verified safety snapshot remain protected until recovery no longer needs them.
- **Books App Control** — the seam over the macOS Books application:
  `isRunning`, `quit`, `launch`. Production adapter: `osascript` /
  `pgrep` / `open -a Books`. Test adapter: no-op.
