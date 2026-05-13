# Security Policy

## Supported Versions

This project is in active development. Only the latest `main` branch and
the most recent tagged release receive security updates.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email the maintainer at [the address on the GitHub profile][profile] with:

- A description of the vulnerability and the impact.
- Reproduction steps (a minimal example is ideal).
- The commit SHA or release tag you tested against.

You should receive an acknowledgement within 7 days. Please give us a
reasonable window to investigate and ship a fix before any public
disclosure.

[profile]: https://github.com/ragmha

## Scope

This server reads from and **writes to** Apple Books' internal SQLite
databases on the user's machine. The threat model includes:

- **Data loss / corruption.** Every write goes through `LibraryMutation`,
  which snapshots the affected database, runs an integrity check on the
  snapshot, quits Books.app, runs the change in a `BEGIN IMMEDIATE`
  transaction, and only relaunches Books.app on `COMMIT`. A bug here is
  a high-severity report.
- **Path traversal.** `restore_backup` validates that the chosen handle
  lives in the expected backups directory and matches the live DB
  filename prefix before any file is overwritten. Bypasses are
  high-severity reports.
- **PII leakage in error messages.** System errors are sanitised to
  `"Operation failed. Backup: <path>"`; raw error text (which may
  include book titles or note text) is logged to stderr only. A user
  visible error that surfaces unsanitised content is a medium-severity
  report.
- **SQL injection.** All user input is bound via parameters; identifier
  positions are validated against an allow-list (`assertSqlIdentifier`).
  A working injection is a high-severity report.

Outside the scope:

- Bugs that require already having Full Disk Access to the user's home
  directory and direct shell access to the same machine.
- Concerns about Apple Books itself or the macOS sandbox model.
