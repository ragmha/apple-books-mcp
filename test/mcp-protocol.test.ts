import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolResultSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { exportAnnotationsMarkdown } from "../src/db/annotation-export.ts";
import { createAnnotationQueries } from "../src/db/annotations.ts";
import { createBookQueries } from "../src/db/books.ts";
import { createCollectionQueries } from "../src/db/collections.ts";
import { MutationError } from "../src/db/library-mutation.ts";
import { mcpTool } from "../src/mcp-tool.ts";
import { createServer, type ServerHandlers } from "../src/server.ts";
import {
  createSeededAnnotationDb,
  createSeededDb,
  seedAnnotation,
  seedBook,
  seedCollection,
} from "./helpers/seed.ts";

const servers: McpServer[] = [];
const databases: Database[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const db of databases.splice(0)) db.close();
});

function fakeHandlers(): ServerHandlers {
  return {
    listCollections: () => [],
    getCollectionBooks: () => [],
    getCollectionById: () => null,
    listBooks: (limit, offset) => ({
      books: [],
      total: 0,
      limit: limit ?? 50,
      offset: offset ?? 0,
    }),
    listAllBooks: () => [],
    getBookById: () => null,
    searchBooks: () => [],
    listAllAnnotations: (limit, offset) => ({
      annotations: [],
      total: 0,
      limit: limit ?? 50,
      offset: offset ?? 0,
    }),
    getAnnotationsByBookId: () => [],
    getAnnotationById: () => null,
    getHighlightsByColor: (_color, limit, offset) => ({
      annotations: [],
      total: 0,
      limit: limit ?? 50,
      offset: offset ?? 0,
    }),
    searchHighlightedText: () => [],
    searchNotes: () => [],
    fullTextSearch: () => [],
    recentAnnotations: () => [],
    addBookToCollection: async () => ({ success: true, message: "Added." }),
    removeBookFromCollection: async () => ({
      success: true,
      message: "Removed.",
    }),
    createCollection: async () => ({ success: true, message: "Created." }),
    deleteCollection: async () => ({ success: true, message: "Deleted." }),
    listLibraryBackups: () => [],
    restoreLibraryFromBackup: async (handle) => ({
      success: true,
      restoredFrom: handle,
      safetyBackupPath: "fixture-snapshot",
      message: "Restored.",
    }),
    updateAnnotationNote: async () => ({ success: true, message: "Updated." }),
    deleteAnnotation: async () => ({ success: true, message: "Deleted." }),
    exportAnnotationsMarkdownForBook: (assetId) => ({
      assetId: assetId ?? null,
      markdown: "Fixture export",
    }),
  };
}

