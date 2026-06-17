import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnSyncReturns } from "node:child_process";

import { ConfigStore } from "../../src/config/index.ts";
import {
  formatSchtasksError,
  ServiceError,
  ServiceInstaller,
  WINDOWS_TASK_NAME,
  SERVICE_LABEL,
  getLaunchAgentPlistPath,
  getRunnerCmdPath,
} from "../../src/service/index.ts";
import type { SpawnSyncFn } from "../../src/service/index.ts";

function ok(stdout = ""): SpawnSyncReturns<string> {
  return { status: 0, stdout, stderr: "", pid: 0, output: [stdout, ""], signal: null, error: undefined };
}

function fail(stderr: string, status = 1): SpawnSyncReturns<string> {
  return { status, stdout: "", stderr, pid: 0, output: ["", stderr], signal: null, error: undefined };
}

function createMockSpawn(handlers: Record<string, (args: string[]) => SpawnSyncReturns<string>>): SpawnSyncFn {
  return (command, args) => {
    const key = `${command} ${args[0] ?? ""}`;
    const handler = handlers[key] ?? handlers[command];
    if (!handler) {
      return fail(`unexpected command: ${command} ${args.join(" ")}`);
    }
    return handler(args);
  };
}

describe("formatSchtasksError", () => {
  it("maps access denied to elevated shell guidance", () => {
    const message = formatSchtasksError("/Create", "ERROR: Access is denied.");
    expect(message).toContain("elevated");
    expect(message).toContain("/Create");
  });
});

describe("ServiceInstaller", () => {
  let home: string;
  let store: ConfigStore;
  const cliEntry = join(import.meta.dir, "..", "..", "src", "cli", "index.ts");

  afterEach(() => {
    if (home) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("install on darwin writes launchd plist and bootstraps", () => {
    home = mkServiceHome("darwin");
    store = new ConfigStore(home);
    store.save({ tunnelMode: "named", tunnel: { hostname: "eport.example.com" } });

    const calls: string[] = [];
    const spawnSync = createMockSpawn({
      "launchctl bootout": () => {
        calls.push("bootout");
        return fail("No such process", 3);
      },
      "launchctl bootstrap": (args) => {
        calls.push(`bootstrap:${args[1]}`);
        return ok();
      },
      "launchctl kickstart": () => {
        calls.push("kickstart");
        return ok();
      },
      launchctl: (args) => {
        if (args[0] === "list") return ok(`123\t${SERVICE_LABEL}\n`);
        return fail(`unexpected launchctl ${args.join(" ")}`);
      },
    });

    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      const installer = new ServiceInstaller(store, { home, spawnSync, cliEntry, runtimePath: "/usr/bin/bun" });
      const status = installer.install();
      expect(status.installed).toBe(true);
      expect(status.running).toBe(true);
      expect(calls).toContain("kickstart");
      expect(calls.some((c) => c.startsWith("bootstrap:"))).toBe(true);

      const plist = readFileSync(getLaunchAgentPlistPath(home), "utf8");
      expect(plist).toContain(SERVICE_LABEL);
      expect(plist).toContain(cliEntry);
      expect(plist).toContain("<string>up</string>");
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("install on win32 creates schtasks on logon", () => {
    home = mkServiceHome("win32");
    store = new ConfigStore(home);

    const calls: string[] = [];
    const spawnSync = createMockSpawn({
      schtasks: (args) => {
        calls.push(args.join(" "));
        if (args[0] === "/Create") return ok();
        if (args[0] === "/Run") return ok();
        if (args[0] === "/Query") return ok();
        return fail("unexpected");
      },
    });

    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      const installer = new ServiceInstaller(store, { home, spawnSync, cliEntry, runtimePath: "C:\\bun.exe" });
      const status = installer.install();
      expect(status.installed).toBe(true);
      expect(calls.some((c) => c.includes("/SC ONLOGON"))).toBe(true);
      expect(calls.some((c) => c.includes(WINDOWS_TASK_NAME))).toBe(true);
      expect(readFileSync(getRunnerCmdPath(home), "utf8")).toContain("up");
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("uninstall on win32 removes task but preserves config", () => {
    home = mkServiceHome("win32");
    store = new ConfigStore(home);
    store.save({ proxyApiKey: "eport_test_key" });
    const configBefore = readFileSync(store.configPath, "utf8");

    const spawnSync = createMockSpawn({
      schtasks: (args) => {
        if (args[0] === "/End" || args[0] === "/Delete") return ok();
        return fail("unexpected");
      },
    });

    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      mkdirSync(join(home, ".eport", "service"), { recursive: true });
      writeFileSync(getRunnerCmdPath(home), "@echo off\n", "utf8");
      const installer = new ServiceInstaller(store, { home, spawnSync, cliEntry });
      installer.uninstall();
      expect(existsSync(store.configPath)).toBe(true);
      expect(readFileSync(store.configPath, "utf8")).toBe(configBefore);
      expect(existsSync(getRunnerCmdPath(home))).toBe(false);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("rejects unsupported platforms", () => {
    home = mkServiceHome("linux");
    store = new ConfigStore(home);
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      const installer = new ServiceInstaller(store, { home, cliEntry });
      expect(() => installer.install()).toThrow(ServiceError);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });
});

function mkServiceHome(label: string): string {
  const dir = join(tmpdir(), `eport-service-${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
