import { inferProvider } from "../resolver/aliases.ts";
import {
  CLAUDE_EFFORT_TOKENS,
  CODEX_EFFORT_TOKENS,
} from "../resolver/suffix.ts";
import type { Provider } from "../resolver/types.ts";

export function effortTokensFor(provider: Provider): readonly string[] {
  return provider === "claude" ? CLAUDE_EFFORT_TOKENS : CODEX_EFFORT_TOKENS;
}

export function resolveBareModelProvider(bareModel: string): Provider {
  const trimmed = bareModel.trim();
  const provider = inferProvider(trimmed);
  if (!provider) {
    throw new Error(`unknown bare model: ${bareModel}`);
  }
  return provider;
}

export function validateEffort(provider: Provider, effort: string): void {
  if (provider === "claude" && effort === "xhigh") {
    throw new Error("Claude models do not support xhigh effort");
  }

  const tokens = effortTokensFor(provider);
  if (!tokens.includes(effort as (typeof tokens)[number])) {
    throw new Error(
      `invalid effort for ${provider}: ${effort} (expected: ${tokens.join(", ")})`,
    );
  }
}