async function connect(
  register: (server: McpServer) => void = () => {},
  handlers: ServerHandlers = fakeHandlers(),
) {
  const server = createServer(handlers);
  servers.push(server);
  register(server);
  const client = new Client({ name: "fixture-client", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server, clientTransport, serverTransport };
}

function seededHandlers(count = 0) {
  const library = createSeededDb();
  const annotations = createSeededAnnotationDb();
  databases.push(library, annotations);
  for (let pk = 1; pk <= count; pk += 1) {
    seedBook(library, {
      pk,
      assetId: `book-${pk}`,
      title: `Fixture book ${pk}`,
    });
    seedCollection(library, {
      pk,
      uuid: `shelf-${pk}`,
      title: `Fixture shelf ${pk}`,
    });
    seedAnnotation(annotations, {
      pk,
      uuid: `annotation-${pk}`,
      assetId: "book-1",
      selectedText: `Fixture highlight ${pk}`,
      note: `Fixture note ${pk}`,
    });
    library.run(
      `INSERT INTO ZBKCOLLECTIONMEMBER
       (Z_PK, Z_ENT, Z_OPT, ZSORTKEY, ZASSET, ZCOLLECTION, ZLOCALMODDATE, ZASSETID)
       VALUES (?, 3, 1, ?, ?, 1, 0, ?)`,
      [pk, pk, pk, `book-${pk}`],
    );
  }
  library.run("UPDATE Z_PRIMARYKEY SET Z_MAX = ? WHERE Z_ENT = 3", [count]);
  const handlers: ServerHandlers = {
    ...fakeHandlers(),
    ...createBookQueries(() => library),
    ...createCollectionQueries(() => library),
    ...createAnnotationQueries(() => annotations),
    exportAnnotationsMarkdownForBook: (assetId) => ({
      assetId: assetId ?? null,
      markdown: exportAnnotationsMarkdown(annotations, assetId),
    }),
  };
  return { handlers, library, annotations };
}

async function payload(
  client: Client,
  name: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const result = CallToolResultSchema.parse(
    await client.callTool({
      name,
      ...(args === undefined ? {} : { arguments: args }),
    }),
  );
  expect(result.isError).toBeUndefined();
  expect(result.content).toHaveLength(1);
  const content = result.content[0];
  if (!content || content.type !== "text")
    throw new Error("Expected MCP text content");
  return JSON.parse(content.text);
}

const entityArray = z.array(z.object({ id: z.number() }));

describe("MCP protocol contracts", () => {
  test("omitted arguments equal an empty object for a zero-argument tool", async () => {
    const calls: object[] = [];
    const { client } = await connect((server) =>
      mcpTool(server, "fixture_empty", "Fixture", {}, (args: object) => {
        calls.push(args);
        return [];
      }),
    );

    const explicit = await client.callTool({
      name: "fixture_empty",
      arguments: {},
    });
    const omitted = await client.callTool({ name: "fixture_empty" });
    expect(omitted).toEqual(explicit);
    expect(omitted.isError).toBeUndefined();
    expect(calls).toEqual([{}, {}]);
  });

  test("omitted arguments equal an empty object for an all-optional tool", async () => {
    const calls: object[] = [];
    const { client } = await connect((server) =>
      mcpTool(
        server,
        "fixture_optional",
        "Fixture",
        { limit: z.number().int().min(1).max(100).optional() },
        (args: { limit?: number }) => {
          calls.push(args);
          return args.limit ?? 50;
        },
      ),
    );

    const explicit = await client.callTool({
      name: "fixture_optional",
      arguments: {},
    });
    const omitted = await client.callTool({ name: "fixture_optional" });
    expect(omitted).toEqual(explicit);
    expect(omitted.isError).toBeUndefined();
    expect(calls).toEqual([{}, {}]);

    const { tools } = await client.listTools();
    expect(
      tools.find((tool) => tool.name === "fixture_optional")?.inputSchema,
    ).toMatchObject({
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 100 } },
    });
    expect(
      tools.find((tool) => tool.name === "get_book")?.inputSchema,
    ).toMatchObject({
      type: "object",
      required: ["book_id"],
      properties: { book_id: { type: "string", minLength: 1 } },
    });
  });

  test("invalid required arguments never reach a handler", async () => {
    const calls: string[] = [];
    const { client } = await connect((server) =>
      mcpTool(
        server,
        "fixture_required",
        "Fixture",
        { identifier: z.string().min(1) },
        ({ identifier }: { identifier: string }) => {
          calls.push(identifier);
          return identifier;
        },
      ),
    );

    for (const params of [
      { name: "fixture_required" },
      { name: "fixture_required", arguments: {} },
      { name: "fixture_required", arguments: { identifier: "" } },
      { name: "fixture_required", arguments: { identifier: 42 } },
    ]) {
      const result = await client.callTool(params);
      expect(result.isError).toBe(true);
    }
    expect(calls).toEqual([]);
    expect(
      (
        await client.callTool({
          name: "fixture_required",
          arguments: { identifier: "valid" },
        })
      ).isError,
    ).toBeUndefined();
    expect(calls).toEqual(["valid"]);
  });

  test("explicit null, arrays and malformed arguments remain rejected", async () => {
    let calls = 0;
    const { client } = await connect((server) =>
      mcpTool(server, "fixture_empty", "Fixture", {}, () => {
        calls += 1;
        return [];
      }),
    );

    for (const args of [null, [], ["invalid"], "invalid", 1, false]) {
      await expect(
        client.request(
          {
            method: "tools/call",
            params: { name: "fixture_empty", arguments: args },
          },
          CallToolResultSchema,
        ),
      ).rejects.toBeInstanceOf(McpError);
    }
    expect(calls).toBe(0);
  });

  test("returned domain failures set isError through the MCP protocol", async () => {
    const failure = {
      success: false,
      message: "Operation failed.",
      backupPath: "fixture-backup",
    };
    const { client } = await connect((server) =>
      mcpTool(server, "fixture_failure", "Fixture", {}, () => failure),
    );
    expect(await client.callTool({ name: "fixture_failure" })).toEqual({
      content: [{ type: "text", text: JSON.stringify(failure, null, 2) }],
      isError: true,
    });
  });

  test("thrown errors stay sanitized through the MCP protocol", async () => {
    const { client } = await connect((server) => {
      mcpTool(server, "fixture_private_error", "Fixture", {}, () => {
        throw new Error("Synthetic private fixture note");
      });
      mcpTool(server, "fixture_user_error", "Fixture", {}, () => {
        throw new MutationError("Book not found: fixture");
      });
    });
    const internal = await client.callTool({ name: "fixture_private_error" });
    expect(internal.isError).toBe(true);
    expect(JSON.stringify(internal)).toContain("Operation failed.");
    expect(JSON.stringify(internal)).not.toContain(
      "Synthetic private fixture note",
    );
    const userError = await client.callTool({ name: "fixture_user_error" });
    expect(userError.isError).toBe(true);
    expect(JSON.stringify(userError)).toContain("Book not found: fixture");
  });

  for (const name of [
    "list_collections",
    "list_books",
    "list_all_books",
    "list_annotations",
    "recent_annotations",
    "list_backups",
    "export_annotations_markdown",
  ]) {
    test(`omitted arguments work on the registered ${name} tool`, async () => {
      const { client } = await connect();
      const explicit = await client.callTool({ name, arguments: {} });
      const omitted = await client.callTool({ name });
      expect(omitted).toEqual(explicit);
      expect(omitted.isError).toBeUndefined();
    });
  }

  test("invalid registered read and write parameters never execute domain handlers", async () => {
    const handlers = fakeHandlers();
    let calls = 0;
    handlers.getBookById = () => {
      calls += 1;
      return null;
    };
    handlers.createCollection = async () => {
      calls += 1;
      return { success: true, message: "Created." };
    };
    const { client } = await connect(undefined, handlers);
    for (const name of ["get_book", "create_collection"]) {
      expect((await client.callTool({ name })).isError).toBe(true);
      expect((await client.callTool({ name, arguments: {} })).isError).toBe(
        true,
      );
    }
    expect(calls).toBe(0);
  });

  test("registered mutations preserve success and failure payloads with correct error signaling", async () => {
    const failure = { success: false, message: "Operation failed." };
    const success = { success: true, message: "Deleted." };
    const handlers = fakeHandlers();
    handlers.createCollection = async () => failure;
    handlers.deleteCollection = async () => success;
    const { client } = await connect(undefined, handlers);
    expect(
      await client.callTool({
        name: "create_collection",
        arguments: { name: "Fixture" },
      }),
    ).toEqual({
      content: [{ type: "text", text: JSON.stringify(failure, null, 2) }],
      isError: true,
    });
    expect(
      await client.callTool({
        name: "delete_collection",
        arguments: { collection_id: "fixture" },
      }),
    ).toEqual({
      content: [{ type: "text", text: JSON.stringify(success, null, 2) }],
    });
  });

  test("tools/list advertises every required and optional parameter without empty-schema fallback", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const contracts = [
      { name: "list_collections", required: [], optional: ["limit", "offset"] },
      {
        name: "list_collection_books",
        required: ["collection_id"],
        optional: ["limit", "offset"],
      },
      { name: "get_collection", required: ["collection_id"], optional: [] },
      { name: "list_books", required: [], optional: ["limit", "offset"] },
      { name: "list_all_books", required: [], optional: [] },
      { name: "get_book", required: ["book_id"], optional: [] },
      {
        name: "search_books",
        required: ["query"],
        optional: ["limit", "offset"],
      },
      { name: "list_annotations", required: [], optional: ["limit", "offset"] },
      { name: "get_book_annotations", required: ["book_id"], optional: [] },
      { name: "get_annotation", required: ["annotation_id"], optional: [] },
      {
        name: "get_highlights_by_color",
        required: ["color"],
        optional: ["limit", "offset"],
      },
      {
        name: "search_highlighted_text",
        required: ["text"],
        optional: ["limit", "offset"],
      },
      {
        name: "search_notes",
        required: ["note"],
        optional: ["limit", "offset"],
      },
      {
        name: "full_text_search",
        required: ["text"],
        optional: ["limit", "offset"],
      },
      { name: "recent_annotations", required: [], optional: [] },
      {
        name: "add_book_to_collection",
        required: ["book_id", "collection_id"],
        optional: [],
      },
      {
        name: "remove_book_from_collection",
        required: ["book_id", "collection_id"],
        optional: [],
      },
      { name: "create_collection", required: ["name"], optional: [] },
      { name: "delete_collection", required: ["collection_id"], optional: [] },
      { name: "list_backups", required: [], optional: [] },
      { name: "restore_backup", required: ["handle"], optional: [] },
      {
        name: "update_annotation_note",
        required: ["annotation_id", "note"],
        optional: [],
      },
      { name: "delete_annotation", required: ["annotation_id"], optional: [] },
      {
        name: "export_annotations_markdown",
        required: [],
        optional: ["asset_id"],
      },
    ];
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      contracts.map((tool) => tool.name).sort(),
    );
    for (const { name, required, optional } of contracts) {
      const schema = tools.find((tool) => tool.name === name)?.inputSchema;
      expect(schema?.type).toBe("object");
      expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(
        [...required, ...optional].sort(),
      );
      expect((schema?.required ?? []).toSorted()).toEqual(required.toSorted());
      if (optional.includes("limit")) {
        expect(schema?.properties?.limit).toMatchObject({
          type: "integer",
          minimum: 1,
          maximum: 100,
        });
        expect(schema?.properties?.offset).toMatchObject({
          type: "integer",
          minimum: 0,
        });
      }
    }
    expect(
      tools.find((tool) => tool.name === "get_book")?.inputSchema.properties
        ?.book_id,
    ).toMatchObject({
      type: "string",
      minLength: 1,
      maxLength: 100,
      pattern: "^[a-zA-Z0-9_-]+$",
    });
    expect(
      tools.find((tool) => tool.name === "get_highlights_by_color")?.inputSchema
        .properties?.color,
    ).toMatchObject({ enum: ["green", "blue", "yellow", "pink", "purple"] });
  });

  for (const { name, args } of [
    { name: "list_collections", args: {} },
    { name: "list_collection_books", args: { collection_id: "shelf-1" } },
    { name: "search_books", args: { query: "Fixture" } },
    { name: "search_highlighted_text", args: { text: "Fixture" } },
    { name: "search_notes", args: { note: "Fixture" } },
    { name: "full_text_search", args: { text: "Fixture" } },
  ]) {
    test(`${name} paginates real fixture results without changing its array shape`, async () => {
      const { handlers } = seededHandlers(137);
      const { client } = await connect(undefined, handlers);
      expect(entityArray.parse(await payload(client, name, args))).toHaveLength(
        50,
      );
      const first = entityArray.parse(
        await payload(client, name, { ...args, limit: 100, offset: 0 }),
      );
      const second = entityArray.parse(
        await payload(client, name, { ...args, limit: 100, offset: 100 }),
      );
      expect(first).toHaveLength(100);
      expect(second).toHaveLength(37);
      expect(new Set([...first, ...second].map((row) => row.id)).size).toBe(
        137,
      );
      expect(
        entityArray.parse(
          await payload(client, name, { ...args, limit: 100, offset: 0 }),
        ),
      ).toEqual(first);
      expect(
        entityArray.parse(
          await payload(client, name, { ...args, limit: 1, offset: 1 }),
        ),
      ).toEqual(first.slice(1, 2));
      expect(await payload(client, name, { ...args, offset: 137 })).toEqual([]);
      for (const invalid of [
        { limit: 101 },
        { limit: 0 },
        { limit: 1.5 },
        { offset: -1 },
        { offset: 0.5 },
      ]) {
        expect(
          (await client.callTool({ name, arguments: { ...args, ...invalid } }))
            .isError,
        ).toBe(true);
      }
    });
  }

  test("book annotations share natural-first identity resolution and preserve orphan assets", async () => {
    const { handlers, library, annotations } = seededHandlers();
    seedBook(library, { pk: 1, assetId: "2", title: "Natural numeric asset" });
    seedBook(library, {
      pk: 2,
      assetId: "book-2",
      title: "Internal primary key",
    });
    for (const { pk, assetId } of [
      { pk: 1, assetId: "2" },
      { pk: 2, assetId: "book-2" },
      { pk: 3, assetId: "orphan-asset" },
      { pk: 4, assetId: "2abc" },
      { pk: 5, assetId: "999" },
    ]) {
      seedAnnotation(annotations, { pk, uuid: `note-${pk}`, assetId });
    }
    const { client } = await connect(undefined, handlers);
    for (const { bookId, annotationId } of [
      { bookId: "0002", annotationId: 2 },
      { bookId: "2", annotationId: 1 },
      { bookId: "book-2", annotationId: 2 },
      { bookId: "orphan-asset", annotationId: 3 },
      { bookId: "2abc", annotationId: 4 },
      { bookId: "999", annotationId: 5 },
    ]) {
      expect(
        entityArray.parse(
          await payload(client, "get_book_annotations", { book_id: bookId }),
        ),
      ).toEqual([{ id: annotationId }]);
    }
  });

  test("existing pages and explicit unpaginated exceptions keep their result contracts", async () => {
    const { handlers } = seededHandlers(137);
    const { client } = await connect(undefined, handlers);
    const books = z
      .object({
        books: entityArray,
        total: z.number(),
        limit: z.number(),
        offset: z.number(),
      })
      .strict()
      .parse(await payload(client, "list_books"));
    expect(books).toMatchObject({ total: 137, limit: 50, offset: 0 });
    expect(books.books).toHaveLength(50);
    for (const { name, args } of [
      { name: "list_annotations", args: {} },
      { name: "get_highlights_by_color", args: { color: "green" } },
    ]) {
      const page = z
        .object({
          annotations: entityArray,
          total: z.number(),
          limit: z.number(),
          offset: z.number(),
        })
        .strict()
        .parse(await payload(client, name, args));
      expect(page).toMatchObject({ total: 137, limit: 50, offset: 0 });
      expect(page.annotations).toHaveLength(50);
    }
    expect(
      entityArray.parse(await payload(client, "list_all_books")),
    ).toHaveLength(137);
    expect(
      entityArray.parse(
        await payload(client, "get_book_annotations", { book_id: "book-1" }),
      ),
    ).toHaveLength(137);
    expect(
      entityArray.parse(await payload(client, "recent_annotations")),
    ).toHaveLength(10);
    const exported = z
      .object({ assetId: z.null(), markdown: z.string() })
      .parse(await payload(client, "export_annotations_markdown"));
    expect(exported.markdown.match(/Fixture highlight/g)).toHaveLength(137);
  });
});
