import { ModelRoutingError, type Provider } from "./types.ts";
import { inferProvider } from "./aliases.ts";

export const CODEX_EFFORT_TOKENS = ["xhigh", "high", "medium", "low", "minimal"] as const;
export const CLAUDE_EFFORT_TOKENS = ["max", "high", "medium", "low"] as const;

export interface ParsedSuffix {
  provider: Provider;
  bareModelId: string;
  canonicalModelId: string;
  effort: string | null;
  fastTier: boolean;
}

function stripFastSuffix(model: string): { model: string; fastTier: boolean } {
  if (model.endsWith("-fast")) {
    return { model: model.slice(0, -"-fast".length), fastTier: true };
  }
  return { model, fastTier: false };
}

function effortTokensFor(provider: Provider): readonly string[] {
  return provider === "claude" ? CLAUDE_EFFORT_TOKENS : CODEX_EFFORT_TOKENS;
}

function rejectClaudeFast(model: string, fastTier: boolean): void {
  if (fastTier) {
    throw new ModelRoutingError(
      "invalid_suffix",
      `Claude models do not support -fast suffix: ${model}`,
      model,
    );
  }
}

function rejectClaudeXhigh(model: string, token: string | null): void {
  if (token === "xhigh" || model.includes("xhigh")) {
    throw new ModelRoutingError(
      "invalid_suffix",
      `Claude models do not support xhigh effort: ${model}`,
      model,
    );
  }
}

function parseEffortFromTail(
  model: string,
  provider: Provider,
  clientModel: string,
): { bareModelId: string; effort: string | null } {
  const tokens = effortTokensFor(provider);

  for (const token of tokens) {
    if (!model.endsWith(token)) {
      continue;
    }

    const bareModelId = model.slice(0, -token.length);
    const bareProvider = inferProvider(bareModelId);
    if (!bareModelId || bareProvider !== provider) {
      continue;
    }

    if (provider === "claude") {
      rejectClaudeXhigh(clientModel, token);
    }

    return { bareModelId, effort: token };
  }

  if (provider === "claude") {
    rejectClaudeXhigh(clientModel, null);
  }

  const bareProvider = inferProvider(model);
  if (!model || bareProvider !== provider) {
    throw new ModelRoutingError(
      "invalid_suffix",
      `Unrecognized ${provider} model suffix: ${clientModel}`,
      clientModel,
    );
  }

  return { bareModelId: model, effort: null };
}

export function parseRemainderSuffix(
  remainder: string,
  provider: Provider,
  clientModel: string,
): { effort: string | null; fastTier: boolean } {
  if (!remainder) {
    return { effort: null, fastTier: false };
  }

  const { model: withoutFast, fastTier } = stripFastSuffix(remainder);
  rejectClaudeFast(clientModel, fastTier);

  if (provider === "claude") {
    rejectClaudeXhigh(clientModel, withoutFast);
    if (!CLAUDE_EFFORT_TOKENS.includes(withoutFast as (typeof CLAUDE_EFFORT_TOKENS)[number])) {
      throw new ModelRoutingError(
        "invalid_suffix",
        `Unrecognized Claude effort token: ${clientModel}`,
        clientModel,
      );
    }
    return { effort: withoutFast, fastTier: false };
  }

  const { effort } = parseEffortFromTail(withoutFast, provider, clientModel);
  return { effort, fastTier };
}

export function parseFullModelSuffix(clientModel: string): ParsedSuffix {
  const trimmed = clientModel.trim();
  const { model: withoutFast, fastTier } = stripFastSuffix(trimmed);

  const guessedProvider = inferProvider(withoutFast);
  if (!guessedProvider) {
    throw new ModelRoutingError(
      "unknown_model",
      `Unknown model: ${clientModel}`,
      clientModel,
      "Add a custom model from GET /v1/models",
    );
  }

  if (guessedProvider === "claude") {
    rejectClaudeFast(clientModel, fastTier);
  }

  const { bareModelId, effort } = parseEffortFromTail(
    withoutFast,
    guessedProvider,
    clientModel,
  );

  return {
    provider: guessedProvider,
    bareModelId,
    canonicalModelId: bareModelId,
    effort,
    fastTier,
  };
}
