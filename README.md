# Apple Books MCP Server

[![CI](https://github.com/ragmha/apple-books-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ragmha/apple-books-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun%20%E2%89%A5%201.0-black)](https://bun.sh)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](#requirements)

A Bun/TypeScript [Model Context Protocol](https://modelcontextprotocol.io)
server that lets an AI client (Claude Desktop, Cursor, Copilot CLI, …) read
and write your local Apple Books library, collections, and annotations.

> ⚠️ **Educational / personal use only.** This accesses Apple Books'
> internal Core Data SQLite databases under
> `~/Library/Containers/com.apple.iBooksX/`, which is not a supported Apple
> API. Schema can change between macOS releases. The server validates the
> schema at startup and refuses to run if it doesn't recognise it; even so,
> use at your own risk.

## Requirements

- **macOS** (the only platform that has Apple Books)
- **[Bun](https://bun.sh) ≥ 1.0** (this server is not Node-compatible)
- **Full Disk Access** for the process that will run this server (see below)
- **`/usr/bin/sqlite3`**, supplied by macOS, for SQLite-coordinated backup
  restoration

## Full Disk Access — read this first

macOS sandboxes `~/Library/Containers/`. Without Full Disk Access, the
server's first SQLite call will fail with `EACCES` and you'll see a startup
error. To grant it:

1. **System Settings → Privacy & Security → Full Disk Access**
2. Add the **terminal application** that will spawn the MCP server. Which
   one depends on your client:
   - Claude Desktop spawns its servers itself, so add **Claude.app**.
   - Cursor / VS Code spawn from the editor, so add **Cursor.app** or
     **Code.app**.
   - Copilot CLI runs from your shell, so add **Terminal.app** (or
     **iTerm.app**, etc.).
3. Restart the client. macOS does not pick up new permissions until the
   process restarts.

You'll know it worked when this server starts without printing
`could not open the Apple Books library`.

## Install

```bash
bun add -g @ragmha/apple-books-mcp        # if/when published to npm
# or run directly from a clone:
git clone https://github.com/ragmha/apple-books-mcp.git
cd apple-books-mcp && bun install
```

The `bin` entry points at the TypeScript source — Bun executes `.ts` files
directly, so no build step is needed. **Node and `npx` will not work**;
`bunx` (or pointing `command` at `bun`) is required.

## MCP client setup

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apple-books": {
      "command": "bunx",
      "args": ["@ragmha/apple-books-mcp"]
    }
  }
}
```

Or for a local clone:

```json
{
  "mcpServers": {
    "apple-books": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/apple-books-mcp/src/index.ts"]
    }
  }
}
```

### Cursor / VS Code (with MCP support)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "apple-books": {
      "command": "bunx",
      "args": ["@ragmha/apple-books-mcp"]
    }
  }
}
```

### Copilot CLI

```bash
copilot mcp add apple-books bunx @ragmha/apple-books-mcp
```

## Demo

The repository includes a scripted Remotion demo that uses sanitized sample
books, highlights, and notes. It shows the read flow (`list_books`,
`search_highlighted_text`, `export_annotations_markdown`) and the write flow
(`create_collection`, collection membership changes, annotation updates/deletes,
backups, and restore) without touching a real Apple Books library.

```bash
bun run demo:preview  # open Remotion studio
bun run demo:render   # render demo/out/apple-books-mcp-demo.mp4
```

See [`demo/`](./demo/) for the source, transcript, and client-agnostic prompts.
Generated videos are ignored by git and are not included in the npm package.

## Tools

Paginated list/search tools accept `limit` (default 50, max 100) and `offset`
(default 0). `list_collections`, `list_collection_books`, `search_books`,
`search_highlighted_text`, `search_notes`, and `full_text_search` return arrays;
request the next offset until a page is shorter than the requested limit.
`list_books`, `list_annotations`, and `get_highlights_by_color` include
`total`, `limit`, and `offset` with their results.

