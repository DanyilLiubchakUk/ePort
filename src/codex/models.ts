import type { CodexCredentials } from "../auth/types.ts";
import type { FetchFn } from "./upstream.ts";
import { CODEX_USER_AGENT_VERSION, ORIGINATOR } from "./upstream.ts";

export const CODEX_MODELS_BASE_URL = "https://chatgpt.com/backend-api";

export interface CodexModelRecord {
  id: string;
}

export async function fetchCodexModels(
  credentials: CodexCredentials,
  fetchFn: FetchFn,
  installationId: string = crypto.randomUUID(),
): Promise<CodexModelRecord[]> {
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${credentials.accessToken}`,
    "chatgpt-account-id": credentials.accountId,
    originator: ORIGINATOR,
    "user-agent": `${ORIGINATOR}/${CODEX_USER_AGENT_VERSION} (eport)`,
    "x-codex-installation-id": installationId,
  };

  const endpoints = [
    `${CODEX_MODELS_BASE_URL}/codex/models?client_version=${CODEX_USER_AGENT_VERSION}`,
    `${CODEX_MODELS_BASE_URL}/models`,
    `${CODEX_MODELS_BASE_URL}/sentinel/chat-requirements`,
  ];

  for (const url of endpoints) {
    try {
      const response = await fetchFn(url, { method: "GET", headers });
      if (!response.ok) continue;

      const parsed = (await response.json()) as Record<string, unknown>;
      const sentinel = parsed.chat_models as Record<string, unknown> | undefined;
      const models = sentinel?.models ?? parsed.models ?? parsed.data ?? parsed.categories;
      if (!Array.isArray(models) || models.length === 0) continue;

      const flattened: CodexModelRecord[] = [];
      for (const item of models) {
        if (!item || typeof item !== "object") continue;
        const entry = item as Record<string, unknown>;
        if (Array.isArray(entry.models)) {
          for (const sub of entry.models) {
            const id = extractCodexModelId(sub);
            if (id) flattened.push({ id });
          }
        } else {
          const id = extractCodexModelId(entry);
          if (id) flattened.push({ id });
        }
      }

      if (flattened.length > 0) {
        return dedupeById(flattened);
      }
    } catch {
      continue;
    }
  }

  return [];
}

function extractCodexModelId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const id = entry.slug ?? entry.id ?? entry.name ?? entry.model;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : null;
}

function dedupeById(models: CodexModelRecord[]): CodexModelRecord[] {
  const seen = new Set<string>();
  const out: CodexModelRecord[] = [];
  for (const model of models) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }
  return out;
}
