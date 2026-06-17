import { EdgeRequestError } from "../edge/errors.ts";

type InputItem = Record<string, unknown>;
type InputContentPart = Record<string, unknown>;

const DATA_URL_RE = /^data:([^;,]+);base64,(.+)$/;

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function contentPartsFromOpenAi(content: unknown): string | InputContentPart[] {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: InputContentPart[] = [];
  for (const part of content) {
    const record = readRecord(part);
    if (!record) continue;
    const type = readString(record.type);
    if ((type === "text" || type === "input_text") && typeof record.text === "string") {
      parts.push({ type: "input_text", text: record.text });
      continue;
    }
    if (type === "output_text" && typeof record.text === "string") {
      parts.push({ type: "output_text", text: record.text });
      continue;
    }
    if (type === "input_image" || type === "image_url") {
      parts.push(imagePartFromOpenAi(record));
    }
  }
  return parts.length > 0 ? parts : "";
}

function textFromContent(content: string | InputContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

function imagePartFromOpenAi(record: Record<string, unknown>): InputContentPart {
  const imageUrl = readRecord(record.image_url);
  const url = readString(imageUrl?.url) ?? readString(record.image_url) ?? readString(record.url);
  if (url) {
    return imagePartFromUrl(url);
  }

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
    return { type: "input_image", image_url: `data:${mediaType};base64,${data}` };
  }

  throw new EdgeRequestError(
    "unsupported image content part: expected image_url.url, url, data URL, or base64 data",
  );
}

function imagePartFromUrl(url: string): InputContentPart {
  const match = DATA_URL_RE.exec(url);
  if (match) {
    return { type: "input_image", image_url: url };
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return { type: "input_image", image_url: url };
  }
  throw new EdgeRequestError(`unsupported image URL for Codex request: ${url}`);
}

function chatMessagesToInput(messages: unknown[]): InputItem[] {
  const input: InputItem[] = [];

  for (const item of messages) {
    const msg = readRecord(item);
    if (!msg) continue;

    const role = readString(msg.role);
    if (role === "system" || role === "developer") {
      input.push({ role, content: textFromContent(contentPartsFromOpenAi(msg.content)) });
      continue;
    }

    if (role === "assistant") {
      const content = contentPartsFromOpenAi(msg.content);
      const text = textFromContent(content);
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      const legacyCall = readRecord(msg.function_call);

      if (text || (toolCalls.length === 0 && !legacyCall)) {
        input.push({ role: "assistant", content: text });
      }

      for (const tc of toolCalls) {
        const call = readRecord(tc);
        const fn = readRecord(call?.function);
        if (!call || !fn) continue;
        input.push({
          type: "function_call",
          call_id: readString(call.id) ?? crypto.randomUUID(),
          name: readString(fn.name) ?? "tool",
          arguments: readString(fn.arguments) ?? "{}",
        });
      }

      if (legacyCall) {
        const name = readString(legacyCall.name) ?? "tool";
        input.push({
          type: "function_call",
          call_id: `fc_${name}`,
          name,
          arguments: readString(legacyCall.arguments) ?? "{}",
        });
      }
      continue;
    }

    if (role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: readString(msg.tool_call_id) ?? "unknown",
        output: textFromContent(contentPartsFromOpenAi(msg.content)),
      });
      continue;
    }

    if (role === "function") {
      const name = readString(msg.name) ?? "unknown";
      input.push({
        type: "function_call_output",
        call_id: `fc_${name}`,
        output: textFromContent(contentPartsFromOpenAi(msg.content)),
      });
      continue;
    }

    if (role === "user") {
      input.push({ role: "user", content: contentPartsFromOpenAi(msg.content) });
    }
  }

  if (input.length === 0) {
    input.push({ role: "user", content: "" });
  }

  return input;
}

function normalizeCodexInputItem(item: unknown): InputItem {
  const record = readRecord(item);
  if (!record) return {};

  const itemType = readString(record.type);
  if (itemType && itemType !== "message" && !record.role) {
    return record;
  }

  const role = readString(record.role);
  if (!role || !record.content) {
    return record;
  }

  if (typeof record.content === "string") {
    return record;
  }

  if (!Array.isArray(record.content)) {
    return record;
  }

  const normalized = contentPartsFromOpenAi(record.content);
  return {
    ...record,
    content: normalized,
  };
}

function normalizeCodexInputArray(input: unknown[]): InputItem[] {
  return input.map((item) => normalizeCodexInputItem(item));
}

/**
 * Normalize a Codex edge request body into Responses-shaped `input` when the
 * client sent chat `messages` instead of an `input` array.
 */
export function normalizeCodexEdgeBody(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (Array.isArray(raw.input)) {
    return {
      ...raw,
      input: normalizeCodexInputArray(raw.input),
    };
  }
  if (!Array.isArray(raw.messages)) {
    return raw;
  }

  const { messages, ...rest } = raw;
  return {
    ...rest,
    input: chatMessagesToInput(messages),
  };
}
