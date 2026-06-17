import type { TunnelMode } from "../config/types.ts";
import { createCloudflaredSpawner } from "./cloudflared.ts";
import { createNgrokSpawner } from "./ngrok.ts";
import type {
  SpawnCloudflared,
  SpawnNgrok,
  TunnelManagerOptions,
  TunnelStartResult,
  TunnelStatus,
} from "./types.ts";
import {
  composeNamedPublicBaseUrl,
  composeNgrokPublicBaseUrl,
  composeQuickPublicBaseUrl,
  parseNgrokTunnelUrl,
  parseQuickTunnelUrl,
} from "./url.ts";

const DEFAULT_RECONNECT_DELAY_MS = 2_000;
const DEFAULT_QUICK_URL_TIMEOUT_MS = 60_000;

export class TunnelManager {
  private mode: TunnelMode | null = null;
  private publicBaseUrl: string | null = null;
  private connected = false;
  private stopped = true;
  private child: ReturnType<SpawnCloudflared> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly spawnCloudflared: SpawnCloudflared;
  private readonly spawnNgrok: SpawnNgrok;
  private readonly reconnectDelayMs: number;
  private readonly quickUrlTimeoutMs: number;
  private readonly verbose: boolean;

  constructor(private readonly options: TunnelManagerOptions = {}) {
    this.spawnCloudflared =
      options.spawnCloudflared ?? createCloudflaredSpawner(options.findCloudflared);
    this.spawnNgrok = options.spawnNgrok ?? createNgrokSpawner(options.findNgrok);
    this.reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    this.quickUrlTimeoutMs = options.quickUrlTimeoutMs ?? DEFAULT_QUICK_URL_TIMEOUT_MS;
    this.verbose = options.verbose ?? false;
  }

