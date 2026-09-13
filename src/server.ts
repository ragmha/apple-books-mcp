import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { exportAnnotationsMarkdownForBook } from "./db/annotation-export.ts";
import {
  deleteAnnotation,
  updateAnnotationNote,
} from "./db/annotation-mutations.ts";
import {
  fullTextSearch,
  getAnnotationById,
  getAnnotationsByBookId,
  getHighlightsByColor,
  listAllAnnotations,
  recentAnnotations,
  searchHighlightedText,
  searchNotes,
} from "./db/annotations.ts";
import { listLibraryBackups, restoreLibraryFromBackup } from "./db/backups.ts";
import {
  getBookById,
  listAllBooks,
  listBooks,
  searchBooks,
} from "./db/books.ts";
import {
  addBookToCollection,
  createCollection,
  deleteCollection,
  getCollectionBooks,
  getCollectionById,
  listCollections,
  removeBookFromCollection,
} from "./db/collections.ts";
import { closeAll, getAnnotationDb, getLibraryDb } from "./db/connection.ts";
import {
  validateAnnotationSchema,
  validateLibrarySchema,
} from "./db/schema-check.ts";
import { mcpTool } from "./mcp-tool.ts";
import { ToolArgumentsTransport } from "./mcp-transport.ts";

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

class BooksMcpServer extends McpServer {
  override connect(transport: Transport): Promise<void> {
    return super.connect(new ToolArgumentsTransport(transport));
  }
}

const productionHandlers = {
  listCollections,
  getCollectionBooks,
  getCollectionById,
  listBooks,
  listAllBooks,
  getBookById,
  searchBooks,
  listAllAnnotations,
  getAnnotationsByBookId,
  getAnnotationById,
  getHighlightsByColor,
  searchHighlightedText,
  searchNotes,
  fullTextSearch,
  recentAnnotations,
  addBookToCollection,
  removeBookFromCollection,
  createCollection,
  deleteCollection,
  listLibraryBackups,
  restoreLibraryFromBackup,
  updateAnnotationNote,
  deleteAnnotation,
  exportAnnotationsMarkdownForBook,
};

export type ServerHandlers = typeof productionHandlers;

