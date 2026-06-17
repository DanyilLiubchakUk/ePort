interface StreamTranslationOptions {
  model: string;
  signal?: AbortSignal;
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
  _options: StreamTranslationOptions = { model: "claude" },
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

            const formatted = formatResponsesEvent(event, parsed, messageId);
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
  }

  if (event === "message_stop") {
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

            const formatted = formatChatEvent(event, parsed, state);
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
  },
): string | null {
  if (event === "content_block_delta") {
    const delta = data.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return (
        formatAssistantRoleChunk(state) +
        formatChatCompletionChunk(state, { content: delta.text }, null)
      );
    }
  }

  if (event === "message_stop") {
    return (
      formatAssistantRoleChunk(state) +
      formatChatCompletionChunk(state, {}, "stop")
    );
  }

  return null;
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
