import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { TunnelManager } from "../../src/tunnel/manager.ts";
import type { SpawnCloudflared, SpawnNgrok } from "../../src/tunnel/types.ts";
import {
  composeNamedPublicBaseUrl,
  composeNgrokPublicBaseUrl,
  composeQuickPublicBaseUrl,
  parseNgrokTunnelUrl,
  parseQuickTunnelUrl,
} from "../../src/tunnel/url.ts";
import { formatCursorPasteBlock } from "../../src/tunnel/paste-block.ts";

function createMockProcess(lines: string[] = []) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter();

  const child = {
    stdout,
    stderr,
    on: (event: "exit" | "error", listener: (...args: unknown[]) => void) => {
      emitter.on(event, listener);
      return child;
    },
    kill: () => {
      emitter.emit("exit", 0);
    },
    removeAllListeners: () => {
      emitter.removeAllListeners();
    },
  };

  queueMicrotask(() => {
    for (const line of lines) {
      stdout.write(`${line}\n`);
    }
  });

  return child;
}

describe("tunnel url helpers", () => {
  it("composes named public base URL", () => {
    expect(composeNamedPublicBaseUrl("eport.example.com")).toBe(
      "https://eport.example.com/v1",
    );
    expect(composeNamedPublicBaseUrl("https://eport.example.com/path")).toBe(
      "https://eport.example.com/v1",
    );
  });

  it("parses quick tunnel URL and composes /v1 base", () => {
    const line =
      "INF | https://abc-def.trycloudflare.com | Registered tunnel connection";
    expect(parseQuickTunnelUrl(line)).toBe("https://abc-def.trycloudflare.com");
    expect(composeQuickPublicBaseUrl("https://abc-def.trycloudflare.com")).toBe(
      "https://abc-def.trycloudflare.com/v1",
    );
  });

  it("parses ngrok static URL and composes /v1 base", () => {
    const line = "started tunnel url=https://stable-test.ngrok-free.app";
    expect(parseNgrokTunnelUrl(line)).toBe("https://stable-test.ngrok-free.app");
    expect(composeNgrokPublicBaseUrl("stable-test.ngrok-free.app")).toBe(
      "https://stable-test.ngrok-free.app/v1",
    );
  });
});

describe("TunnelManager", () => {
  let manager: TunnelManager | null = null;

  afterEach(async () => {
    if (manager) {
      await manager.stop();
      manager = null;
    }
  });

  it("none mode returns null public URL", async () => {
    const spawnCloudflared: SpawnCloudflared = () => {
      throw new Error("cloudflared should not spawn for none mode");
    };

    manager = new TunnelManager({ spawnCloudflared });
    const result = await manager.start("none", 8787);

    expect(result.publicBaseUrl).toBeNull();
    expect(manager.status()).toEqual({
      mode: "none",
      publicBaseUrl: null,
      connected: false,
    });
  });

  it("named mode composes stable public URL from hostname", async () => {
    const spawnCloudflared: SpawnCloudflared = () =>
      createMockProcess(["Registered tunnel connection"]);

    manager = new TunnelManager({
      namedConfig: { token: "eyJ-test", hostname: "eport.example.com" },
      spawnCloudflared,
    });

    const result = await manager.start("named", 8787);
    expect(result.publicBaseUrl).toBe("https://eport.example.com/v1");
    expect(manager.status().publicBaseUrl).toBe("https://eport.example.com/v1");
  });

  it("named mode requires token and hostname", async () => {
    manager = new TunnelManager({
      namedConfig: {},
      spawnCloudflared: () => createMockProcess(),
    });

    await expect(manager.start("named", 8787)).rejects.toThrow(
      "Named tunnel is not configured",
    );
  });

  it("ngrok mode starts static URL with saved authtoken", async () => {
    let capturedArgs: string[] | undefined;
    let capturedEnv: Record<string, string> | undefined;
    const spawnNgrok: SpawnNgrok = (args, env) => {
      capturedArgs = args;
      capturedEnv = env;
      return createMockProcess(["started tunnel url=https://stable-test.ngrok-free.app"]);
    };

    manager = new TunnelManager({
      ngrokConfig: {
        authtoken: "ngrok-token",
        url: "https://stable-test.ngrok-free.app",
      },
      spawnNgrok,
    });

    const result = await manager.start("ngrok", 8787);
    expect(result.publicBaseUrl).toBe("https://stable-test.ngrok-free.app/v1");
    expect(capturedArgs).toEqual([
      "http",
      "8787",
      "--url",
      "https://stable-test.ngrok-free.app",
    ]);
    expect(capturedEnv).toEqual({ NGROK_AUTHTOKEN: "ngrok-token" });
  });

  it("ngrok mode requires authtoken and URL", async () => {
    manager = new TunnelManager({
      ngrokConfig: {},
      spawnNgrok: () => createMockProcess(),
    });

    await expect(manager.start("ngrok", 8787)).rejects.toThrow(
      "ngrok tunnel is not configured",
    );
  });

  it("quick mode waits for trycloudflare URL in output", async () => {
    const spawnCloudflared: SpawnCloudflared = () =>
      createMockProcess([
        "INF | https://quick-test.trycloudflare.com | Registered tunnel connection",
      ]);

    manager = new TunnelManager({
      spawnCloudflared,
      quickUrlTimeoutMs: 5_000,
    });

    const result = await manager.start("quick", 8787);
    expect(result.publicBaseUrl).toBe("https://quick-test.trycloudflare.com/v1");
    expect(manager.status().connected).toBe(true);
  });

  it("selects mode from start argument without mutating config", async () => {
    const spawnCloudflared: SpawnCloudflared = () => createMockProcess();

    manager = new TunnelManager({
      namedConfig: { token: "eyJ-test", hostname: "stable.example.com" },
      spawnCloudflared,
    });

    const named = await manager.start("named", 8787);
    expect(named.publicBaseUrl).toBe("https://stable.example.com/v1");

    await manager.stop();
    const none = await manager.start("none", 8787);
    expect(none.publicBaseUrl).toBeNull();
  });
});

describe("paste block", () => {
  it("includes base URL, API key, and suggested models", () => {
    const block = formatCursorPasteBlock({
      baseUrl: "https://eport.example.com/v1",
      proxyApiKey: "eport_test_key",
      tunnelMode: "ngrok",
    });

    expect(block).toContain("Base URL:  https://eport.example.com/v1");
    expect(block).toContain("API Key:   eport_test_key");
    expect(block).toContain("gpt-5.5");
    expect(block).toContain("opus-4.8max");
    expect(block).toContain("saved static domain");
    expect(block).not.toContain("quick tunnel URLs change");
  });

  it("warns for quick tunnel mode", () => {
    const block = formatCursorPasteBlock({
      baseUrl: "https://abc.trycloudflare.com/v1",
      proxyApiKey: "eport_test_key",
      tunnelMode: "quick",
    });

    expect(block).toContain("quick tunnel URLs change on every restart");
  });
});
