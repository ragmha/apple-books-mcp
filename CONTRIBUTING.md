# Contributing

Thanks for helping improve `apple-books-mcp`.

This project touches local Apple Books data, so changes should be small,
tested, and explicit about safety behavior.

## Local setup

```bash
bun install
bun run check
bun run typecheck
bun test
```

The test suite uses in-memory SQLite fixtures and fake Books.app adapters.
It should not touch your real Apple Books library.

## Development loop

1. Add or update tests first for behavior changes.
2. Keep writes behind `LibraryMutation` or a sibling mutation seam.
3. Run `bun run check && bun run typecheck && bun test` before opening a PR.
4. Update `README.md` and `CONTEXT.md` when changing the public MCP surface
   or architecture.

## Safety rules

- Do not write directly to Apple Books SQLite files outside a mutation seam.
- Every write must snapshot, verify the snapshot, quit Books.app before the
  write, run inside `BEGIN IMMEDIATE`, and relaunch only after commit.
- Never surface raw system errors to MCP callers. SQLite errors may include
  book titles, highlighted text, or notes.
- Bind user input as SQL parameters. Validate identifier positions with the
  existing query-builder helpers.
- Prefer soft deletes where Apple Books uses soft-delete columns.

## Commit style

Use short conventional-style summaries:

- `feat: add ...`
- `fix: prevent ...`
- `docs: clarify ...`
- `test: cover ...`
- `refactor: consolidate ...`

## Pull requests

PRs should explain:

- What changed.
- Why it is safe for user data.
- What tests were added or updated.
- Whether docs changed.
