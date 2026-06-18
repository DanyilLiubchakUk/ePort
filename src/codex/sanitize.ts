const RESPONSES_ALLOWED_FIELDS = new Set([
  "model",
  "instructions",
  "input",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "reasoning",
  "store",
  "stream",
  "include",
  "service_tier",
  "prompt_cache_key",
  "text",
  "client_metadata",
]);

export interface SanitizeCodexRequestOptions {
  installationId: string;
  canonicalModelId: string;
  effort: string | null;
  fastTier: boolean;
}

export function resolvePromptCacheKey(
  body: Record<string, unknown>,
  installationId: string,
): string {
  const key = body.prompt_cache_key;
  if (typeof key === "string" && key.trim().length > 0) {
    return key.trim();
  }
  return installationId;
}

export function sanitizeCodexRequest(
  raw: Record<string, unknown>,
  options: SanitizeCodexRequestOptions,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (RESPONSES_ALLOWED_FIELDS.has(key)) {
      out[key] = value;
    }
  }

  const lifted = liftSystemInstructions(out.input, out.instructions);
  out.input = lifted.input;
  if (lifted.instructions) {
    out.instructions = lifted.instructions;
  }

  out.model = options.canonicalModelId;
  out.store = false;
  out.stream = true;
  out.prompt_cache_key = resolvePromptCacheKey(out, options.installationId);

  const reasoning = {
    ...(readRecord(out.reasoning) ?? {}),
  };
  if (options.effort) {
    reasoning.effort = options.effort;
  }
  if (Object.keys(reasoning).length > 0) {
    out.reasoning = reasoning;
  }

  if (options.fastTier) {
    out.service_tier = "priority";
  } else if (typeof out.service_tier !== "string") {
    delete out.service_tier;
  }

  const include = Array.isArray(out.include) ? [...out.include] : [];
  if (!include.includes("reasoning.encrypted_content")) {
    include.push("reasoning.encrypted_content");
  }
  out.include = include;

  if (typeof out.parallel_tool_calls !== "boolean") {
    out.parallel_tool_calls = true;
  }

  return out;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function liftSystemInstructions(
  input: unknown,
  existingInstructions: unknown,
): { input: unknown[]; instructions: string } {
  const items = Array.isArray(input) ? (input as Record<string, unknown>[]) : [];
  const systemText: string[] = [];
  const remaining: Record<string, unknown>[] = [];

  for (const item of items) {
    const role = item?.role;
    const isSystem =
      (item?.type === "message" || item?.type === undefined) &&
      (role === "system" || role === "developer");
    if (isSystem) {
      const text = stringifyResponsesContent(item.content);
      if (text) systemText.push(text);
      continue;
    }
    remaining.push(item);
  }

  const baseInstructions =
    typeof existingInstructions === "string" ? existingInstructions : "";
  const combined = [baseInstructions, ...systemText]
    .filter((value) => value && value.trim().length > 0)
    .join("\n\n");

  return { input: remaining, instructions: combined };
}

function stringifyResponsesContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    const record = part as Record<string, unknown>;
    if (typeof record?.text === "string") {
      parts.push(record.text);
    }
  }
  return parts.join("");
}
