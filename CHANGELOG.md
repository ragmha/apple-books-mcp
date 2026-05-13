# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning while the public MCP tool surface is
still pre-1.0.

## Unreleased

### Added

- GitHub Actions workflow for npm publishing with OIDC provenance.
- `.nvmrc` to pin the Node/npm publishing toolchain.

### Changed

- Updated GitHub Actions workflows to Node 24-compatible action majors.

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
