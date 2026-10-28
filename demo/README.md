# Apple Books MCP demo

This directory contains a scripted Remotion demo for adoption and review. It
does not read your local Apple Books databases and does not use real book,
highlight, or note content.

## Executable POC

Start here to evaluate actual tool behavior rather than the scripted video.
From the repository root:

```bash
bun install --frozen-lockfile
bun test test/mcp-protocol.test.ts --test-name-pattern "Synthetic POC"
```

Expected: three passing tests, using only invented fixture content. The read
case lists `Fixture book 1`, searches for `Fixture highlight`, and exports
`book-1` as Markdown containing `Fixture highlight 1` and `Fixture note 1`.
An unrelated synthetic highlight must not appear in that scoped export.

Observed validation on 2026-10-28: the command above passed all three cases
with zero failures on Windows using Bun 1.4.0-canary.1 (`827475e21`, x64).
This is synthetic execution evidence, not live macOS compatibility evidence.

| Case | Expected behavior | Evidence |
|---|---|---|
| Read workflow | One book, matching highlight, scoped Markdown export | `Synthetic POC` in `test/mcp-protocol.test.ts`; `test/helpers/seed.ts` |
| Unsupported request | `upload_library` is not advertised, returns `isError`, dispatches no domain handler; subsequent read works | `Synthetic POC` in `test/mcp-protocol.test.ts` |
| Permission boundary | Injected `EACCES` returns `isError` and sanitized `Operation failed.`; no retry; detail goes only to stderr; session stays usable | `Synthetic POC` in `test/mcp-protocol.test.ts` |
| Tool failure and invalid input | Returned domain failure retains its payload and sets `isError`; missing/invalid parameters never reach handlers | `MCP protocol contracts` in `test/mcp-protocol.test.ts` |

Run the full protocol file for the last row:

```bash
bun test test/mcp-protocol.test.ts
```

Call path: SDK client → in-memory MCP transport → `createServer` in
`src/server.ts` → SDK/Zod input validation → `runTool` in `src/mcp-tool.ts` →
injected query handlers → production query/schema/export code → MCP JSON text
result. The live entry point instead validates local schemas and connects
stdio; the POC never calls `serve()`.

This evaluates deterministic tool contracts, not a model or autonomous agent.
The permission case injects a handler error; it does not exercise macOS Full
Disk Access or startup failure. Valid writes remain available in the server;
input validation is not user authorization. Mutation, backup and restore
regressions have separate tests under `test/`, not live Books.app proof.
No evaluation score establishes safety or correctness outside these cases.

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

## What the scripted video illustrates

- Connecting an MCP client to `@ragmha/apple-books-mcp`.
- Read tools: `list_books`, `search_highlighted_text`, and
  `export_annotations_markdown`.
- Write tools: `create_collection`, `add_book_to_collection`,
  `remove_book_from_collection`, `update_annotation_note`, and
  `delete_annotation`.
- Recovery tools: `list_backups` and `restore_backup`.
- The write safety ceremony: snapshot, integrity check, quit Books, transaction,
  Core Data metadata update, and relaunch after commit.

[`prompts.md`](./prompts.md) provides illustrative client prompts, not a
fixture-backed MCP server. Replaying them against a live server requires
your own matching records and permission to change that library; the video
does not create those records or execute the displayed calls.
