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
            const payload = extractDataPayload(rawEvent);
            if (!payload || payload === "[DONE]") continue;

            let event: Record<string, unknown>;
            try {
              event = JSON.parse(payload) as Record<string, unknown>;
            } catch {
              continue;
            }

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

function formatChatCompletionEvent(
  event: Record<string, unknown>,
  state: {
    id: string;
    created: number;
    model: string;
    sentRole: boolean;
  },
): string | null {
  if (event.type === "response.created") {
    return formatAssistantRoleChunk(state);
  }

  if (event.type === "response.output_text.delta") {
    const delta = event.delta;
    if (typeof delta !== "string" || delta.length === 0) return null;
    return (
      formatAssistantRoleChunk(state) +
      formatChatCompletionChunk(state, { content: delta }, null)
    );
  }

  if (event.type === "response.completed") {
    return (
      formatAssistantRoleChunk(state) +
      formatChatCompletionChunk(state, {}, "stop")
    );
  }

  if (event.type === "response.output_item.added") {
    const item = event.item as Record<string, unknown> | undefined;
    if (item?.type === "reasoning") {
      const encrypted = item.encrypted_content;
      if (typeof encrypted === "string" && encrypted.length > 0) {
        return formatAssistantRoleChunk(state);
      }
    }
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

function indexOfDoubleNewline(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

function extractDataPayload(rawEvent: string): string {
  const lines = rawEvent.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  return dataLines.join("\n").trim();
}
