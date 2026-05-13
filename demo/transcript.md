# Demo transcript

## 1. Apple Books MCP, without risking private data

This demo uses fake books, fake highlights, and fake notes. The server itself is
for a real local Apple Books library on macOS, but the video is generated from a
sanitized script so contributors can review it safely.

## 2. Connect any MCP-capable client

Install with Bun, then point Claude Desktop, Cursor / VS Code, or Copilot CLI
at `@ragmha/apple-books-mcp`. The server validates the Apple Books schema at
startup and fails closed if Full Disk Access or the expected Core Data tables
are missing.

## 3. Read the library

Start with `list_books` to get paginated titles, authors, asset IDs, and
annotation counts. Search highlights with `search_highlighted_text`, then export
review notes with `export_annotations_markdown`.

## 4. Write with safety rails

Write tools can create collections, add and remove books, update annotation
notes, and soft-delete annotations. Each write snapshots the relevant database,
verifies the snapshot, quits Books.app, runs inside a transaction, updates Core
Data metadata, and relaunches Books only after a successful commit.

## 5. Recover from mistakes

Every Library write creates a rotated backup. `list_backups` shows the handles,
and `restore_backup` verifies the selected backup, quits Books, takes a fresh
pre-restore safety snapshot, swaps the file, and relaunches Books.

## 6. Adopt with confidence

The demo source is in the repository, while generated videos stay out of git and
out of the npm package. Review the prompts, render the video locally, then try
the server against your own Apple Books library when you are ready.
