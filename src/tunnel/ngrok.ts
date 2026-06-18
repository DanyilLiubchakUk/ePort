import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

import type { SpawnNgrok } from "./types.ts";

const COMMON_PATHS = [
  "/opt/homebrew/bin/ngrok",
  "/usr/local/bin/ngrok",
  "/usr/bin/ngrok",
  "/usr/local/sbin/ngrok",
  "/snap/bin/ngrok",
  "C:\\Program Files\\ngrok\\ngrok.exe",
  "C:\\Program Files (x86)\\ngrok\\ngrok.exe",
];

export function findNgrokBinary(): string | null {
  try {
    execFileSync("ngrok", ["version"], { stdio: "pipe" });
    return "ngrok";
  } catch {
    // fall through
  }

  for (const candidate of COMMON_PATHS) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const localBin = `${homedir()}/.local/bin/ngrok`;
  if (existsSync(localBin)) {
    return localBin;
  }

  return null;
}

export function defaultSpawnNgrok(
  binary: string,
  args: string[],
  env: Record<string, string> = {},
): ChildProcess {
  return spawn(binary, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
}

export function createNgrokSpawner(
  findBinary: () => string | null = findNgrokBinary,
): SpawnNgrok {
  return (args: string[], env?: Record<string, string>) => {
    const binary = findBinary();
    if (!binary) {
      throw new Error(
        "ngrok not found. Install: https://ngrok.com/download",
      );
    }

    const child = defaultSpawnNgrok(binary, args, env);
    return {
      stdout: child.stdout!,
      stderr: child.stderr!,
      on: (event, listener) => child.on(event, listener),
      kill: () => child.kill(),
      removeAllListeners: () => child.removeAllListeners(),
    };
  };
}
