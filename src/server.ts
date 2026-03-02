import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { listAllBooks, getBookById, searchBooks } from "./db/books.ts";
import {
  listCollections,
  getCollectionById,
  getCollectionBooks,
  addBookToCollection,
  removeBookFromCollection,
  createCollection,
  deleteCollection,
} from "./db/collections.ts";
import {
  listAllAnnotations,
  getAnnotationsByBookId,
  getAnnotationById,
  getHighlightsByColor,
  searchHighlightedText,
  searchNotes,
  fullTextSearch,
  recentAnnotations,
} from "./db/annotations.ts";
import { closeAll } from "./db/connection.ts";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "apple-books",
    version: "0.1.0",
  });

  // --- Collection Tools (Read) ---

  server.tool("list_collections", "List all collections in Apple Books library", {}, async () => {
    const collections = listCollections();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(collections, null, 2),
        },
      ],
    };
  });

  server.tool(
    "get_collection_books",
    "Get all books in a particular collection",
    { collection_id: z.string().describe("Collection ID (UUID or numeric PK)") },
    async ({ collection_id }) => {
      const books = getCollectionBooks(collection_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(books, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "describe_collection",
    "Get details of a particular collection",
    { collection_id: z.string().describe("Collection ID (UUID or numeric PK)") },
    async ({ collection_id }) => {
      const collection = getCollectionById(collection_id);
      if (!collection) {
        return { content: [{ type: "text" as const, text: "Collection not found" }] };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(collection, null, 2) }],
      };
    }
  );

  // --- Book Tools (Read) ---

  server.tool("list_all_books", "List all books in Apple Books library", {}, async () => {
    const books = listAllBooks();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(books, null, 2) }],
    };
  });

  server.tool(
    "describe_book",
    "Get details of a particular book",
    { book_id: z.string().describe("Book ID (asset ID or numeric PK)") },
    async ({ book_id }) => {
      const book = getBookById(book_id);
      if (!book) {
        return { content: [{ type: "text" as const, text: "Book not found" }] };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(book, null, 2) }],
      };
    }
  );

  server.tool(
    "search_books",
    "Search books by title, author, or genre",
    { query: z.string().describe("Search text to match against title, author, or genre") },
    async ({ query }) => {
      const books = searchBooks(query);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(books, null, 2) }],
      };
    }
  );

  // --- Annotation Tools (Read) ---

  server.tool("list_all_annotations", "List all annotations in Apple Books", {}, async () => {
    const annotations = listAllAnnotations();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(annotations, null, 2) }],
    };
  });

  server.tool(
    "get_book_annotations",
    "Get all annotations for a particular book",
    { book_id: z.string().describe("Book asset ID") },
    async ({ book_id }) => {
      // Resolve asset ID if given numeric PK
      let assetId = book_id;
      const book = getBookById(book_id);
      if (book) assetId = book.assetId;

      const annotations = getAnnotationsByBookId(assetId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(annotations, null, 2) }],
      };
    }
  );

  server.tool(
    "describe_annotation",
    "Get details of a particular annotation",
    { annotation_id: z.string().describe("Annotation UUID or numeric PK") },
    async ({ annotation_id }) => {
      const annotation = getAnnotationById(annotation_id);
      if (!annotation) {
        return { content: [{ type: "text" as const, text: "Annotation not found" }] };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(annotation, null, 2) }],
      };
    }
  );

  server.tool(
    "get_highlights_by_color",
    "Get all highlights by color (green, blue, yellow, pink, purple)",
    { color: z.string().describe("Highlight color: green, blue, yellow, pink, or purple") },
    async ({ color }) => {
      const highlights = getHighlightsByColor(color);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(highlights, null, 2) }],
      };
    }
  );

  server.tool(
    "search_highlighted_text",
    "Search annotations by highlighted text",
    { text: z.string().describe("Text to search for in highlights") },
    async ({ text }) => {
      const results = searchHighlightedText(text);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  server.tool(
    "search_notes",
    "Search annotations by note text",
    { note: z.string().describe("Text to search for in notes") },
    async ({ note }) => {
      const results = searchNotes(note);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  server.tool(
    "full_text_search",
    "Search annotations by any text (highlights, notes, representative text)",
    { text: z.string().describe("Text to search for across all annotation fields") },
    async ({ text }) => {
      const results = fullTextSearch(text);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  server.tool("recent_annotations", "Get 10 most recent annotations", {}, async () => {
    const results = recentAnnotations();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
    };
  });

  // --- Write Tools ---

  server.tool(
    "add_book_to_collection",
    "Add a book to a collection. Backs up the database and restarts Apple Books.",
    {
      book_id: z.string().describe("Book ID (asset ID or numeric PK)"),
      collection_id: z.string().describe("Collection ID (UUID or numeric PK)"),
    },
    async ({ book_id, collection_id }) => {
      const result = await addBookToCollection(book_id, collection_id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "remove_book_from_collection",
    "Remove a book from a collection. Backs up the database and restarts Apple Books.",
    {
      book_id: z.string().describe("Book ID (asset ID or numeric PK)"),
      collection_id: z.string().describe("Collection ID (UUID or numeric PK)"),
    },
    async ({ book_id, collection_id }) => {
      const result = await removeBookFromCollection(book_id, collection_id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "create_collection",
    "Create a new collection in Apple Books. Backs up the database and restarts Apple Books.",
    { name: z.string().describe("Name for the new collection") },
    async ({ name }) => {
      const result = await createCollection(name);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "delete_collection",
    "Delete a collection from Apple Books (soft delete). Backs up the database and restarts Apple Books.",
    { collection_id: z.string().describe("Collection ID (UUID or numeric PK)") },
    async ({ collection_id }) => {
      const result = await deleteCollection(collection_id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  return server;
}

export async function serve(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  process.on("SIGINT", () => {
    closeAll();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    closeAll();
    process.exit(0);
  });

  await server.connect(transport);
}