`list_all_books`, `get_book_annotations`, and `export_annotations_markdown`
intentionally return all matching records. `recent_annotations` returns the
10 most recent annotations, and `list_backups` lists the retained snapshots.

Identifiers resolve by natural key first, then by a positive decimal `Z_PK`
within JavaScript's safe integer range. Leading zeros are accepted for PK
fallback; a numeric natural key still takes precedence. Collection and
annotation UUIDs are case-insensitive, but book asset IDs remain
case-sensitive. Strings such as `14-missing` never fall back to PK `14`.
Soft-deleted collections and annotations are excluded from normal reads and
cannot be edited or used as collection-membership targets.

### Reads — collections

| Tool | Purpose |
|---|---|
| `list_collections` | Non-deleted collections, paginated |
| `list_collection_books` | Books in one active collection, paginated |
| `get_collection` | Details of one collection by UUID or `Z_PK` |

### Reads — books

| Tool | Purpose |
|---|---|
| `list_books` | Books, paginated (use this) |
| `list_all_books` | Every book, no pagination (use sparingly — large libraries blow past LLM context) |
| `get_book` | One book by `ZASSETID` or `Z_PK` |
| `search_books` | Title / author / genre, case-insensitive partial match, paginated |

### Reads — annotations

| Tool | Purpose |
|---|---|
| `list_annotations` | Recent annotations across the whole library, paginated |
| `recent_annotations` | The 10 most recently modified annotations |
| `get_book_annotations` | All annotations for one book |
| `get_annotation` | One annotation by UUID or `Z_PK` |
| `get_highlights_by_color` | Highlights of one colour, paginated (`green`, `blue`, `yellow`, `pink`, `purple`) |
| `search_highlighted_text` | Search the highlighted-text field, paginated |
| `search_notes` | Search the user-written note field, paginated |
| `full_text_search` | Search highlight text, note, and representative text together, paginated |
| `export_annotations_markdown` | Render annotations as Markdown — pass an `asset_id` for one book, omit for the whole library |

### Writes

> Every write **snapshots the relevant database** (Library or Annotations),
> **verifies the snapshot's integrity**, **quits Books.app *before* the
> change**, and **relaunches Books.app on success**. Data edits use a
> `BEGIN IMMEDIATE` transaction with full Core Data discipline (`Z_OPT`
> bumped, mtimes refreshed, parent-collection mtime refreshed for iCloud
> sync). Restores use an exclusively locked SQLite connection rather than
> replacing a live file or deleting its WAL files. See
> [`CONTEXT.md`](./CONTEXT.md) for the architecture.

| Tool | Purpose |
|---|---|
| `add_book_to_collection` | Add an existing book to a collection |
| `remove_book_from_collection` | Remove a book from a collection |
| `create_collection` | Returns the new `collectionId` (UUID) |
| `delete_collection` | Soft delete (`ZDELETEDFLAG = 1`) |
| `update_annotation_note` | Rewrite the note text on a highlight |
| `delete_annotation` | Soft-delete an annotation (`ZANNOTATIONDELETED = 1`) |
| `list_backups` | Enumerate previously-taken Library snapshots, newest first |
| `restore_backup` | Roll the Library back to a chosen snapshot (with the same safety ceremony as a write) |

## Backups & restore

Every write produces a snapshot file alongside the database it touched:
Library writes snapshot
`~/Library/Containers/com.apple.iBooksX/Data/Documents/BKLibrary/BKLibrary*.sqlite`
to a `BKLibrary*.sqlite.backup-<timestamp>` sibling; annotation writes do
the equivalent in
`~/Library/Containers/com.apple.iBooksX/Data/Documents/AEAnnotation/`.
Snapshots are consistent, standalone SQLite files, including committed data
that was still in the live database's WAL. Published backups are not opened
for writing. Backup names are collision-safe, and existing timestamp-named
handles remain supported.

