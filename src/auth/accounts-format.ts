import {
  ROTATION_POLICY_LINES,
  type AccountsStatusSummary,
  type ActiveAccountInfo,
  type ProviderAccountsStatus,
} from "./account-types.ts";
import type { Provider } from "./types.ts";
import type { AccountsStore } from "./accounts-store.ts";

export function formatAccountsList(
  store: AccountsStore,
  provider?: Provider,
  options: { json?: boolean; verbose?: boolean } = {},
): string {
  const providers: Provider[] =
    provider === "codex" || provider === "claude" ? [provider] : ["codex", "claude"];

  if (options.json) {
    const payload: Record<string, unknown> = {};
    for (const entry of providers) {
      payload[entry] = store.listEntries(entry);
    }
    return `${JSON.stringify(payload, null, 2)}\n`;
  }

  const lines: string[] = [];
  for (const entry of providers) {
    lines.push(`${capitalize(entry)} accounts:`);
    const rows = store.listEntries(entry);
    if (rows.length === 0) {
      lines.push("  (empty)");
      lines.push("");
      continue;
    }

    for (const row of rows) {
      const marker = row.active ? "*" : " ";
      const label = row.label ? ` ${row.label}` : "";
      const key = row.accountKey ? ` (${row.accountKey})` : "";
      lines.push(`  ${marker} ${row.index}.${label}${key}`);
      if (options.verbose) {
        lines.push(`      id: ${row.id}`);
        lines.push(`      path: ${row.authPath}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function formatAccountsStatus(
  summary: AccountsStatusSummary,
  options: { json?: boolean; verbose?: boolean } = {},
): string {
  if (options.json) {
    return `${JSON.stringify(summary, null, 2)}\n`;
  }

  const lines: string[] = [];
  for (const row of [summary.codex, summary.claude]) {
    lines.push(...formatProviderAccountsStatus(row, options.verbose));
    lines.push("");
  }

  lines.push("Rotation policy:");
  for (const policy of ROTATION_POLICY_LINES) {
    lines.push(`  ${policy}`);
  }
  lines.push("");

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatProviderAccountsStatus(
  row: ProviderAccountsStatus,
  verbose?: boolean,
): string[] {
  const lines: string[] = [];
  lines.push(`${capitalize(row.provider)}:`);
  lines.push(`  queue:      ${row.queueLength}`);
  lines.push(`  active:     ${formatActiveAccount(row.active)}`);
  if (verbose && row.lastRotation) {
    lines.push(
      `  last rotate: ${row.lastRotation.reason} at ${new Date(row.lastRotation.at).toISOString()}`,
    );
    if (row.lastRotation.detail) {
      lines.push(`              ${row.lastRotation.detail}`);
    }
  }
  return lines;
}

export function formatActiveAccount(active: ActiveAccountInfo | null | undefined): string {
  if (!active) return "—";
  const label = active.label ? `${active.label} ` : "";
  const key = active.accountKey ? `(${active.accountKey}) ` : "";
  return `#${active.index} ${label}${key}[${active.id.slice(0, 8)}]`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
