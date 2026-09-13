# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning while the public MCP tool surface is
still pre-1.0.

## Unreleased

### Added

- GitHub Actions workflow for npm publishing with OIDC provenance.
- `.nvmrc` to pin the Node/npm publishing toolchain.
- Remotion demo source with sanitized read/write walkthrough, transcript, and
  reusable MCP client prompts.

### Changed

- Updated GitHub Actions workflows to Node 24-compatible action majors.
- Standardized paginated list/search tools on a default limit of 50 and a
  maximum of 100 while preserving existing result shapes and full-export tools.

### Fixed

- Resolved natural identifiers before strict numeric primary-key fallback,
  including UUID casing and soft-deleted target handling.
- Validated required read/write columns and Core Data allocator mappings
  before accepting an unsupported database.
- Accepted omitted arguments for zero-argument and all-optional MCP tools
  without weakening required-field validation or hiding their input schemas.
- Marked returned mutation failures as MCP tool errors while preserving
  sanitized error payloads.
- Created consistent standalone WAL-aware snapshots with collision-safe names
  and protected restore targets from backup rotation.
- Restored through an exclusively locked SQLite connection instead of
  overwriting a live database with cached handles and WAL files.
- Verified pre-restore safety snapshots and returned structured failures for
  snapshot verification, database opening, and restore setup errors.

## [0.1.1] - 2026-05-13

### Changed

- Prepared npm metadata for publishing as the public scoped package
  `@ragmha/apple-books-mcp`.

## [0.1.0] - 2026-05-13

### Added

- MCP server for Apple Books on macOS, built with Bun and TypeScript.
- Read tools for books, collections, annotations, highlights, and notes.
- Write tools for collections and annotation notes/deletes.
- Backup tools: `list_backups` and `restore_backup`.
- Markdown export for annotations.
- `LibraryMutation` safety seam for writes:
  snapshot, integrity check, Books.app lifecycle control, transaction,
  rollback, sanitized error reporting, and restart-after-commit.
- Startup schema validation for Library and Annotations databases.
- In-memory SQLite test fixtures and fake Books.app/filesystem adapters.
- CI on macOS with Biome, typecheck, and tests.

### Security

- Parameterized SQL for user input and identifier validation for dynamic SQL
  positions.
- Sanitized MCP-facing system errors to avoid leaking book titles, highlighted
  text, or note content.
- Backup restore path guard to prevent restoring arbitrary files.
