import type { ResolvedRoute } from "../resolver/types.ts";
import { defaultMaxTokens, mapEffortToAnthropicThinking } from "./effort.ts";
import type { NormalizedClaudeRequest } from "./normalize.ts";

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  messages: NormalizedClaudeRequest["messages"];
  system?: string;
  stream: boolean;
  tools?: unknown[];
  tool_choice?: unknown;
  thinking?: { type: "enabled"; budget_tokens: number };
}

export function translateToAnthropicRequest(
  normalized: NormalizedClaudeRequest,
  route: ResolvedRoute,
): AnthropicMessagesRequest {
  const body: AnthropicMessagesRequest = {
    model: route.canonicalModelId,
    max_tokens: defaultMaxTokens(route.canonicalModelId),
    messages: normalized.messages,
    stream: normalized.stream,
  };

  if (normalized.system) {
    body.system = normalized.system;
  }

  const thinking = mapEffortToAnthropicThinking(route.effort);
  if (thinking) {
    body.thinking = thinking;
  }

  if (normalized.tools?.length) {
    const tools = normalized.tools.map(toAnthropicTool).filter((tool) => tool !== null);
    if (tools.length > 0) {
      body.tools = tools;
    }
    if (tools.length > 0 && normalized.toolChoice !== undefined) {
      body.tool_choice = toAnthropicToolChoice(normalized.toolChoice);
    }
  }

  return body;
}

function toAnthropicTool(tool: unknown): unknown | null {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return null;
  const record = tool as Record<string, unknown>;
  if (record.type === "function") {
    const fn = record.function as Record<string, unknown> | undefined;
    const name = typeof fn?.name === "string" ? fn.name : null;
    if (!name) return null;
    return {
      name,
      description: typeof fn?.description === "string" ? fn.description : undefined,
      input_schema: fn?.parameters ?? { type: "object", properties: {} },
    };
  }

  if (record.type === "custom") {
    const custom = record.custom as Record<string, unknown> | undefined;
    const name = typeof custom?.name === "string" ? custom.name : null;
    if (!name) return null;
    return {
      name,
      description: typeof custom?.description === "string" ? custom.description : undefined,
      input_schema: custom?.input_schema ?? { type: "object", properties: {} },
    };
  }

  return typeof record.name === "string" ? tool : null;
}

function toAnthropicToolChoice(toolChoice: unknown): unknown {
  if (toolChoice === "auto" || toolChoice === "any" || toolChoice === "none") {
    return { type: toolChoice };
  }
  if (!toolChoice || typeof toolChoice !== "object" || Array.isArray(toolChoice)) {
    return toolChoice;
  }

  const record = toolChoice as Record<string, unknown>;
  if (record.type === "function") {
    const fn = record.function as Record<string, unknown> | undefined;
    const name = typeof fn?.name === "string" ? fn.name : null;
    return name ? { type: "tool", name } : toolChoice;
  }

  return toolChoice;
}

export function anthropicRequestContainsXhigh(
  body: AnthropicMessagesRequest,
): boolean {
  const serialized = JSON.stringify(body);
  return serialized.includes("xhigh");
}
