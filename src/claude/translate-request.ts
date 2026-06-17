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
    body.tools = normalized.tools;
    if (normalized.toolChoice !== undefined) {
      body.tool_choice = normalized.toolChoice;
    }
  }

  return body;
}

export function anthropicRequestContainsXhigh(
  body: AnthropicMessagesRequest,
): boolean {
  const serialized = JSON.stringify(body);
  return serialized.includes("xhigh");
}
