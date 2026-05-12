import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import { MutationError } from "./db/library-mutation.ts";

export type McpContent = {
  content: Array<{ type: "text"; text: string }>;
};

/**
 * Wrap a domain handler so:
 *   - successful results are JSON-serialised into MCP text content
 *   - MutationError becomes McpError(InvalidParams) with the verbatim
 *     message (these are user-facing: "Book not found", etc.)
 *   - any other thrown error becomes McpError(InternalError) with a
 *     sanitised message — the original is logged to stderr but never
 *     surfaced to the client (it may contain user PII from SQLite
 *     constraint messages)
 *   - existing McpError instances are re-thrown unchanged
 *
 * Without this wrapper, an exception inside a tool handler would crash the
 * stdio transport, breaking the MCP session.
 */
export async function runTool<A, R>(
  handler: (args: A) => Promise<R> | R,
  args: A,
): Promise<McpContent> {
  try {
    const result = await handler(args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    if (error instanceof McpError) throw error;
    if (error instanceof MutationError) {
      throw new McpError(ErrorCode.InvalidParams, error.message);
    }
    console.error("MCP tool error:", error);
    throw new McpError(ErrorCode.InternalError, "Operation failed.");
  }
}

/**
 * Sugar over `server.tool` that routes through `runTool`. Drop-in
 * replacement for the existing `server.tool(name, description, schema, fn)`
 * pattern, except `fn` returns the raw domain object — the wrapper handles
 * MCP serialisation and McpError translation.
 *
 * The SDK's `tool` method has six overloads which TS cannot disambiguate
 * when our wrapped callback returns `McpContent`; the bridge cast on the
 * inner callback is the necessary indirection. Schema-driven argument
 * validation happens in the SDK before our handler runs, so the runtime
 * types are sound even though TS can't see it from the cast site.
 */
export function mcpTool<S extends ZodRawShape, A, R>(
  server: McpServer,
  name: string,
  description: string,
  schema: S,
  handler: (args: A) => Promise<R> | R,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = server.tool.bind(server) as any;
  tool(name, description, schema, (args: A) => runTool(handler, args));
}
