# Apple Books MCP Server

A Bun/TypeScript MCP server for querying and managing your Apple Books library, annotations, and collections.

> ⚠️ **Educational use only.** This accesses Apple Books' internal SQLite databases, which is unsupported by Apple. Use at your own risk.

## Features

**Read:** List/search books, collections, annotations, highlights by color, notes, recent annotations

**Write:** Add/remove books from collections, create/delete collections

> Write operations back up the database and restart Apple Books to apply changes.

## Setup

Requires macOS with Apple Books and [Bun](https://bun.sh).

```bash
bun install
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apple-books": {
      "command": "bun",
      "args": ["run", "/path/to/apple-books-mcp/src/index.ts"]
    }
  }
}
```

### VS Code / Copilot

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "apple-books": {
      "command": "bun",
      "args": ["run", "/path/to/apple-books-mcp/src/index.ts"]
    }
  }
}
```

## Development

```bash
bun run dev   # Watch mode
bun run start # Run once
```

## License

MIT
