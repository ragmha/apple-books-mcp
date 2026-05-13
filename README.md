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

All list/search tools accept `limit` (default 50, max 100) and `offset`.

### Reads — collections

| Tool | Purpose |
|---|---|
| `list_collections` | All non-deleted collections |
| `list_collection_books` | Books in one collection |
| `get_collection` | Details of one collection by UUID or `Z_PK` |

### Reads — books

| Tool | Purpose |
|---|---|
| `list_books` | Books, paginated (use this) |
| `list_all_books` | Every book, no pagination (use sparingly — large libraries blow past LLM context) |
| `get_book` | One book by `ZASSETID` or `Z_PK` |
| `search_books` | Title / author / genre, case-insensitive partial match |

### Reads — annotations

| Tool | Purpose |
|---|---|
| `list_annotations` | Recent annotations across the whole library, paginated |
| `recent_annotations` | The 10 most recently modified annotations |
| `get_book_annotations` | All annotations for one book |
| `get_annotation` | One annotation by UUID or `Z_PK` |
| `get_highlights_by_color` | Highlights of one colour, paginated (`green`, `blue`, `yellow`, `pink`, `purple`) |
| `search_highlighted_text` | Search the highlighted-text field |
| `search_notes` | Search the user-written note field |
| `full_text_search` | Search highlight text, note, and representative text together |
| `export_annotations_markdown` | Render annotations as Markdown — pass an `asset_id` for one book, omit for the whole library |

### Writes

> Every write **snapshots the relevant database** (Library or Annotations),
> **verifies the snapshot's integrity**, **quits Books.app *before* the
> change**, runs in a `BEGIN IMMEDIATE` transaction with full Core Data
> discipline (`Z_OPT` bumped, mtimes refreshed, parent-collection mtime
> refreshed for iCloud sync), and **relaunches Books.app on success**. See
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
The five most recent backups per database are kept; older ones are pruned.

To roll back the **Library**, ask your MCP client to run `list_backups`
(returns `{handle, createdAt, sizeBytes}` newest-first), then call
`restore_backup` with the chosen `handle`. The restore runs the same
safety ceremony as a write: integrity-check the chosen backup → quit
Books.app → take a **fresh pre-restore safety snapshot of the current
Library** → swap the file → relaunch Books. The safety snapshot path is
returned in the result so you can roll forward again if needed.

To roll back **annotations**, the manual procedure below is currently the
only option (a parameterised `restore_backup` for the Annotations DB is on
the roadmap).

If you'd rather restore by hand:

1. **Quit Apple Books.**
2. In the `BKLibrary` (or `AEAnnotation`) directory, find the `.backup-*`
   file you want.
3. Copy it over the live `.sqlite` file (preserve the live filename — the
   suffix matters).
4. Delete the `.sqlite-wal` and `.sqlite-shm` siblings if they exist.
5. Reopen Apple Books.

## Troubleshooting

**"Apple Books schema validation failed; the codebase expects Core Data
tables/columns that are not present"** — this server has been tested
against macOS 14/15 Apple Books schemas. If you're on a newer macOS that
has changed the schema, please open an issue with your `sw_vers` output and
the error detail.

**"could not open the Apple Books library"** — Full Disk Access not
granted to the process running this server. See above.

**"database is locked" on a write** — Apple Books was open during a write
and our quit step couldn't reach it (or another process has the file open).
The mutation rolled back; try again with Books closed.

**Backup integrity check failed** — disk full or filesystem error during
the snapshot copy. Free space and retry; nothing on disk was modified.

**Tool returned `Operation failed.`** — the original error is on stderr.
This server deliberately sanitises tool responses because SQLite constraint
errors can include user PII (book titles, note text).

## Development

```bash
bun install
bun run check       # Biome format/lint/import organization
bun run typecheck   # tsc --noEmit
bun test            # 72 tests, in-memory SQLite + fake adapters
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
