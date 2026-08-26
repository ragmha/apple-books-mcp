import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "../src/server.ts";

let client: Client | undefined;
let server: McpServer | undefined;

afterEach(async () => {
  await client?.close();
  await server?.close();
  client = undefined;
  server = undefined;
});

describe("MCP tool catalog", () => {
  test("exposes create_annotation with the coordinates required for an anchored highlight", async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    server = createServer();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const catalog = await client.listTools();
    const tool = catalog.tools.find(
      (candidate) => candidate.name === "create_annotation",
    );

    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(
      expect.arrayContaining([
        "book_id",
        "selected_text",
        "location",
        "absolute_physical_location",
        "range_start",
        "range_end",
      ]),
    );
  });
});