Normally the five most recent backups per database are kept. Restoring the
oldest backup can temporarily leave six snapshots; the next ordinary
successful snapshot resumes normal rotation. Failed restores protect the
selected backup and safety snapshot from later pruning in the current server
instance. Save any reported recovery files elsewhere before restarting the
server or making further manual changes.

To roll back the **Library**, ask your MCP client to run `list_backups`
(returns `{handle, createdAt, sizeBytes}` newest-first), then call
`restore_backup` with the chosen `handle`. The restore runs the same
safety ceremony as a write: validate the chosen backup → quit Books.app →
close cached connections and acquire an exclusive SQLite restore lock →
take and verify a **fresh pre-restore safety snapshot of the current
Library** → restore through SQLite and verify the result → release the lock
and relaunch Books. The safety snapshot path is returned in the result so
you can roll forward again if needed. If another reader or writer prevents
safe lock acquisition, restore refuses rather than forcing a file replacement.

To roll back **annotations**, the manual procedure below is currently the
only option (a parameterised `restore_backup` for the Annotations DB is on
the roadmap).

If you'd rather restore by hand, stop this MCP server and all other database
users first; quitting Books.app alone does not close the server's cached
connections. Prefer the guarded `restore_backup` tool for Library recovery.
Preserve a verified SQLite backup of the current state before replacing it;
a plain copy of a database with outstanding WAL data is not sufficient.

1. **Quit Apple Books and stop the MCP server.**
2. In the `BKLibrary` (or `AEAnnotation`) directory, find the `.backup-*`
   file you want.
3. Copy it over the live `.sqlite` file (preserve the live filename — the
   suffix matters).
4. Delete the `.sqlite-wal` and `.sqlite-shm` siblings if they exist.
5. Reopen Apple Books.

## Troubleshooting

**Schema validation failed** — this server has been tested
against macOS 14/15 Apple Books schemas. If you're on a newer macOS that
has changed the schema, please open an issue with your `sw_vers` output and
the error detail. Validation covers fields required by reads and writes,
including the collection-membership table and Core Data entity/allocator
metadata. Do not bypass a failed check or change the metadata to make it pass.

**"could not open the Apple Books library"** — Full Disk Access not
granted to the process running this server. See above.

**"database is locked" on a write** — Apple Books was open during a write
and our quit step couldn't reach it (or another process has the file open).
The mutation rolled back; try again with Books closed.

**Backup integrity check failed** — disk full or filesystem error during
snapshot creation, an incompatible database, or a damaged backup. The data
edit or restore is aborted before applying the requested change. Preserve
the reported recovery snapshot when investigating a restore failure.
If verification fails after a restore has been applied, the result explains
whether the previous state was recovered. Do not assume `success: false`
means that the database is unchanged.

**Restore could not acquire the database** — another connection still has a
read or write transaction open. Close other database clients and retry; do
not remove live WAL or shared-memory files to bypass the lock.

**Tool returned `Operation failed.`** — the original error is on stderr.
This server deliberately sanitises tool responses because SQLite constraint
errors can include user PII (book titles, note text).

## Development

```bash
bun install
bun run check       # Biome format/lint/import organization
bun run typecheck   # tsc --noEmit
bun test            # Synthetic SQLite fixtures and fake Books.app control
bun run dev         # watch-mode start
```

The architecture lives in [`CONTEXT.md`](./CONTEXT.md), including an ASCII
diagram of the read rail, write rail, and the production-vs-test fork at
the port adapters.

## Contributing

Pull requests welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md)
for the dev loop, commit style, and how the test fixtures work.

## Security

Found a security issue? Please **don't** open a public issue — see
[`SECURITY.md`](./SECURITY.md) for how to report privately.

## License

MIT — see [`LICENSE`](./LICENSE).

---

**Trademark notice.** "Apple", "Apple Books", and "iBooks" are trademarks
of Apple Inc., registered in the U.S. and other countries. This project is
an independent, unofficial tool and is **not affiliated with, endorsed by,
or sponsored by Apple Inc.** in any way.
