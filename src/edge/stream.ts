export function passthroughSseResponse(
  upstream: Response,
  _signal?: AbortSignal,
): Response {
  const headers = new Headers(upstream.headers);
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-cache, no-transform");
  headers.set("connection", "keep-alive");
  headers.set("x-accel-buffering", "no");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

interface ChatTranslationOptions {
  model: string;
  signal?: AbortSignal;
}

interface ChatCompletionStreamState {
  id: string;
  created: number;
  model: string;
  sentRole: boolean;
  toolCalls: Map<string, { slot: number; argsLen: number; callId: string; name: string }>;
  nextSlot: number;
  hadToolCall: boolean;
}

export async function translateResponsesSseToChat(
  upstream: Response,
  options: ChatTranslationOptions,
): Promise<Response> {
  const body = upstream.body;
  if (!body) {
    return Response.json(
      { error: { message: "upstream returned empty body", type: "server_error" } },
      { status: 502 },
    );
  }

  const state: ChatCompletionStreamState = {
    id: `chatcmpl-${crypto.randomUUID()}`,
    created: Math.floor(Date.now() / 1000),
    model: options.model,
    sentRole: false,
    toolCalls: new Map(),
    nextSlot: 0,
    hadToolCall: false,
  };

  const sseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sep: number;
          while ((sep = indexOfDoubleNewline(buffer)) !== -1) {
            const rawEvent = buffer.slice(0, sep);
            buffer = buffer.slice(sep + (buffer[sep] === "\r" ? 4 : 2));
            const event = parseSseEvent(rawEvent);
            if (!event) continue;

            const formatted = formatChatCompletionEvent(event, state);
            if (formatted) {
              controller.enqueue(encoder.encode(formatted));
            }
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              error: { message, type: "server_error", code: null },
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
    cancel() {
      options.signal?.dispatchEvent(new Event("abort"));
    },
  });

  return new Response(sseStream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

function parseSseEvent(rawEvent: string): Record<string, unknown> | null {
  const { eventType, payload } = extractSseEvent(rawEvent);
  if (!payload || payload === "[DONE]") return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (typeof parsed.type !== "string" && eventType) {
    parsed.type = eventType;
  }

  return parsed;
}

function formatChatCompletionEvent(
  event: Record<string, unknown>,
  state: ChatCompletionStreamState,
): string | null {
  updateChatCompletionState(event, state);

  switch (event.type) {
    case "response.created":
      return formatAssistantRoleChunk(state);

    case "response.output_text.delta": {
      const delta = event.delta;
      if (typeof delta !== "string" || delta.length === 0) return null;
      return (
        formatAssistantRoleChunk(state) +
        formatChatCompletionChunk(state, { content: delta }, null)
      );
    }

    case "response.output_item.added": {
      const toolStart = formatToolCallStart(event, state);
      if (toolStart) return toolStart;

      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type === "reasoning") {
        const encrypted = item.encrypted_content;
        if (typeof encrypted === "string" && encrypted.length > 0) {
          return formatAssistantRoleChunk(state);
        }
      }
      return null;
    }

    case "response.function_call_arguments.delta":
    case "response.custom_tool_call_input.delta":
      return formatToolCallArgsDelta(event, state);

    case "response.output_item.done":
      return formatToolCallDone(event, state);

    case "response.completed":
      return (
        formatAssistantRoleChunk(state) +
        formatChatCompletionChunk(state, {}, state.hadToolCall ? "tool_calls" : "stop")
      );

    default:
      return null;
  }
}

function updateChatCompletionState(
  event: Record<string, unknown>,
  state: ChatCompletionStreamState,
): void {
  const response = event.response as Record<string, unknown> | undefined;
  const responseId =
    typeof response?.id === "string"
      ? response.id
      : typeof event.response_id === "string"
        ? event.response_id
        : null;
  if (responseId) state.id = responseId;

  if (typeof response?.model === "string") state.model = response.model;

  const createdAt = response?.created_at;
  if (typeof createdAt === "number" && Number.isFinite(createdAt)) {
    state.created = Math.floor(createdAt);
  }
}

function formatAssistantRoleChunk(state: ChatCompletionStreamState): string {
  if (state.sentRole) return "";
  state.sentRole = true;
  return formatChatCompletionChunk(state, { role: "assistant", content: "" }, null);
}

function formatToolCallStart(
  event: Record<string, unknown>,
  state: ChatCompletionStreamState,
): string | null {
  const item = event.item as Record<string, unknown> | undefined;
  const itemType = item?.type;
  if (!item || (itemType !== "function_call" && itemType !== "custom_tool_call")) return null;

  const itemId = typeof item.id === "string" ? item.id : null;
  if (!itemId || state.toolCalls.has(itemId)) return null;

  const slot = state.nextSlot++;
  const callId = typeof item.call_id === "string" ? item.call_id : itemId;
  const name = typeof item.name === "string" ? item.name : "";
  state.toolCalls.set(itemId, { slot, argsLen: 0, callId, name });
  state.hadToolCall = true;

  return (
    formatAssistantRoleChunk(state) +
    formatChatCompletionChunk(
      state,
      {
        tool_calls: [
          {
            index: slot,
            id: callId,
            type: "function",
            function: { name, arguments: "" },
          },
        ],
      },
      null,
    )
  );
}

function formatToolCallArgsDelta(
  event: Record<string, unknown>,
  state: ChatCompletionStreamState,
): string | null {
  const delta = event.delta;
  if (typeof delta !== "string" || delta.length === 0) return null;

  const itemId =
    typeof event.item_id === "string"
      ? event.item_id
      : typeof event.call_id === "string"
        ? event.call_id
        : null;
  if (!itemId) return null;

  const tc = state.toolCalls.get(itemId);
  if (!tc) return null;

  tc.argsLen += delta.length;
  return formatChatCompletionChunk(
    state,
    { tool_calls: [{ index: tc.slot, function: { arguments: delta } }] },
    null,
  );
}

function formatToolCallDone(
  event: Record<string, unknown>,
  state: ChatCompletionStreamState,
): string | null {
  const item = event.item as Record<string, unknown> | undefined;
  const itemType = item?.type;
  if (!item || (itemType !== "function_call" && itemType !== "custom_tool_call")) return null;

  const itemId = typeof item.id === "string" ? item.id : null;
  if (!itemId) return null;

  const tc = state.toolCalls.get(itemId);
  if (!tc || tc.argsLen > 0) return null;

  const args = itemType === "custom_tool_call" ? item.input : item.arguments;
  if (typeof args !== "string" || args.length === 0) return null;

  tc.argsLen = args.length;
  return formatChatCompletionChunk(
    state,
    { tool_calls: [{ index: tc.slot, function: { arguments: args } }] },
    null,
  );
}

function formatChatCompletionChunk(
  state: { id: string; created: number; model: string },
  delta: Record<string, unknown>,
  finishReason: string | null,
): string {
  return `data: ${JSON.stringify({
    id: state.id,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model,
    choices: [
      {
        index: 0,
        delta,
        logprobs: null,
        finish_reason: finishReason,
      },
    ],
  })}\n\n`;
}

function indexOfDoubleNewline(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

function extractSseEvent(rawEvent: string): { eventType: string; payload: string } {
  const lines = rawEvent.split(/\r?\n/);
  let eventType = "";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).replace(/^ /, "");
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  return { eventType, payload: dataLines.join("\n").trim() };
}
