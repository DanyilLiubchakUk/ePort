import type { NamedTunnelConfig, NgrokTunnelConfig, TunnelMode } from "../config/types.ts";

export interface TunnelStatus {
  mode: TunnelMode | null;
  publicBaseUrl: string | null;
  connected: boolean;
}

export interface TunnelStartResult {
  publicBaseUrl: string | null;
}

export interface TunnelManagerOptions {
  namedConfig?: NamedTunnelConfig;
  ngrokConfig?: NgrokTunnelConfig;
  verbose?: boolean;
  findCloudflared?: () => string | null;
  findNgrok?: () => string | null;
  spawnCloudflared?: SpawnCloudflared;
  spawnNgrok?: SpawnNgrok;
  reconnectDelayMs?: number;
  quickUrlTimeoutMs?: number;
}

export type SpawnTunnelProcess = (
  args: string[],
  env?: Record<string, string>,
) => {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  on: (event: "exit" | "error", listener: (...args: unknown[]) => void) => void;
  kill: () => void;
  removeAllListeners: () => void;
};

export type SpawnCloudflared = SpawnTunnelProcess;
export type SpawnNgrok = SpawnTunnelProcess;
