import { describe, expect, test } from "bun:test";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  JSONRPCMessage,
  MessageExtraInfo,
} from "@modelcontextprotocol/sdk/types.js";
import { ToolArgumentsTransport } from "../src/mcp-transport.ts";
import { createServer } from "../src/server.ts";

class RecordingTransport implements Transport {
  onmessage?: Transport["onmessage"];
  onclose?: Transport["onclose"];
  onerror?: Transport["onerror"];
  sessionId = "fixture-session";
  starts = 0;
  closes = 0;
  versions: string[] = [];
  sent: Array<{ message: JSONRPCMessage; options?: TransportSendOptions }> = [];

  async start(): Promise<void> {
    this.starts += 1;
  }

  async send(
    message: JSONRPCMessage,
    options?: TransportSendOptions,
  ): Promise<void> {
    this.sent.push({ message, options });
  }

  async close(): Promise<void> {
    this.closes += 1;
    this.onclose?.();
  }

  setProtocolVersion(version: string): void {
    this.versions.push(version);
  }
}

describe("ToolArgumentsTransport", () => {
  test("normalizes only an omitted own arguments property and preserves metadata", () => {
    const inner = new RecordingTransport();
    const transport = new ToolArgumentsTransport(inner);
    const received: Array<{
      message: JSONRPCMessage;
      extra?: MessageExtraInfo;
    }> = [];
    transport.onmessage = (message, extra) => received.push({ message, extra });
    const message: JSONRPCMessage = Object.freeze({
      jsonrpc: "2.0",
      id: "fixture-request",
      method: "tools/call",
      params: Object.freeze({
        name: "fixture",
        _meta: { progressToken: 7, fixture: "metadata" },
        task: { ttl: 10_000 },
      }),
    });
    const extra: MessageExtraInfo = {
      requestInfo: { headers: { "x-fixture": "metadata" } },
      closeSSEStream: () => {},
      closeStandaloneSSEStream: () => {},
    };

    inner.onmessage?.(message, extra);
    expect(received).toEqual([
      {
        message: { ...message, params: { ...message.params, arguments: {} } },
        extra,
      },
    ]);
    expect(received[0]?.extra).toBe(extra);
    expect(message.params).not.toHaveProperty("arguments");
  });

  test("leaves explicit arguments, malformed calls and unrelated messages untouched", () => {
    const inner = new RecordingTransport();
    const transport = new ToolArgumentsTransport(inner);
    const received: JSONRPCMessage[] = [];
    transport.onmessage = (message) => received.push(message);
    const messages: JSONRPCMessage[] = [
      ...[{}, null, undefined, [], ["invalid"], "invalid", false, 0].map(
        (args): JSONRPCMessage => ({
          jsonrpc: "2.0",
          id: 0,
          method: "tools/call",
          params: { name: "fixture", arguments: args },
        }),
      ),
      { jsonrpc: "2.0", id: 1, method: "tools/call" },
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: {} },
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: 42 } },
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", method: "tools/call", params: { name: "fixture" } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Fixture" } },
    ];
    for (const message of messages) inner.onmessage?.(message);
    for (const [index, message] of messages.entries()) {
      expect(received[index]).toBe(message);
    }
  });

  test("forwards transport methods, send options, session IDs and protocol versions", async () => {
    const inner = new RecordingTransport();
    const transport = new ToolArgumentsTransport(inner);
    const message: JSONRPCMessage = { jsonrpc: "2.0", id: 8, result: {} };
    const options: TransportSendOptions = {
      relatedRequestId: 8,
      resumptionToken: "fixture-token",
      onresumptiontoken: () => {},
    };
    await transport.start();
    await transport.send(message, options);
    expect(inner.starts).toBe(1);
    expect(inner.sent[0]?.message).toBe(message);
    expect(inner.sent[0]?.options).toBe(options);
    expect(transport.sessionId).toBe("fixture-session");
    inner.sessionId = "fixture-updated";
    expect(transport.sessionId).toBe("fixture-updated");
    transport.sessionId = "fixture-through-wrapper";
    expect(inner.sessionId).toBe("fixture-through-wrapper");
    transport.setProtocolVersion?.("fixture-version");
    expect(inner.versions).toEqual(["fixture-version"]);
    await transport.close();
    expect(inner.closes).toBe(1);
  });

  test("preserves callback replacement, clearing and optional version support", () => {
    const inner: Transport = {
      async start() {},
      async send() {},
      async close() {},
    };
    const transport = new ToolArgumentsTransport(inner);
    expect(transport.setProtocolVersion).toBeUndefined();
    const calls: string[] = [];
    transport.onmessage = () => calls.push("old");
    transport.onmessage = () => calls.push("new");
    inner.onmessage?.({ jsonrpc: "2.0", method: "notifications/initialized" });
    transport.onmessage = undefined;
    expect(inner.onmessage).toBeUndefined();
    transport.onclose = () => calls.push("close");
    transport.onerror = () => calls.push("error");
    inner.onclose?.();
    inner.onerror?.(new Error("Fixture"));
    expect(calls).toEqual(["new", "close", "error"]);
    transport.onclose = undefined;
    transport.onerror = undefined;
    expect(inner.onclose).toBeUndefined();
    expect(inner.onerror).toBeUndefined();
  });

  test("composes safely when a caller already adapted the transport", async () => {
    const inner = new RecordingTransport();
    const transport = new ToolArgumentsTransport(
      new ToolArgumentsTransport(inner),
    );
    const messages: JSONRPCMessage[] = [];
    transport.onmessage = (message) => messages.push(message);
    await transport.start();
    inner.onmessage?.({
      jsonrpc: "2.0",
      id: 0,
      method: "tools/call",
      params: { name: "fixture" },
    });
    expect(messages).toEqual([
      {
        jsonrpc: "2.0",
        id: 0,
        method: "tools/call",
        params: { name: "fixture", arguments: {} },
      },
    ]);
    expect(inner.starts).toBe(1);
    await transport.close();
    expect(inner.closes).toBe(1);
  });

  test("the production connect path preserves existing and SDK lifecycle callbacks", async () => {
    const inner = new RecordingTransport();
    const calls: string[] = [];
    inner.onmessage = () => calls.push("existing-message");
    inner.onclose = () => calls.push("existing-close");
    inner.onerror = () => calls.push("existing-error");
    const server = createServer();
    server.server.onclose = () => calls.push("server-close");
    server.server.onerror = () => calls.push("server-error");
    await server.connect(inner);
    inner.onmessage?.({ jsonrpc: "2.0", method: "notifications/initialized" });
    inner.onerror?.(new Error("Fixture"));
    await server.close();
    expect(calls).toEqual([
      "existing-message",
      "existing-error",
      "server-error",
      "existing-close",
      "server-close",
    ]);
    expect(inner.closes).toBe(1);
  });
});