export function createServer(
  handlers: ServerHandlers = productionHandlers,
): McpServer {
  const server = new BooksMcpServer(
    { name: "apple-books", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // --- Collection tools (read) ---

  mcpTool(
    server,
    "list_collections",
    "List collections in the Library, paginated (default 50, max 100). Returns an array.",
    Pagination,
    ({ limit, offset }: { limit?: number; offset?: number }) =>
      handlers.listCollections(limit, offset),
  );

  mcpTool(
    server,
    "list_collection_books",
    "Get books in a particular collection, paginated (default 50, max 100). Returns an array.",
    {
      collection_id: IdSchema.describe("Collection ID (UUID or numeric PK)"),
      ...Pagination,
    },
    ({
      collection_id,
      limit,
      offset,
    }: {
      collection_id: string;
      limit?: number;
      offset?: number;
    }) => handlers.getCollectionBooks(collection_id, limit, offset),
  );

  mcpTool(
    server,
    "get_collection",
    "Get details of a particular collection.",
    { collection_id: IdSchema.describe("Collection ID (UUID or numeric PK)") },
    ({ collection_id }: { collection_id: string }) => {
      const collection = handlers.getCollectionById(collection_id);
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
      handlers.listBooks(limit, offset),
  );

  mcpTool(
    server,
    "list_all_books",
    "List EVERY book in the Library (no pagination). Use list_books unless you really want all rows; large libraries can blow past LLM context.",
    {},
    () => handlers.listAllBooks(),
  );

  mcpTool(
    server,
    "get_book",
    "Get details of a particular book.",
    { book_id: IdSchema.describe("Book ID (asset ID or numeric PK)") },
    ({ book_id }: { book_id: string }) => {
      const book = handlers.getBookById(book_id);
      if (!book) throw notFound("Book", book_id);
      return book;
    },
  );

  mcpTool(
    server,
    "search_books",
    "Search books by title, author, or genre (case-insensitive partial match), paginated (default 50, max 100). Returns an array.",
    {
      query: SearchQuerySchema.describe(
        "Search text to match against title, author, or genre",
      ),
      ...Pagination,
    },
    ({
      query,
      limit,
      offset,
    }: {
      query: string;
      limit?: number;
      offset?: number;
    }) => handlers.searchBooks(query, limit, offset),
  );

  // --- Annotation tools (read) ---

  mcpTool(
    server,
    "list_annotations",
    "List recent annotations across the Library, paginated. Filters out soft-deleted rows.",
    Pagination,
    ({ limit, offset }: { limit?: number; offset?: number }) =>
      handlers.listAllAnnotations(limit, offset),
  );

  mcpTool(
    server,
    "get_book_annotations",
    "Get all annotations for a particular book.",
    { book_id: IdSchema.describe("Book asset ID or numeric PK") },
    ({ book_id }: { book_id: string }) => {
      const assetId = handlers.getBookById(book_id)?.assetId ?? book_id;
      return handlers.getAnnotationsByBookId(assetId);
    },
  );

  mcpTool(
    server,
    "get_annotation",
    "Get details of a particular annotation.",
    { annotation_id: IdSchema.describe("Annotation UUID or numeric PK") },
    ({ annotation_id }: { annotation_id: string }) => {
      const annotation = handlers.getAnnotationById(annotation_id);
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
    }) => handlers.getHighlightsByColor(color, limit, offset),
  );

  mcpTool(
    server,
    "search_highlighted_text",
    "Search annotations by highlighted text (case-insensitive partial match), paginated (default 50, max 100). Returns an array.",
    {
      text: SearchQuerySchema.describe("Text to search for in highlights"),
      ...Pagination,
    },
    ({
      text,
      limit,
      offset,
    }: {
      text: string;
      limit?: number;
      offset?: number;
    }) => handlers.searchHighlightedText(text, limit, offset),
  );

  mcpTool(
    server,
    "search_notes",
    "Search annotations by note text (case-insensitive partial match), paginated (default 50, max 100). Returns an array.",
    {
      note: SearchQuerySchema.describe("Text to search for in notes"),
      ...Pagination,
    },
    ({
      note,
      limit,
      offset,
    }: {
      note: string;
      limit?: number;
      offset?: number;
    }) => handlers.searchNotes(note, limit, offset),
  );

  mcpTool(
    server,
    "full_text_search",
    "Search annotations across highlight text, notes, and representative text, paginated (default 50, max 100). Returns an array.",
    {
      text: SearchQuerySchema.describe(
        "Text to search for across all annotation fields",
      ),
      ...Pagination,
    },
    ({
      text,
      limit,
      offset,
    }: {
      text: string;
      limit?: number;
      offset?: number;
    }) => handlers.fullTextSearch(text, limit, offset),
  );

  mcpTool(
    server,
    "recent_annotations",
    "Get the 10 most recently modified annotations.",
    {},
    () => handlers.recentAnnotations(),
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
    ({ book_id, collection_id }: { book_id: string; collection_id: string }) =>
      handlers.addBookToCollection(book_id, collection_id),
  );

  mcpTool(
    server,
    "remove_book_from_collection",
    "Remove a book from a collection. Snapshots the Library and restarts Books.app.",
    {
      book_id: IdSchema.describe("Book ID (asset ID or numeric PK)"),
      collection_id: IdSchema.describe("Collection ID (UUID or numeric PK)"),
    },
    ({ book_id, collection_id }: { book_id: string; collection_id: string }) =>
      handlers.removeBookFromCollection(book_id, collection_id),
  );

  mcpTool(
    server,
    "create_collection",
    "Create a new collection. Snapshots the Library and restarts Books.app.",
    { name: CollectionNameSchema.describe("Name for the new collection") },
    ({ name }: { name: string }) => handlers.createCollection(name),
  );

  mcpTool(
    server,
    "delete_collection",
    "Soft-delete a collection (sets ZDELETEDFLAG=1). Snapshots the Library and restarts Books.app.",
    { collection_id: IdSchema.describe("Collection ID (UUID or numeric PK)") },
    ({ collection_id }: { collection_id: string }) =>
      handlers.deleteCollection(collection_id),
  );

  // --- Backup tools ---
  //
  // Every write takes an integrity-checked snapshot before mutating. These
  // tools let users see those snapshots and roll the Library back to one.
  // `restore_backup` runs the same safety ceremony as a write: integrity
  // check the chosen backup, quit Books, take a *fresh* pre-restore safety
  // snapshot, swap the file, relaunch Books.

  mcpTool(
    server,
    "list_backups",
    "List Apple Books Library backups previously taken before each write, newest first.",
    {},
    () => handlers.listLibraryBackups(),
  );

  mcpTool(
    server,
    "restore_backup",
    "Restore the Apple Books Library from a previously-taken backup. Takes a fresh pre-restore safety snapshot first, then swaps the file and restarts Books.app.",
    {
      handle: z
        .string()
        .min(1)
        .max(1024)
        .describe(
          "Backup handle (the `handle` field returned by list_backups; absolute path to the backup file).",
        ),
    },
    ({ handle }: { handle: string }) =>
      handlers.restoreLibraryFromBackup(handle),
  );

  // --- Annotation write tools ---
  //
  // Operate on the AEAnnotation Core Data store (separate file from the
  // Library). Each routes through its own LibraryMutation instance with
  // the same safety ceremony as Library writes.

  mcpTool(
    server,
    "update_annotation_note",
    "Update the note text on an annotation. Snapshots the Annotations DB and restarts Books.app.",
    {
      annotation_id: IdSchema.describe("Annotation UUID or numeric PK"),
      note: z
        .string()
        .min(1)
        .max(10_000)
        .describe("New note text (must be non-empty)"),
    },
    ({ annotation_id, note }: { annotation_id: string; note: string }) =>
      handlers.updateAnnotationNote(annotation_id, note),
  );

  mcpTool(
    server,
    "delete_annotation",
    "Soft-delete an annotation (sets ZANNOTATIONDELETED=1). Snapshots the Annotations DB and restarts Books.app.",
    {
      annotation_id: IdSchema.describe("Annotation UUID or numeric PK"),
    },
    ({ annotation_id }: { annotation_id: string }) =>
      handlers.deleteAnnotation(annotation_id),
  );

  mcpTool(
    server,
    "export_annotations_markdown",
    "Export annotations as Markdown. Pass an asset_id to scope to a single book; omit to export every book grouped under per-book headers. Read-only.",
    {
      asset_id: IdSchema.optional().describe(
        "Optional book asset ID. When omitted, every book's annotations are exported.",
      ),
    },
    ({ asset_id }: { asset_id?: string }) =>
      handlers.exportAnnotationsMarkdownForBook(asset_id),
  );

  return server;
}

export async function serve(): Promise<void> {
  // Validate the Apple Books schema up front. If a macOS upgrade has changed
  // the Core Data layout, fail loud rather than silently corrupt user data.
  try {
    const libraryResult = validateLibrarySchema(getLibraryDb());
    if (!libraryResult.ok) {
      console.error(`apple-books-mcp: ${libraryResult.message}`);
      console.error(
        "apple-books-mcp: refusing to start; please open an issue with your macOS / Books version.",
      );
      process.exit(2);
    }
    const annotationResult = validateAnnotationSchema(getAnnotationDb());
    if (!annotationResult.ok) {
      console.error(`apple-books-mcp: ${annotationResult.message}`);
      console.error(
        "apple-books-mcp: refusing to start; please open an issue with your macOS / Books version.",
      );
      process.exit(2);
    }
  } catch (error) {
    // Most likely cause: Full Disk Access not granted, so we cannot read the
    // Library file at all. Log a helpful pointer and exit.
    console.error(
      "apple-books-mcp: could not open the Apple Books databases:",
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
