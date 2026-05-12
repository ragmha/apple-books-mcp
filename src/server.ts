import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  listAllBooks,
  listBooks,
  getBookById,
  searchBooks,
} from "./db/books.ts";
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
import { closeAll, getLibraryDb } from "./db/connection.ts";
import { validateLibrarySchema } from "./db/schema-check.ts";
import { mcpTool } from "./mcp-tool.ts";

// Reusable Zod schemas with security constraints.
export const IdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/, "Invalid ID format");
export const SearchQuerySchema = z.string().min(1).max(500);
export const CollectionNameSchema = z.string().min(1).max(255);
export const HighlightColorSchema = z.enum([
  "green",
  "blue",
  "yellow",
  "pink",
  "purple",
]);

// Pagination schema reused across list/search tools so the same params and
// docs appear everywhere a tool returns potentially many rows.
const Pagination = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max items to return (default 50, max 100)"),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Items to skip for pagination (default 0)"),
} as const;

function notFound(what: string, id: string): McpError {
  return new McpError(ErrorCode.InvalidParams, `${what} not found: ${id}`);
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "apple-books", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // --- Collection tools (read) ---

  mcpTool(server, "list_collections", "List all collections in the Library.", {}, () =>
    listCollections(),
  );

  mcpTool(
    server,
    "list_collection_books",
    "Get all books in a particular collection.",
    { collection_id: IdSchema.describe("Collection ID (UUID or numeric PK)") },
    ({ collection_id }: { collection_id: string }) =>
      getCollectionBooks(collection_id),
  );

  mcpTool(
    server,
    "get_collection",
    "Get details of a particular collection.",
    { collection_id: IdSchema.describe("Collection ID (UUID or numeric PK)") },
    ({ collection_id }: { collection_id: string }) => {
      const collection = getCollectionById(collection_id);
      if (!collection) throw notFound("Collection", collection_id);
      return collection;
    },
  );

  // --- Book tools (read) ---

  mcpTool(
    server,
    "list_books",
    "List books in the Library, paginated.",
    Pagination,
    ({ limit, offset }: { limit?: number; offset?: number }) =>
      listBooks(limit, offset),
  );

  mcpTool(
    server,
    "list_all_books",
    "List EVERY book in the Library (no pagination). Use list_books unless you really want all rows; large libraries can blow past LLM context.",
    {},
    () => listAllBooks(),
  );

  mcpTool(
    server,
    "get_book",
    "Get details of a particular book.",
    { book_id: IdSchema.describe("Book ID (asset ID or numeric PK)") },
    ({ book_id }: { book_id: string }) => {
      const book = getBookById(book_id);
      if (!book) throw notFound("Book", book_id);
      return book;
    },
  );

  mcpTool(
    server,
    "search_books",
    "Search books by title, author, or genre (case-insensitive partial match).",
    {
      query: SearchQuerySchema.describe(
        "Search text to match against title, author, or genre",
      ),
    },
    ({ query }: { query: string }) => searchBooks(query),
  );

  // --- Annotation tools (read) ---

  mcpTool(
    server,
    "list_annotations",
    "List recent annotations across the Library, paginated. Filters out soft-deleted rows.",
    Pagination,
    ({ limit, offset }: { limit?: number; offset?: number }) =>
      listAllAnnotations(limit, offset),
  );

  mcpTool(
    server,
    "get_book_annotations",
    "Get all annotations for a particular book.",
    { book_id: IdSchema.describe("Book asset ID or numeric PK") },
    ({ book_id }: { book_id: string }) => {
      // Resolve numeric PK input into ZASSETID; pass UUID-shaped input through.
      let assetId = book_id;
      const numId = Number.parseInt(book_id, 10);
      if (!Number.isNaN(numId) && String(numId) === book_id) {
        const book = getBookById(book_id);
        if (book) assetId = book.assetId;
      }
      return getAnnotationsByBookId(assetId);
    },
  );

  mcpTool(
    server,
    "get_annotation",
    "Get details of a particular annotation.",
    { annotation_id: IdSchema.describe("Annotation UUID or numeric PK") },
    ({ annotation_id }: { annotation_id: string }) => {
      const annotation = getAnnotationById(annotation_id);
      if (!annotation) throw notFound("Annotation", annotation_id);
      return annotation;
    },
  );

  mcpTool(
    server,
    "get_highlights_by_color",
    "Get highlights of a given color, paginated. Filters out soft-deleted rows.",
    {
      color: HighlightColorSchema.describe(
        "Highlight color (one of: green, blue, yellow, pink, purple)",
      ),
      ...Pagination,
    },
    ({
      color,
      limit,
      offset,
    }: {
      color: "green" | "blue" | "yellow" | "pink" | "purple";
      limit?: number;
      offset?: number;
    }) => getHighlightsByColor(color, limit, offset),
  );

  mcpTool(
    server,
    "search_highlighted_text",
    "Search annotations by highlighted text (case-insensitive partial match).",
    { text: SearchQuerySchema.describe("Text to search for in highlights") },
    ({ text }: { text: string }) => searchHighlightedText(text),
  );

  mcpTool(
    server,
    "search_notes",
    "Search annotations by note text (case-insensitive partial match).",
    { note: SearchQuerySchema.describe("Text to search for in notes") },
    ({ note }: { note: string }) => searchNotes(note),
  );

  mcpTool(
    server,
    "full_text_search",
    "Search annotations across highlight text, notes, and representative text.",
    {
      text: SearchQuerySchema.describe(
        "Text to search for across all annotation fields",
      ),
    },
    ({ text }: { text: string }) => fullTextSearch(text),
  );

  mcpTool(
    server,
    "recent_annotations",
    "Get the 10 most recently modified annotations.",
    {},
    () => recentAnnotations(),
  );

  // --- Write tools ---
  //
  // All four route through LibraryMutation, which: snapshots the Library,
  // verifies the snapshot, quits Books.app *before* the change, runs in a
  // BEGIN IMMEDIATE transaction with Z_OPT/mtime discipline, and relaunches
  // Books.app on success. See src/db/library-mutation.ts.

  mcpTool(
    server,
    "add_book_to_collection",
    "Add a book to a collection. Snapshots the Library and restarts Books.app.",
    {
      book_id: IdSchema.describe("Book ID (asset ID or numeric PK)"),
      collection_id: IdSchema.describe("Collection ID (UUID or numeric PK)"),
    },
    ({
      book_id,
      collection_id,
    }: {
      book_id: string;
      collection_id: string;
    }) => addBookToCollection(book_id, collection_id),
  );

  mcpTool(
    server,
    "remove_book_from_collection",
    "Remove a book from a collection. Snapshots the Library and restarts Books.app.",
    {
      book_id: IdSchema.describe("Book ID (asset ID or numeric PK)"),
      collection_id: IdSchema.describe("Collection ID (UUID or numeric PK)"),
    },
    ({
      book_id,
      collection_id,
    }: {
      book_id: string;
      collection_id: string;
    }) => removeBookFromCollection(book_id, collection_id),
  );

  mcpTool(
    server,
    "create_collection",
    "Create a new collection. Snapshots the Library and restarts Books.app.",
    { name: CollectionNameSchema.describe("Name for the new collection") },
    ({ name }: { name: string }) => createCollection(name),
  );

  mcpTool(
    server,
    "delete_collection",
    "Soft-delete a collection (sets ZDELETEDFLAG=1). Snapshots the Library and restarts Books.app.",
    { collection_id: IdSchema.describe("Collection ID (UUID or numeric PK)") },
    ({ collection_id }: { collection_id: string }) =>
      deleteCollection(collection_id),
  );

  return server;
}

export async function serve(): Promise<void> {
  // Validate the Apple Books schema up front. If a macOS upgrade has changed
  // the Core Data layout, fail loud rather than silently corrupt user data.
  try {
    const result = validateLibrarySchema(getLibraryDb());
    if (!result.ok) {
      console.error(`apple-books-mcp: ${result.message}`);
      console.error(
        "apple-books-mcp: refusing to start; please open an issue with your macOS / Books version.",
      );
      process.exit(2);
    }
  } catch (error) {
    // Most likely cause: Full Disk Access not granted, so we cannot read the
    // Library file at all. Log a helpful pointer and exit.
    console.error(
      "apple-books-mcp: could not open the Apple Books library:",
      error,
    );
    console.error(
      "apple-books-mcp: this is usually a macOS Full Disk Access permission issue. " +
        "See README.md for setup steps.",
    );
    process.exit(2);
  }

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
