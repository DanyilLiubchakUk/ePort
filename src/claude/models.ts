import type { ClaudeCredentials } from "../auth/types.ts";
import type { FetchFn } from "./upstream.ts";
import { CLAUDE_CODE_BETA_HEADERS } from "./upstream.ts";

export const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";

export interface ClaudeModelRecord {
  id: string;
}

export async function fetchClaudeModels(
  credentials: ClaudeCredentials,
  fetchFn: FetchFn,
): Promise<ClaudeModelRecord[]> {
  const response = await fetchFn(ANTHROPIC_MODELS_URL, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${credentials.accessToken}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": CLAUDE_CODE_BETA_HEADERS,
      "anthropic-dangerous-direct-browser-access": "true",
    },
  });

  if (!response.ok) {
    return [];
  }

  const parsed = (await response.json()) as { data?: unknown[] };
  if (!Array.isArray(parsed.data)) {
    return [];
  }

  const models: ClaudeModelRecord[] = [];
  for (const item of parsed.data) {
    if (!item || typeof item !== "object") continue;
    const id = (item as Record<string, unknown>).id;
    if (typeof id === "string" && id.trim().length > 0) {
      models.push({ id: id.trim() });
    }
  }

  return dedupeById(models);
}

function dedupeById(models: ClaudeModelRecord[]): ClaudeModelRecord[] {
  const seen = new Set<string>();
  const out: ClaudeModelRecord[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }
  return out;
}
