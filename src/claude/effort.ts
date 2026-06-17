const CLAUDE_EFFORT_BUDGET: Record<string, number> = {
  low: 1024,
  medium: 8192,
  high: 16000,
  max: 32000,
};

export interface AnthropicThinkingConfig {
  type: "enabled";
  budget_tokens: number;
}

export function mapEffortToAnthropicThinking(
  effort: string | null,
): AnthropicThinkingConfig | undefined {
  if (!effort || effort === "xhigh") {
    return undefined;
  }
  const budget = CLAUDE_EFFORT_BUDGET[effort];
  if (!budget) return undefined;
  return { type: "enabled", budget_tokens: budget };
}

export function defaultMaxTokens(modelId: string): number {
  return /opus/i.test(modelId) ? 32_000 : 16_384;
}
