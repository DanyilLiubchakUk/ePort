type InputItem = Record<string, unknown>;

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function extractText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    const record = readRecord(part);
    if (!record) continue;
    const type = readString(record.type);
    if ((type === "text" || type === "input_text") && typeof record.text === "string") {
      parts.push(record.text);
    }
  }
  return parts.join("\n");
}

function chatMessagesToInput(messages: unknown[]): InputItem[] {
  const input: InputItem[] = [];

  for (const item of messages) {
    const msg = readRecord(item);
    if (!msg) continue;

    const role = readString(msg.role);
    if (role === "system" || role === "developer") {
      input.push({ role, content: extractText(msg.content) });
      continue;
    }

    if (role === "assistant") {
      const text = extractText(msg.content);
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
        output: extractText(msg.content),
      });
      continue;
    }

    if (role === "function") {
      const name = readString(msg.name) ?? "unknown";
      input.push({
        type: "function_call_output",
        call_id: `fc_${name}`,
        output: extractText(msg.content),
      });
      continue;
    }

    if (role === "user") {
      input.push({ role: "user", content: extractText(msg.content) });
    }
  }

  if (input.length === 0) {
    input.push({ role: "user", content: "" });
  }

  return input;
}

/**
 * Normalize a Codex edge request body into Responses-shaped `input` when the
 * client sent chat `messages` instead of an `input` array.
 */
export function normalizeCodexEdgeBody(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (Array.isArray(raw.input)) {
    return raw;
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
