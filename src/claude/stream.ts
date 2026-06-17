interface StreamTranslationOptions {
  model: string;
  signal?: AbortSignal;
  onFinish?: (finish: "stop" | "tool_calls" | string) => void;
  onUnhandledEvent?: (eventType: string) => void;
}

const HANDLED_ANTHROPIC_EVENTS = new Set([
  "message_start",
  "content_block_delta",
  "content_block_start",
  "content_block_stop",
  "message_delta",
  "message_stop",
]);

interface ToolStreamState {
  byIndex: Map<number, { id: string; name: string; args: string }>;
  hadToolCall: boolean;
  stopReason: string | null;
}

function indexOfDoubleNewline(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

function extractSseEvent(rawEvent: string): { event: string; data: string } {
  const lines = rawEvent.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).replace(/^ /, "");
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  return { event, data: dataLines.join("\n").trim() };
}

export async function translateAnthropicSseToResponses(
  upstream: Response,
  options: StreamTranslationOptions = { model: "claude" },
): Promise<Response> {
  const body = upstream.body;
  if (!body) {
    return Response.json(
      { error: { message: "upstream returned empty body", type: "server_error" } },
      { status: 502 },
    );
  }

  const sseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let messageId = `resp_${crypto.randomUUID()}`;
      const tools: ToolStreamState = {
        byIndex: new Map(),
        hadToolCall: false,
        stopReason: null,
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sep: number;
          while ((sep = indexOfDoubleNewline(buffer)) !== -1) {
            const rawEvent = buffer.slice(0, sep);
            buffer = buffer.slice(sep + (buffer[sep] === "\r" ? 4 : 2));
            const { event, data } = extractSseEvent(rawEvent);
            if (!data || data === "[DONE]") continue;

            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(data) as Record<string, unknown>;
            } catch {
              continue;
            }

            if (!HANDLED_ANTHROPIC_EVENTS.has(event)) {
              options.onUnhandledEvent?.(event);
            }

            const formatted = formatResponsesEvent(event, parsed, messageId, tools, options);
            if (formatted) {
              if (formatted.updateId) messageId = formatted.updateId;
              controller.enqueue(encoder.encode(formatted.chunk));
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              error: { message, type: "server_error", code: null },
            })}\n\n`,
          ),
        );
      } finally {
        reader.releaseLock();
        controller.close();
      }
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

function formatResponsesEvent(
  event: string,
  data: Record<string, unknown>,
  messageId: string,
  tools: ToolStreamState,
  options: StreamTranslationOptions,
): { chunk: string; updateId?: string } | null {
  if (event === "message_start") {
    const message = data.message as Record<string, unknown> | undefined;
    const id = typeof message?.id === "string" ? message.id : messageId;
    return {
      updateId: id,
      chunk: `data: ${JSON.stringify({
        type: "response.created",
        response: { id },
      })}\n\n`,
    };
  }

  if (event === "content_block_delta") {
    const delta = data.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return {
        chunk: `data: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: delta.text,
        })}\n\n`,
      };
    }
    if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
      const index = typeof data.index === "number" ? data.index : null;
      const tool = index === null ? null : tools.byIndex.get(index);
      if (!tool) return null;
      tool.args += delta.partial_json;
      return {
        chunk: `data: ${JSON.stringify({
          type: "response.function_call_arguments.delta",
          item_id: tool.id,
          delta: delta.partial_json,
        })}\n\n`,
      };
    }
  }

  if (event === "content_block_start") {
    const index = typeof data.index === "number" ? data.index : null;
    const block = data.content_block as Record<string, unknown> | undefined;
    if (index !== null && block?.type === "tool_use") {
      const id = typeof block.id === "string" ? block.id : `toolu_${crypto.randomUUID()}`;
      const name = typeof block.name === "string" ? block.name : "tool";
      tools.byIndex.set(index, { id, name, args: "" });
      tools.hadToolCall = true;
      return {
        chunk: `data: ${JSON.stringify({
          type: "response.output_item.added",
          output_index: index,
          item: {
            id,
            type: "function_call",
            call_id: id,
            name,
            arguments: "",
          },
        })}\n\n`,
      };
    }
  }

  if (event === "content_block_stop") {
    const index = typeof data.index === "number" ? data.index : null;
    const tool = index === null ? null : tools.byIndex.get(index);
    if (!tool) return null;
    return {
      chunk: `data: ${JSON.stringify({
        type: "response.output_item.done",
        output_index: index,
        item: {
          id: tool.id,
          type: "function_call",
          call_id: tool.id,
          name: tool.name,
          arguments: tool.args,
        },
      })}\n\n`,
    };
  }

  if (event === "message_delta") {
    const delta = data.delta as Record<string, unknown> | undefined;
    if (typeof delta?.stop_reason === "string") {
      tools.stopReason = delta.stop_reason;
    }
  }

  if (event === "message_stop") {
    options.onFinish?.(toOpenAiFinishReason(toAnthropicStopReason(tools)));
    return {
      chunk: `data: ${JSON.stringify({
        type: "response.completed",
        response: { id: messageId, status: "completed" },
      })}\n\n`,
    };
  }

  return null;
}

export async function translateAnthropicSseToChat(
  upstream: Response,
  options: StreamTranslationOptions,
): Promise<Response> {
  const body = upstream.body;
  if (!body) {
    return Response.json(
      { error: { message: "upstream returned empty body", type: "server_error" } },
      { status: 502 },
    );
  }

  const state = {
    id: `chatcmpl-${crypto.randomUUID()}`,
    created: Math.floor(Date.now() / 1000),
    model: options.model,
    sentRole: false,
    tools: new Map<number, { id: string; name: string; args: string }>(),
    hadToolCall: false,
    stopReason: null as string | null,
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
            const { event, data } = extractSseEvent(rawEvent);
            if (!data || data === "[DONE]") continue;

            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(data) as Record<string, unknown>;
            } catch {
              continue;
            }

            if (!HANDLED_ANTHROPIC_EVENTS.has(event)) {
              options.onUnhandledEvent?.(event);
            }

            const formatted = formatChatEvent(event, parsed, state, options);
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

function formatChatEvent(
  event: string,
  data: Record<string, unknown>,
  state: {
    id: string;
    created: number;
    model: string;
    sentRole: boolean;
    tools: Map<number, { id: string; name: string; args: string }>;
    hadToolCall: boolean;
    stopReason: string | null;
  },
  options: StreamTranslationOptions,
): string | null {
  if (event === "content_block_start") {
    const index = typeof data.index === "number" ? data.index : null;
    const block = data.content_block as Record<string, unknown> | undefined;
    if (index !== null && block?.type === "tool_use") {
      const id = typeof block.id === "string" ? block.id : `toolu_${crypto.randomUUID()}`;
      const name = typeof block.name === "string" ? block.name : "tool";
      state.tools.set(index, { id, name, args: "" });
      state.hadToolCall = true;
      return (
        formatAssistantRoleChunk(state) +
        formatChatCompletionChunk(
          state,
          {
            tool_calls: [
              {
                index,
                id,
                type: "function",
                function: { name, arguments: "" },
              },
            ],
          },
          null,
        )
      );
    }
  }

  if (event === "content_block_delta") {
    const delta = data.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return (
        formatAssistantRoleChunk(state) +
        formatChatCompletionChunk(state, { content: delta.text }, null)
      );
    }
    if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
      const index = typeof data.index === "number" ? data.index : null;
      const tool = index === null ? null : state.tools.get(index);
      if (!tool) return null;
      tool.args += delta.partial_json;
      return formatChatCompletionChunk(
        state,
        { tool_calls: [{ index, function: { arguments: delta.partial_json } }] },
        null,
      );
    }
  }

  if (event === "message_delta") {
    const delta = data.delta as Record<string, unknown> | undefined;
    if (typeof delta?.stop_reason === "string") {
      state.stopReason = delta.stop_reason;
    }
  }

  if (event === "message_stop") {
    const finish = toOpenAiFinishReason(state.stopReason ?? toAnthropicStopReason(state));
    options.onFinish?.(finish);
    return (
      formatAssistantRoleChunk(state) +
      formatChatCompletionChunk(state, {}, finish)
    );
  }

  return null;
}

function toOpenAiFinishReason(stopReason: string): string {
  if (stopReason === "end_turn") return "stop";
  if (stopReason === "tool_use") return "tool_calls";
  return stopReason;
}

function toAnthropicStopReason(state: { stopReason: string | null; hadToolCall: boolean }): string {
  return state.stopReason ?? (state.hadToolCall ? "tool_use" : "end_turn");
}

function formatAssistantRoleChunk(state: {
  id: string;
  created: number;
  model: string;
  sentRole: boolean;
}): string {
  if (state.sentRole) return "";
  state.sentRole = true;
  return formatChatCompletionChunk(state, { role: "assistant", content: "" }, null);
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