  async start(mode: TunnelMode, localPort: number): Promise<TunnelStartResult> {
    await this.stop();
    this.stopped = false;
    this.mode = mode;

    if (mode === "none") {
      this.publicBaseUrl = null;
      this.connected = false;
      return { publicBaseUrl: null };
    }

    if (mode === "ngrok") {
      const authtoken = this.options.ngrokConfig?.authtoken?.trim();
      const url = this.options.ngrokConfig?.url?.trim();
      if (!authtoken || !url) {
        throw new Error(
          "ngrok tunnel is not configured. Run: eport tunnel setup ngrok",
        );
      }

      this.publicBaseUrl = composeNgrokPublicBaseUrl(url);
      this.startNgrok(authtoken, url, localPort);
      return { publicBaseUrl: this.publicBaseUrl };
    }

    if (mode === "named") {
      const token = this.options.namedConfig?.token?.trim();
      const hostname = this.options.namedConfig?.hostname?.trim();
      if (!token || !hostname) {
        throw new Error(
          "Named tunnel is not configured. Run: eport tunnel setup named",
        );
      }

      this.publicBaseUrl = composeNamedPublicBaseUrl(hostname);
      this.startNamed(token, localPort);
      return { publicBaseUrl: this.publicBaseUrl };
    }

    const quickUrl = await this.startQuick(localPort);
    this.publicBaseUrl = composeQuickPublicBaseUrl(quickUrl);
    return { publicBaseUrl: this.publicBaseUrl };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.child) {
      try {
        this.child.removeAllListeners();
      } catch {
        // ignore
      }
      try {
        this.child.kill();
      } catch {
        // ignore
      }
      this.child = null;
    }
    this.connected = false;
    this.mode = null;
    this.publicBaseUrl = null;
  }

  status(): TunnelStatus {
    return {
      mode: this.mode,
      publicBaseUrl: this.publicBaseUrl,
      connected: this.connected,
    };
  }

  private startNamed(token: string, localPort: number): void {
    const args = ["tunnel", "run", "--token", token, "--url", `http://127.0.0.1:${localPort}`];
    this.spawnProcess("cloudflared", this.spawnCloudflared, args, undefined, (line) =>
      line.toLowerCase().includes("registered tunnel connection"),
    );
  }

  private startNgrok(authtoken: string, url: string, localPort: number): void {
    const args = ["http", String(localPort), "--url", url];
    this.spawnProcess(
      "ngrok",
      this.spawnNgrok,
      args,
      { NGROK_AUTHTOKEN: authtoken },
      (line) => {
        const parsed = parseNgrokTunnelUrl(line);
        if (!parsed) {
          return false;
        }
        this.publicBaseUrl = composeNgrokPublicBaseUrl(parsed);
        return true;
      },
    );
  }

  private async startQuick(localPort: number): Promise<string> {
    const args = ["tunnel", "--url", `http://127.0.0.1:${localPort}`];
    return this.waitForQuickUrl(args);
  }

  private waitForQuickUrl(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let foundUrl: string | null = null;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        if (error) {
          reject(error);
          return;
        }
        if (!foundUrl) {
          reject(new Error("quick tunnel URL not found in cloudflared output"));
          return;
        }
        resolve(foundUrl);
      };

      const timeout = setTimeout(() => {
        finish(new Error("timed out waiting for quick tunnel URL"));
      }, this.quickUrlTimeoutMs);

      const tryStart = () => {
        if (this.stopped || settled) {
          return;
        }

        let child: ReturnType<SpawnCloudflared>;
        try {
          child = this.spawnCloudflared(args);
        } catch (error) {
          clearTimeout(timeout);
          finish(error instanceof Error ? error : new Error(String(error)));
          return;
        }

        this.child = child;
        this.connected = false;

        const onLine = (line: string) => {
          if (this.verbose) {
            console.log(`[cloudflared] ${line}`);
          }
          const parsed = parseQuickTunnelUrl(line);
          if (!parsed || foundUrl) {
            return;
          }
          foundUrl = parsed;
          this.connected = true;
          this.publicBaseUrl = composeQuickPublicBaseUrl(parsed);
          clearTimeout(timeout);
          finish();
        };

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          chunk.split("\n").forEach(onLine);
        });
        child.stderr.on("data", (chunk: string) => {
          chunk.split("\n").forEach(onLine);
        });

        child.on("error", (error: unknown) => {
          if (settled) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          if (this.verbose) {
            console.error(`[cloudflared] error: ${message}`);
          }
        });

        child.on("exit", () => {
          this.connected = false;
          if (settled || this.stopped) {
            return;
          }
          if (this.verbose) {
            console.log("[cloudflared] exited; reconnecting quick tunnel…");
          }
          this.scheduleReconnect(() => tryStart());
        });
      };

      tryStart();
    });
  }

  private spawnProcess(
    label: string,
    spawnTunnel: SpawnCloudflared | SpawnNgrok,
    args: string[],
    env: Record<string, string> | undefined,
    isConnectedLine: (line: string) => boolean,
  ): void {
    const start = () => {
      if (this.stopped) {
        return;
      }

      let child: ReturnType<SpawnCloudflared>;
      try {
        child = spawnTunnel(args, env);
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
      }

      this.child = child;
      this.connected = false;

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      const logLine = (line: string) => {
        if (this.verbose) {
          console.log(`[${label}] ${line}`);
        }
        if (isConnectedLine(line)) {
          this.connected = true;
        }
      };
      child.stdout.on("data", (chunk: string) => {
        chunk.split("\n").forEach(logLine);
      });
      child.stderr.on("data", (chunk: string) => {
        chunk.split("\n").forEach(logLine);
      });

      child.on("error", (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (this.verbose) {
          console.error(`[${label}] error: ${message}`);
        }
      });

      child.on("exit", () => {
        this.connected = false;
        if (this.stopped) {
          return;
        }
        if (this.verbose) {
          console.log(`[${label}] exited; reconnecting ${this.mode ?? "tunnel"} tunnel…`);
        }
        this.scheduleReconnect(() => start());
      });
    };

    start();
  }

  private scheduleReconnect(run: () => void): void {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) {
        run();
      }
    }, this.reconnectDelayMs);
  }
}
