import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

import type { SpawnCloudflared } from "./types.ts";

const COMMON_PATHS = [
  "/opt/homebrew/bin/cloudflared",
  "/usr/local/bin/cloudflared",
  "/usr/bin/cloudflared",
  "/usr/local/sbin/cloudflared",
  "/snap/bin/cloudflared",
  "C:\\Program Files\\cloudflared\\cloudflared.exe",
  "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
];

export function findCloudflaredBinary(): string | null {
  try {
    execFileSync("cloudflared", ["--version"], { stdio: "pipe" });
    return "cloudflared";
  } catch {
    // fall through
  }

  for (const candidate of COMMON_PATHS) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const localBin = `${homedir()}/.local/bin/cloudflared`;
  if (existsSync(localBin)) {
    return localBin;
  }

  return null;
}

export function defaultSpawnCloudflared(binary: string, args: string[]): ChildProcess {
  return spawn(binary, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function createCloudflaredSpawner(
  findBinary: () => string | null = findCloudflaredBinary,
): SpawnCloudflared {
  return (args: string[]) => {
    const binary = findBinary();
    if (!binary) {
      throw new Error(
        "cloudflared not found. Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
      );
    }

    const child = defaultSpawnCloudflared(binary, args);
    return {
      stdout: child.stdout!,
      stderr: child.stderr!,
      on: (event, listener) => child.on(event, listener),
      kill: () => child.kill(),
      removeAllListeners: () => child.removeAllListeners(),
    };
  };
}
