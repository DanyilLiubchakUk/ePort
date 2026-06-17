import { AuthManager, formatAuthStatus } from "../auth/index.ts";
import { formatActiveAccount } from "../auth/accounts-format.ts";
import { ConfigStore, type ConfigProfile } from "../config/index.ts";
import { loadCatalogStatusFromDisk, type CatalogStatus } from "../resolver/index.ts";
import { loadLiveProxyRuntimeState, type ProxyRuntimeState } from "../runtime/state.ts";

export interface StatusSummary {
  auth: ReturnType<AuthManager["status"]>;
  catalog: CatalogStatus;
  config: ConfigStatusSummary;
  proxy?: ProxyRuntimeState;
}

export interface ConfigStatusSummary {
  tunnelMode: ConfigProfile["tunnelMode"];
  namedTunnelConfigured: boolean;
  globalFastOverride: boolean;
  globalDefaultEffort?: string;
  modelDefaults: Record<string, ConfigProfile["modelDefaults"][string]>;
}

export function runStatus(
  home: string,
  options: { json?: boolean; verbose?: boolean },
): number {
  const auth = new AuthManager(home);
  const config = new ConfigStore(home).load();
  const proxy = loadLiveProxyRuntimeState(home) ?? undefined;
  const summary: StatusSummary = {
    auth: auth.status(),
    catalog: loadCatalogStatusFromDisk(home),
    config: summarizeConfig(config),
    proxy,
  };
  process.stdout.write(formatStatus(summary, options));
  return 0;
}

export function formatStatus(
  summary: StatusSummary,
  options: { json?: boolean; verbose?: boolean } = {},
): string {
  if (options.json) {
    return `${JSON.stringify(summary, null, 2)}\n`;
  }

  const lines: string[] = [];
  lines.push("Auth");
  lines.push(formatAuthStatus(summary.auth, options).trimEnd());
  lines.push("");
  lines.push("Catalog");
  lines.push(formatCatalogStatus(summary.catalog).trimEnd());
  lines.push("");
  lines.push("Config");
  lines.push(formatConfigStatus(summary.config).trimEnd());
  lines.push("");
  lines.push("Proxy");
  lines.push(formatProxyStatus(summary.proxy).trimEnd());
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function summarizeConfig(config: ConfigProfile): ConfigStatusSummary {
  return {
    tunnelMode: config.tunnelMode,
    namedTunnelConfigured: Boolean(config.tunnel.hostname && config.tunnel.token),
    globalFastOverride: config.globalFastOverride,
    globalDefaultEffort: config.globalDefaultEffort,
    modelDefaults: config.modelDefaults,
  };
}

export function formatCatalogStatus(catalog: CatalogStatus): string {
  const lines: string[] = [];
  lines.push(`  fetched:    ${formatCatalogFetchedAt(catalog.fetchedAt)}`);
  lines.push(`  stale:      ${catalog.stale ? "yes" : "no"}`);
  lines.push(`  models:     ${catalog.totalModels}`);

  for (const provider of catalog.providers) {
    lines.push(
      `  ${provider.provider}: ${provider.modelCount} model(s)` +
        (provider.error ? ` (${provider.error})` : ""),
    );
  }

  if (catalog.warning) {
    lines.push(`  note:       ${catalog.warning}`);
  }

  return lines.join("\n");
}

function formatCatalogFetchedAt(fetchedAt: number | null): string {
  if (!fetchedAt) return "—";
  return new Date(fetchedAt).toISOString();
}

function formatConfigStatus(config: ConfigStatusSummary): string {
  const modelIds = Object.keys(config.modelDefaults).sort();
  const lines: string[] = [];
  lines.push(`  tunnel mode:     ${config.tunnelMode}`);
  lines.push(`  named tunnel:    ${config.namedTunnelConfigured ? "configured" : "missing"}`);
  lines.push(`  fast override:   ${config.globalFastOverride ? "on" : "off"}`);
  lines.push(`  default effort:  ${config.globalDefaultEffort ?? "—"}`);
  lines.push(`  model defaults:  ${modelIds.length ? modelIds.join(", ") : "none"}`);
  return lines.join("\n");
}

function formatProxyStatus(proxy: ProxyRuntimeState | undefined): string {
  if (!proxy) {
    return [
      "  running:    no",
      "  tunnel:     —",
      "  base URL:   —",
      "  codex:      none",
      "  claude:     none",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(`  running:    yes (pid ${proxy.pid}, port ${proxy.port})`);
  lines.push(`  started:    ${new Date(proxy.startedAt).toISOString()}`);
  lines.push(`  tunnel:     ${proxy.tunnelMode ?? "unknown"}`);
  lines.push(`  base URL:   ${proxy.publicBaseUrl ?? `http://127.0.0.1:${proxy.port}/v1`}`);
  lines.push(`  codex:      ${formatActiveAccount(proxy.activeAccounts.codex)}`);
  lines.push(`  claude:     ${formatActiveAccount(proxy.activeAccounts.claude)}`);
  return lines.join("\n");
}
