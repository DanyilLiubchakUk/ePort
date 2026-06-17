import { EdgeRequestError } from "../edge/errors.ts";

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "url"; url: string } | { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface NormalizedClaudeMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface NormalizedClaudeRequest {
  messages: NormalizedClaudeMessage[];
  system?: string;
  stream: boolean;
  tools?: unknown[];
  toolChoice?: unknown;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

const DATA_URL_RE = /^data:([^;,]+);base64,(.+)$/;

function partFromOpenAi(value: unknown): AnthropicContentBlock | null {
  const record = readRecord(value);
  if (!record) return null;
  const type = readString(record.type);
  if (type === "text" || type === "input_text") {
    const text = readString(record.text);
    return text ? { type: "text", text } : null;
  }
  if (type === "input_image" || type === "image_url") {
    const imageUrl = readRecord(record.image_url);
    const url = readString(imageUrl?.url) ?? readString(record.image_url) ?? readString(record.url);
    if (url) return imageBlockFromUrl(url);

    const mediaType =
      readString(record.media_type) ??
      readString(record.mime_type) ??
      readString(imageUrl?.media_type) ??
      "image/png";
    const data =
      readString(record.data) ??
      readString(record.base64) ??
      readString(record.b64_json) ??
      readString(imageUrl?.data);
    if (data) {
      return { type: "image", source: { type: "base64", media_type: mediaType, data } };
    }

    throw new EdgeRequestError(
      "unsupported image content part: expected image_url.url, url, data URL, or base64 data",
    );
  }
  return null;
}

function imageBlockFromUrl(url: string): AnthropicContentBlock {
  const match = DATA_URL_RE.exec(url);
  if (match) {
    return {
      type: "image",
      source: { type: "base64", media_type: match[1], data: match[2] },
    };
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return { type: "image", source: { type: "url", url } };
  }
  throw new EdgeRequestError(`unsupported image URL for Claude request: ${url}`);
}

function contentFromItem(content: unknown): string | AnthropicContentBlock[] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const blocks = content
    .map((part) => partFromOpenAi(part))
    .filter((part): part is AnthropicContentBlock => part !== null);
  return blocks.length > 0 ? blocks : "";
}

function parseToolInput(argumentsJson: unknown): unknown {
  const args = readString(argumentsJson);
  if (!args) return {};
  try {
    return JSON.parse(args) as unknown;
  } catch {
    return {};
  }
}

function appendBlock(
  messages: NormalizedClaudeMessage[],
  role: "user" | "assistant",
  block: AnthropicContentBlock,
): void {
  const last = messages.at(-1);
  if (last?.role === role && Array.isArray(last.content)) {
    last.content.push(block);
  } else {
    messages.push({ role, content: [block] });
  }
}

function normalizeInputArray(input: unknown[]): NormalizedClaudeRequest {
  const messages: NormalizedClaudeMessage[] = [];
  const systemParts: string[] = [];

  for (const item of input) {
    const record = readRecord(item);
    if (!record) continue;

    const role = readString(record.role);
    if (role === "system" || role === "developer") {
      const text = contentFromItem(record.content);
      if (typeof text === "string" && text.trim()) {
        systemParts.push(text.trim());
      }
      continue;
    }

    if (role === "user" || role === "assistant") {
      messages.push({
        role,
        content: contentFromItem(record.content),
      });
      continue;
    }

    if (record.type === "function_call") {
      const callId = readString(record.call_id) ?? crypto.randomUUID();
      const name = readString(record.name) ?? "tool";
      const toolUse: AnthropicContentBlock = {
        type: "tool_use",
        id: callId,
        name,
        input: parseToolInput(record.arguments),
      };
      appendBlock(messages, "assistant", toolUse);
      continue;
    }

    if (record.type === "function_call_output") {
      const callId = readString(record.call_id) ?? "";
      const output = readString(record.output) ?? "";
      const toolResult: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: callId,
        content: output,
      };
      appendBlock(messages, "user", toolResult);
    }
  }

  return {
    messages: messages.length > 0 ? messages : [{ role: "user", content: "" }],
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    stream: true,
  };
}

function normalizeMessagesArray(messages: unknown[]): NormalizedClaudeRequest {
  const normalized: NormalizedClaudeMessage[] = [];
  const systemParts: string[] = [];

  for (const item of messages) {
    const record = readRecord(item);
    if (!record) continue;
    const role = readString(record.role);
    if (role === "system" || role === "developer") {
      const text = contentFromItem(record.content);
      if (typeof text === "string" && text.trim()) {
        systemParts.push(text.trim());
      }
      continue;
    }
    if (role === "user" || role === "assistant") {
      const content = contentFromItem(record.content);
      const toolCalls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
      if (role === "assistant" && toolCalls.length > 0) {
        const blocks: AnthropicContentBlock[] = [];
        if (typeof content === "string" && content.length > 0) {
          blocks.push({ type: "text", text: content });
        } else if (Array.isArray(content)) {
          blocks.push(...content);
        }
        for (const toolCall of toolCalls) {
          const tc = readRecord(toolCall);
          const fn = readRecord(tc?.function);
          const id = readString(tc?.id) ?? crypto.randomUUID();
          blocks.push({
            type: "tool_use",
            id,
            name: readString(fn?.name) ?? "tool",
            input: parseToolInput(fn?.arguments),
          });
        }
        normalized.push({ role, content: blocks });
      } else {
        normalized.push({ role, content });
      }
      continue;
    }
    if (role === "tool") {
      appendBlock(normalized, "user", {
        type: "tool_result",
        tool_use_id: readString(record.tool_call_id) ?? "",
        content: readString(record.content) ?? "",
      });
    }
  }

  return {
    messages:
      normalized.length > 0 ? normalized : [{ role: "user", content: "" }],
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    stream: true,
  };
}

export function normalizeEdgeBody(body: Record<string, unknown>): NormalizedClaudeRequest {
  const stream = body.stream !== false;
  const tools = Array.isArray(body.tools) ? body.tools : undefined;
  const toolChoice = body.tool_choice;

  let normalized: NormalizedClaudeRequest;
  if (Array.isArray(body.input)) {
    normalized = normalizeInputArray(body.input);
  } else if (Array.isArray(body.messages)) {
    normalized = normalizeMessagesArray(body.messages);
  } else {
    normalized = { messages: [{ role: "user", content: "" }], stream: true };
  }

  if (typeof body.instructions === "string" && body.instructions.trim()) {
    normalized.system = normalized.system
      ? `${normalized.system}\n\n${body.instructions.trim()}`
      : body.instructions.trim();
  }

  normalized.stream = stream;
  if (tools) normalized.tools = tools;
  if (toolChoice !== undefined) normalized.toolChoice = toolChoice;
  return normalized;
}
