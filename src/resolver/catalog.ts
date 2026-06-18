import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { AuthManager } from "../auth/manager.ts";
import { fetchClaudeModels, type ClaudeModelRecord } from "../claude/models.ts";
import type { FetchFn as ClaudeFetchFn } from "../claude/upstream.ts";
import { fetchCodexModels, type CodexModelRecord } from "../codex/models.ts";
import type { FetchFn as CodexFetchFn } from "../codex/upstream.ts";
import type { Provider } from "../auth/types.ts";
import {
  bareModelIdForCanonical,
  clearCatalogBareModels,
  inferProvider,
  listStaticAliasIds,
  registerCatalogBareModels,
} from "./aliases.ts";
import type {
  CatalogBareModel,
  CatalogCacheFile,
  CatalogProviderSnapshot,
  CatalogStatus,
  OpenAIModelEntry,
  OpenAIModelList,
} from "./catalog-types.ts";
import { CLAUDE_EFFORT_TOKENS, CODEX_EFFORT_TOKENS } from "./suffix.ts";

export const DEFAULT_CATALOG_TTL_MS = 60 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = DEFAULT_CATALOG_TTL_MS;

export interface ModelCatalogDeps {
  home: string;
  auth: AuthManager;
  fetchCodex?: CodexFetchFn;
  fetchClaude?: ClaudeFetchFn;
  ttlMs?: number;
  pollIntervalMs?: number;
  installationId?: string;
  now?: () => number;
}

type ProviderFetchResult = {
  provider: Provider;
  bareModels: CatalogBareModel[];
  error?: string;
};

export class ModelCatalog {
  private readonly home: string;
  private readonly auth: AuthManager;
  private readonly fetchCodex: CodexFetchFn;
  private readonly fetchClaude: ClaudeFetchFn;
  private readonly ttlMs: number;
  private readonly pollIntervalMs: number;
  private readonly installationId: string;
  private readonly now: () => number;

  private bareModels: CatalogBareModel[] = [];
  private providerSnapshots: CatalogProviderSnapshot[] = [];
  private fetchedAt: number | null = null;
  private inflightRefresh: Promise<void> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastWarning: string | undefined;

