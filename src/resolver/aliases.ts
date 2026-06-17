import type { Provider } from "./types.ts";

export interface AliasMatch {
  provider: Provider;
  canonicalModelId: string;
  bareModelId: string;
  aliasEffort?: string;
  remainder: string;
}

interface AliasEntry {
  alias: string;
  provider: Provider;
  canonicalModelId: string;
  bareModelId?: string;
  aliasEffort?: string;
}

const CURSOR_CLAUDE_PATTERN =
  /^claude-(\d+)\.(\d+)-(opus|sonnet|haiku)(?:-(high|medium|low|max))?(?:-thinking)?$/;

const STATIC_ALIASES: AliasEntry[] = [
  {
    alias: "claude-4.6-opus-high",
    provider: "claude",
    canonicalModelId: "claude-opus-4-6",
    aliasEffort: "high",
  },
  {
    alias: "cc/claude-opus-4-6",
    provider: "claude",
    canonicalModelId: "claude-opus-4-6",
  },
  {
    alias: "opus-4.8",
    provider: "claude",
    canonicalModelId: "claude-opus-4-8",
    bareModelId: "opus-4.8",
  },
];

const SORTED_STATIC_ALIASES = [...STATIC_ALIASES].sort(
  (left, right) => right.alias.length - left.alias.length,
);

function fromEntry(entry: AliasEntry, remainder = ""): AliasMatch {
  return {
    provider: entry.provider,
    canonicalModelId: entry.canonicalModelId,
    bareModelId: entry.bareModelId ?? entry.canonicalModelId,
    aliasEffort: entry.aliasEffort,
    remainder,
  };
}

function matchCursorClaudePattern(model: string): AliasMatch | null {
  const match = CURSOR_CLAUDE_PATTERN.exec(model);
  if (!match) {
    return null;
  }

  const [, major, minor, variant, effort] = match;
  const canonicalModelId = `claude-${variant}-${major}-${minor}`;

  return {
    provider: "claude",
    canonicalModelId,
    bareModelId: canonicalModelId,
    aliasEffort: effort,
    remainder: "",
  };
}

function matchStaticAlias(model: string): AliasMatch | null {
  for (const entry of SORTED_STATIC_ALIASES) {
    if (model === entry.alias) {
      return fromEntry(entry);
    }
    if (model.startsWith(entry.alias)) {
      return fromEntry(entry, model.slice(entry.alias.length));
    }
  }
  return null;
}

export function normalizeAlias(model: string): AliasMatch | null {
  const trimmed = model.trim();
  if (!trimmed) {
    return null;
  }

  const staticMatch = matchStaticAlias(trimmed);
  if (staticMatch) {
    return staticMatch;
  }

  const cursorMatch = matchCursorClaudePattern(trimmed);
  if (cursorMatch) {
    return cursorMatch;
  }

  if (trimmed.startsWith("cc/")) {
    const bare = trimmed.slice(3);
    const provider = inferProvider(bare);
    if (provider === "claude") {
      return {
        provider,
        canonicalModelId: bare,
        bareModelId: bare,
        remainder: "",
      };
    }
  }

  return null;
}

export function inferProvider(modelId: string): Provider | null {
  if (/^(gpt-|o\d|chatgpt-)/i.test(modelId)) {
    return "codex";
  }
  if (/^(claude-|opus-|sonnet-|haiku-)/i.test(modelId)) {
    return "claude";
  }
  return null;
}

export function isKnownBareModel(provider: Provider, bareModelId: string): boolean {
  if (provider === "codex") {
    return /^(gpt-|o\d|chatgpt-)/i.test(bareModelId);
  }
  return /^(claude-|opus-|sonnet-|haiku-)/i.test(bareModelId);
}
