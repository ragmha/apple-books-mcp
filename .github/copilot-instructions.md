# Copilot Instructions

This is a Bun/TypeScript MCP (Model Context Protocol) server for Apple Books.

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript
- **Validation:** Zod v4
- **Protocol:** MCP SDK (@modelcontextprotocol/sdk)
- **Database:** SQLite via bun:sqlite (Apple Books internal databases)

## Project Structure

- `src/index.ts` - Entry point, starts stdio transport
- `src/server.ts` - MCP server with tool definitions
- `src/db/` - Database layer
  - `connection.ts` - Database connections
  - `query.ts` - Fluent query builder with Zod validation
  - `schemas.ts` - Zod schemas for books, collections, annotations
  - `constants.ts` - Table names, paths, entity types
  - `books.ts`, `collections.ts`, `annotations.ts` - Domain queries

## Conventions

- Use the fluent query builder (`createDb(db).selectFrom(table, schema)`) for queries
- Zod schemas handle row→presentation transformation
- Raw column names (e.g., `ZTITLE`, `Z_PK`) stay as strings in queries
- Table names use constants from `constants.ts`
- Core Data timestamps need conversion via `coreDataToISO()`

## Important Notes

- This accesses Apple Books' internal SQLite databases (educational use only)
- Write operations create backups and restart Apple Books
- Core Data epoch is 2001-01-01 (not Unix epoch)
