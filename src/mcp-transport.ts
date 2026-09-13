import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  isJSONRPCRequest,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";

function normalizeToolArguments(message: JSONRPCMessage): JSONRPCMessage {
  if (
    !isJSONRPCRequest(message) ||
    message.method !== "tools/call" ||
    !message.params ||
    typeof message.params.name !== "string" ||
    Object.hasOwn(message.params, "arguments")
  ) {
    return message;
  }
  return { ...message, params: { ...message.params, arguments: {} } };
}

/** Normalize protocol-optional tool arguments without changing tool schemas. */
export class ToolArgumentsTransport implements Transport {
  private messageHandler: Transport["onmessage"];

  constructor(private readonly transport: Transport) {
    this.messageHandler = transport.onmessage;
  }

  get onmessage(): Transport["onmessage"] {
    return this.messageHandler;
  }

  set onmessage(handler: Transport["onmessage"]) {
    this.messageHandler = handler;
    this.transport.onmessage = handler
      ? (message, extra) => handler(normalizeToolArguments(message), extra)
      : undefined;
  }

  get onclose(): Transport["onclose"] {
    return this.transport.onclose;
  }

  set onclose(handler: Transport["onclose"]) {
    this.transport.onclose = handler;
  }

  get onerror(): Transport["onerror"] {
    return this.transport.onerror;
  }

  set onerror(handler: Transport["onerror"]) {
    this.transport.onerror = handler;
  }

  get sessionId(): string | undefined {
    return this.transport.sessionId;
  }

  set sessionId(value: string | undefined) {
    this.transport.sessionId = value;
  }

  get setProtocolVersion(): Transport["setProtocolVersion"] {
    return this.transport.setProtocolVersion?.bind(this.transport);
  }

  start(): Promise<void> {
    return this.transport.start();
  }

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    return this.transport.send(message, options);
  }

  close(): Promise<void> {
    return this.transport.close();
  }
}
