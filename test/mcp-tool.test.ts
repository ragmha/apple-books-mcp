import { describe, expect, test } from "bun:test";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { runTool } from "../src/mcp-tool.ts";
import { MutationError } from "../src/db/library-mutation.ts";

describe("runTool wrapper", () => {
  test("wraps a successful result in MCP text content with pretty JSON", async () => {
    const result = await runTool(
      async (args: { x: number }) => ({ doubled: args.x * 2 }),
      { x: 21 },
    );
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify({ doubled: 42 }, null, 2) }],
    });
  });

  test("translates MutationError into McpError InvalidParams with the verbatim message", async () => {
    let thrown: unknown;
    try {
      await runTool(
        () => {
          throw new MutationError("Book not found: abc");
        },
        {},
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(McpError);
    const err = thrown as McpError;
    expect(err.code).toBe(ErrorCode.InvalidParams);
    expect(err.message).toContain("Book not found: abc");
  });

  test("translates any other thrown error into McpError InternalError WITHOUT leaking the original message (PII guard)", async () => {
    let thrown: unknown;
    try {
      await runTool(
        () => {
          throw new TypeError("constraint failed on title='User Private Note'");
        },
        {},
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(McpError);
    const err = thrown as McpError;
    expect(err.code).toBe(ErrorCode.InternalError);
    expect(err.message).not.toContain("User Private Note");
  });

  test("re-throws an existing McpError unchanged (does not double-wrap)", async () => {
    const original = new McpError(ErrorCode.MethodNotFound, "no such method");
    let thrown: unknown;
    try {
      await runTool(() => {
        throw original;
      }, {});
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(original);
  });

  test("supports synchronous handlers", async () => {
    const result = await runTool((_args: object) => 7, {});
    expect(result.content[0]!.text).toBe("7");
  });
});
