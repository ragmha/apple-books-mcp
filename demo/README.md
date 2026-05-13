# Apple Books MCP demo

This directory contains a scripted Remotion demo for adoption and review. It
does not read your local Apple Books databases and does not use real book,
highlight, or note content.

## Preview

```bash
bun install
bun run demo:preview
```

The Remotion studio opens locally and renders from the sanitized scenario in
[`script.ts`](./script.ts).

## Render

```bash
bun run demo:render
```

The video is written to `demo/out/apple-books-mcp-demo.mp4`. Rendered videos
are ignored by git and are intentionally not included in the npm package.

## What the demo covers

- Connecting an MCP client to `@ragmha/apple-books-mcp`.
- Read tools: `list_books`, `search_highlighted_text`, and
  `export_annotations_markdown`.
- Write tools: `create_collection`, `add_book_to_collection`,
  `remove_book_from_collection`, `update_annotation_note`, and
  `delete_annotation`.
- Recovery tools: `list_backups` and `restore_backup`.
- The write safety ceremony: snapshot, integrity check, quit Books, transaction,
  Core Data metadata update, and relaunch after commit.

Use [`prompts.md`](./prompts.md) to replay the same walkthrough in Claude
Desktop, Cursor / VS Code, Copilot CLI, or another MCP-capable client.
