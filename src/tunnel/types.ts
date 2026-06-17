import type { NamedTunnelConfig, TunnelMode } from "../config/types.ts";

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
  verbose?: boolean;
  findCloudflared?: () => string | null;
  spawnCloudflared?: SpawnCloudflared;
  reconnectDelayMs?: number;
  quickUrlTimeoutMs?: number;
}

export type SpawnCloudflared = (
  args: string[],
) => {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  on: (event: "exit" | "error", listener: (...args: unknown[]) => void) => void;
  kill: () => void;
  removeAllListeners: () => void;
};
