import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getEportHome } from "../config/paths.ts";
import type { TunnelMode } from "../config/types.ts";
import type { ActiveAccountInfo } from "../auth/account-types.ts";
import type { Provider } from "../auth/types.ts";

export interface ProxyRuntimeState {
  pid: number;
  port: number;
  startedAt: number;
  tunnelMode?: TunnelMode;
  publicBaseUrl?: string | null;
  activeAccounts: Partial<Record<Provider, ActiveAccountInfo>>;
}

function isTunnelMode(value: unknown): value is TunnelMode {
  return value === "ngrok" || value === "named" || value === "quick" || value === "none";
}

function getRuntimeStatePath(home: string): string {
  return join(getEportHome(home), "runtime.json");
}

export function readProxyRuntimeState(home: string): ProxyRuntimeState | null {
  const path = getRuntimeStatePath(home);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const data = raw as Record<string, unknown>;
    const pid = typeof data.pid === "number" ? data.pid : 0;
    const port = typeof data.port === "number" ? data.port : 0;
    const startedAt = typeof data.startedAt === "number" ? data.startedAt : 0;
    if (!pid || !port || !startedAt) return null;
    const tunnelMode = isTunnelMode(data.tunnelMode) ? data.tunnelMode : undefined;
    const publicBaseUrl =
      typeof data.publicBaseUrl === "string" ? data.publicBaseUrl : null;

    const activeAccounts: Partial<Record<Provider, ActiveAccountInfo>> = {};
    if (data.activeAccounts && typeof data.activeAccounts === "object") {
      for (const provider of ["codex", "claude"] as const) {
        const entry = (data.activeAccounts as Record<string, unknown>)[provider];
        if (!entry || typeof entry !== "object") continue;
        const row = entry as Record<string, unknown>;
        const id = typeof row.id === "string" ? row.id : "";
        const index = typeof row.index === "number" ? row.index : 1;
        if (!id) continue;
        activeAccounts[provider] = {
          provider,
          id,
          index,
          label: typeof row.label === "string" ? row.label : undefined,
          accountKey: typeof row.accountKey === "string" ? row.accountKey : undefined,
        };
      }
    }

    return { pid, port, startedAt, tunnelMode, publicBaseUrl, activeAccounts };
  } catch {
    return null;
  }
}

export function writeProxyRuntimeState(home: string, state: ProxyRuntimeState): void {
  const path = getRuntimeStatePath(home);
  mkdirSync(getEportHome(home), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function clearProxyRuntimeState(home: string): void {
  const path = getRuntimeStatePath(home);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function isProxyProcessRunning(state: ProxyRuntimeState | null): boolean {
  if (!state?.pid) return false;
  try {
    process.kill(state.pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function loadLiveProxyRuntimeState(home: string): ProxyRuntimeState | null {
  const state = readProxyRuntimeState(home);
  if (!state) return null;
  if (!isProxyProcessRunning(state)) {
    clearProxyRuntimeState(home);
    return null;
  }
  return state;
}