  constructor(deps: ModelCatalogDeps) {
    this.home = deps.home;
    this.auth = deps.auth;
    this.fetchCodex = deps.fetchCodex ?? fetch;
    this.fetchClaude = deps.fetchClaude ?? fetch;
    this.ttlMs = deps.ttlMs ?? DEFAULT_CATALOG_TTL_MS;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.installationId = deps.installationId ?? crypto.randomUUID();
    this.now = deps.now ?? Date.now;
    this.loadFromDisk();
  }

  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.refreshIfStale();
    }, this.pollIntervalMs);
    if (typeof this.pollTimer.unref === "function") {
      this.pollTimer.unref();
    }
    void this.refreshIfStale();
  }

  stop(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  invalidate(): void {
    this.fetchedAt = null;
    void this.refresh();
  }

  status(): CatalogStatus {
    const ageMs = this.fetchedAt ? this.now() - this.fetchedAt : null;
    const stale = ageMs === null || ageMs > this.ttlMs;
    const providers = this.providerSnapshots.map((snapshot) => ({
      ...snapshot,
      fetchedAt: snapshot.fetchedAt ?? this.fetchedAt,
    }));

    return {
      fetchedAt: this.fetchedAt,
      stale,
      totalModels: this.bareModels.length,
      providers,
      warning: stale ? this.staleWarning(ageMs) : this.lastWarning,
    };
  }

  async listModels(): Promise<OpenAIModelList> {
    await this.refreshIfStale();
    return this.toOpenAiList();
  }

  async refresh(): Promise<void> {
    if (this.inflightRefresh) {
      await this.inflightRefresh;
      return;
    }

    this.inflightRefresh = this.refreshOnce().finally(() => {
      this.inflightRefresh = null;
    });
    await this.inflightRefresh;
  }

  private async refreshIfStale(): Promise<void> {
    if (this.fetchedAt && this.now() - this.fetchedAt < this.ttlMs) {
      return;
    }
    await this.refresh();
  }

  private async refreshOnce(): Promise<void> {
    const results = await Promise.all([
      this.fetchProviderModels("codex"),
      this.fetchProviderModels("claude"),
    ]);

    const mergedBare = mergeBareModels(results.flatMap((result) => result.bareModels));
    const hadCache = this.bareModels.length > 0;
    const anySuccess = results.some((result) => result.bareModels.length > 0);

    if (anySuccess) {
      this.bareModels = mergedBare;
      this.fetchedAt = this.now();
      this.providerSnapshots = results.map((result) => ({
        provider: result.provider,
        modelCount: result.bareModels.length,
        fetchedAt: result.bareModels.length > 0 ? this.fetchedAt : null,
        error: result.error,
      }));
      this.lastWarning = results
        .filter((result) => result.error)
        .map((result) => `${result.provider}: ${result.error}`)
        .join("; ") || undefined;
      registerCatalogBareModels(this.bareModels);
      this.persistToDisk();
      return;
    }

    if (hadCache) {
      this.lastWarning = results
        .map((result) => result.error ?? `${result.provider}: no models returned`)
        .join("; ");
      return;
    }

    this.bareModels = [];
    this.providerSnapshots = results.map((result) => ({
      provider: result.provider,
      modelCount: 0,
      fetchedAt: null,
      error: result.error ?? "not authenticated",
    }));
    this.fetchedAt = this.now();
    clearCatalogBareModels();
    this.persistToDisk();
  }

  private async fetchProviderModels(provider: Provider): Promise<ProviderFetchResult> {
    try {
      if (provider === "codex") {
        const credentials = await this.auth.getCodexCredentials();
        const models = await fetchCodexModels(
          credentials,
          this.fetchCodex,
          this.installationId,
        );
        return {
          provider,
          bareModels: models.map((model) => toBareModel("codex", model)),
        };
      }

      const credentials = await this.auth.getClaudeCredentials();
      const models = await fetchClaudeModels(credentials, this.fetchClaude);
      return {
        provider,
        bareModels: models.map((model) => toBareModel("claude", model)),
      };
    } catch (error) {
      return {
        provider,
        bareModels: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private toOpenAiList(): OpenAIModelList {
    const created = Math.floor(this.now() / 1000);
    const ids = new Set<string>();

    for (const model of this.bareModels) {
      ids.add(model.bareModelId);
      for (const suffixed of suffixedPickerIds(model)) {
        ids.add(suffixed);
      }
    }

    for (const aliasId of listStaticAliasIds()) {
      ids.add(aliasId);
    }

    const data: OpenAIModelEntry[] = [...ids]
      .sort((left, right) => left.localeCompare(right))
      .map((id) => ({
        id,
        object: "model" as const,
        created,
        owned_by: ownedByForId(id),
      }));

    return { object: "list", data };
  }

  private staleWarning(ageMs: number | null): string {
    if (ageMs === null) {
      return "Model catalog has not been refreshed yet. Run eport up or eport auth login.";
    }
    const minutes = Math.floor(ageMs / 60_000);
    return `Model catalog is stale (${minutes}m old). Re-auth or wait for refresh.`;
  }

  private cachePath(): string {
    return join(this.home, ".eport", "catalog-cache.json");
  }

  private loadFromDisk(): void {
    const path = this.cachePath();
    if (!existsSync(path)) return;

    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as CatalogCacheFile;
      if (!Array.isArray(parsed.bareModels)) return;
      this.bareModels = parsed.bareModels;
      this.fetchedAt = typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : null;
      this.providerSnapshots = Array.isArray(parsed.providers) ? parsed.providers : [];
      registerCatalogBareModels(this.bareModels);
    } catch {
      // Ignore corrupt cache; next refresh will rebuild.
    }
  }

  private persistToDisk(): void {
    const path = this.cachePath();
    mkdirSync(dirname(path), { recursive: true });
    const payload: CatalogCacheFile = {
      fetchedAt: this.fetchedAt ?? this.now(),
      bareModels: this.bareModels,
      providers: this.providerSnapshots,
    };
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

export function loadCatalogStatusFromDisk(home: string, ttlMs = DEFAULT_CATALOG_TTL_MS): CatalogStatus {
  const path = join(home, ".eport", "catalog-cache.json");
  if (!existsSync(path)) {
    return {
      fetchedAt: null,
      stale: true,
      totalModels: 0,
      providers: [],
      warning: "Model catalog has not been refreshed yet. Run eport up or eport auth login.",
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CatalogCacheFile;
    const fetchedAt = typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : null;
    const ageMs = fetchedAt ? Date.now() - fetchedAt : null;
    const stale = ageMs === null || ageMs > ttlMs;
    const providers = Array.isArray(parsed.providers) ? parsed.providers : [];
    const totalModels = Array.isArray(parsed.bareModels) ? parsed.bareModels.length : 0;

    return {
      fetchedAt,
      stale,
      totalModels,
      providers,
      warning: stale
        ? fetchedAt
          ? `Model catalog is stale (${Math.floor((ageMs ?? 0) / 60_000)}m old).`
          : "Model catalog has not been refreshed yet. Run eport up or eport auth login."
        : undefined,
    };
  } catch {
    return {
      fetchedAt: null,
      stale: true,
      totalModels: 0,
      providers: [],
      warning: "Model catalog cache is unreadable. Run eport up to refresh.",
    };
  }
}

function toBareModel(provider: Provider, record: CodexModelRecord | ClaudeModelRecord): CatalogBareModel {
  const canonicalModelId = record.id;
  const bareModelId = bareModelIdForCanonical(provider, canonicalModelId);
  return { provider, bareModelId, canonicalModelId };
}

function mergeBareModels(models: CatalogBareModel[]): CatalogBareModel[] {
  const seen = new Set<string>();
  const out: CatalogBareModel[] = [];
  for (const model of models) {
    const key = `${model.provider}:${model.bareModelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(model);
  }
  return out;
}

function suffixedPickerIds(model: CatalogBareModel): string[] {
  const primary = model.provider === "codex" ? "xhigh" : "max";
  const ids = [`${model.bareModelId}${primary}`];
  if (model.provider === "codex") {
    ids.push(`${model.bareModelId}${primary}-fast`);
  }
  return ids;
}

function ownedByForId(id: string): string {
  const provider = inferProvider(stripPickerSuffix(id));
  if (provider === "claude") return "anthropic";
  if (provider === "codex") return "codex";
  return "eport";
}

function stripPickerSuffix(id: string): string {
  let base = id.endsWith("-fast") ? id.slice(0, -"-fast".length) : id;
  const tokens = [...CODEX_EFFORT_TOKENS, ...CLAUDE_EFFORT_TOKENS].sort(
    (left, right) => right.length - left.length,
  );
  for (const token of tokens) {
    if (base.endsWith(token)) {
      return base.slice(0, -token.length);
    }
  }
  return base;
}
