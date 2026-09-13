# Contributing

Thanks for helping improve `apple-books-mcp`.

This project touches local Apple Books data, so changes should be small,
tested, and explicit about safety behavior.

## Local setup

```bash
nvm use
bun install
bun run check
bun run typecheck
bun test
```

The `.nvmrc` pins the Node/npm publishing toolchain. Tests use in-memory
SQLite, disposable filesystem databases, and fake Books.app adapters.
They must not touch your real Apple Books library or control Books.app.
Storage regressions should exercise the production filesystem adapter against
temporary fixtures, not a copied implementation or only a call-recording fake.

## Development loop

1. Add or update tests first for behavior changes.
2. Keep writes behind `LibraryMutation` or a sibling mutation seam.
3. Run `bun run check && bun run typecheck && bun test` before opening a PR.
4. Update `README.md` and `CONTEXT.md` when changing the public MCP surface
   or architecture.

## Demo development

The Remotion demo under `demo/` is repository documentation, not package
payload. It must use sanitized fake data only; do not record or commit real
Apple Books libraries, book contents, highlights, notes, screenshots, or
database files.

```bash
bun run demo:preview
bun run demo:render
```

Rendered videos go to `demo/out/`, which is ignored by git and excluded from
the npm package.

## Safety rules

- Do not write directly to Apple Books SQLite files outside a mutation seam.
- Every data edit must snapshot, verify the snapshot, quit Books.app before
  the write, run inside `BEGIN IMMEDIATE`, and relaunch only after commit.
- Restores must hold an exclusive SQLite restore lease, preserve a verified
  safety snapshot, and verify the restored database before relaunching.
  Never replace a live database or delete its WAL files to bypass locking.
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

## Release / npm publishing

Releases are published through `.github/workflows/publish.yml` so npm can
attach provenance using GitHub Actions OIDC.

Before the first npm publish, configure npm trusted publishing for:

- Package: `@ragmha/apple-books-mcp`
- Owner/repository: `ragmha/apple-books-mcp`
- Workflow: `publish.yml`

Then create a GitHub release from a `v*` tag, or manually run the publish
workflow with the tag to publish. The workflow re-runs `bun run check`,
`bun run typecheck`, and `bun test` before `npm publish --provenance`.
