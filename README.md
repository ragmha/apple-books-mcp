# Apple Books MCP Server

A TypeScript/Bun MCP (Model Context Protocol) server for Apple Books with **read and write** support. Query your library, annotations, and highlights — and move books between collections.

## Features

### Read Tools
| Tool | Description |
|------|-------------|
| `list_collections` | List all collections |
| `get_collection_books` | Get books in a collection |
| `describe_collection` | Collection details |
| `list_all_books` | List all books |
| `describe_book` | Book details |
| `search_books` | Search by title, author, or genre |
| `get_book_annotations` | Annotations for a book |
| `list_all_annotations` | All annotations |
| `get_highlights_by_color` | Highlights by color |
| `search_highlighted_text` | Search highlight text |
| `search_notes` | Search notes |
| `full_text_search` | Search all annotation fields |
| `recent_annotations` | 10 most recent annotations |
| `describe_annotation` | Annotation details |

### Write Tools
| Tool | Description |
|------|-------------|
| `add_book_to_collection` | Add a book to a collection |
| `remove_book_from_collection` | Remove a book from a collection |
| `create_collection` | Create a new collection |
| `delete_collection` | Delete a collection (soft delete) |

> ⚠️ Write operations back up the database before making changes and restart Apple Books to pick up modifications.

## Prerequisites

- macOS with Apple Books
- [Bun](https://bun.sh) runtime

## Installation

```bash
git clone <repo-url>
cd apple-books-mcp
bun install
```

## Configuration

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

### GitHub Copilot CLI

Add to your MCP configuration (`.github/copilot/mcp.json` or VS Code settings):

```json
{
  "servers": {
    "apple-books": {
      "command": "bun",
      "args": ["run", "/path/to/apple-books-mcp/src/index.ts"],
      "type": "stdio"
    }
  }
}
```

### Any MCP Client (stdio)

```bash
bun run /path/to/apple-books-mcp/src/index.ts
```

The server communicates via JSON-RPC over stdio using the MCP protocol.

## Development

```bash
bun run dev   # Watch mode
bun run start # Run once
```

## How It Works

The server reads Apple Books' internal SQLite databases directly:

- **BKLibrary** (`~/Library/Containers/com.apple.iBooksX/Data/Documents/BKLibrary/`) — books, collections, memberships
- **AEAnnotation** (`~/Library/Containers/com.apple.iBooksX/Data/Documents/AEAnnotation/`) — highlights, notes, annotations

For write operations, the server:
1. Creates a timestamped backup of the database
2. Modifies the SQLite database directly (updating Core Data counters)
3. Restarts Apple Books to pick up the changes

## License

MIT
