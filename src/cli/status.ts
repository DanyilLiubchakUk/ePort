import { AuthManager, formatAuthStatus } from "../auth/index.ts";
import { formatActiveAccount } from "../auth/accounts-format.ts";
import { loadCatalogStatusFromDisk, type CatalogStatus } from "../resolver/index.ts";
import { loadLiveProxyRuntimeState, type ProxyRuntimeState } from "../runtime/state.ts";

export interface StatusSummary {
  auth: ReturnType<AuthManager["status"]>;
  catalog: CatalogStatus;
  proxy?: ProxyRuntimeState;
}

export function runStatus(
  home: string,
  options: { json?: boolean; verbose?: boolean },
): number {
  const auth = new AuthManager(home);
  const proxy = loadLiveProxyRuntimeState(home) ?? undefined;
  const summary: StatusSummary = {
    auth: auth.status(),
    catalog: loadCatalogStatusFromDisk(home),
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
  if (summary.proxy) {
    lines.push("");
    lines.push("Proxy");
    lines.push(formatProxyStatus(summary.proxy).trimEnd());
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
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

function formatProxyStatus(proxy: ProxyRuntimeState): string {
  const lines: string[] = [];
  lines.push(`  running:    yes (pid ${proxy.pid}, port ${proxy.port})`);
  lines.push(`  started:    ${new Date(proxy.startedAt).toISOString()}`);
  lines.push(`  codex:      ${formatActiveAccount(proxy.activeAccounts.codex)}`);
  lines.push(`  claude:     ${formatActiveAccount(proxy.activeAccounts.claude)}`);
  return lines.join("\n");
}
