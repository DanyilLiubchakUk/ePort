import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  applyGlobalFast,
  applyModelConfig,
  applyTunnelMode,
} from "../../src/cli/config-commands.ts";
import { ConfigStore } from "../../src/config/store.ts";
import { formatFlagEquivalent } from "../../src/config/flag-equivalent.ts";
import { validateEffort } from "../../src/config/effort.ts";
import { parseArgv } from "../../src/cli/parser.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "src", "cli", "index.ts");

function runEport(args: string[], home: string) {
  return spawnSync("bun", ["run", cliEntry, ...args], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home },
    encoding: "utf8",
  });
}

describe("ConfigStore", () => {
  let home: string;

  afterEach(() => {
    if (home) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("init writes expected profile with generated api key", () => {
    home = mkdtempSync(join(tmpdir(), "eport-config-"));
    const store = new ConfigStore(home);

    expect(store.exists()).toBe(false);

    const profile = store.ensureApiKey();

    expect(store.exists()).toBe(true);
    expect(profile.proxyApiKey).toMatch(/^eport_/);
    expect(profile.modelDefaults).toEqual({});
    expect(profile.globalFastOverride).toBe(false);
    expect(profile.tunnelMode).toBe("named");
    expect(profile.tunnel).toEqual({});

    const onDisk = JSON.parse(readFileSync(store.configPath, "utf8"));
    expect(onDisk.proxyApiKey).toBe(profile.proxyApiKey);
  });

  it("rotate changes proxy api key", () => {
    home = mkdtempSync(join(tmpdir(), "eport-config-"));
    const store = new ConfigStore(home);
    const first = store.ensureApiKey().proxyApiKey;

    const rotated = store.rotateApiKey();

    expect(rotated.proxyApiKey).not.toBe(first);
    expect(store.load().proxyApiKey).toBe(rotated.proxyApiKey);
  });

  it("save merges partial updates", () => {
    home = mkdtempSync(join(tmpdir(), "eport-config-"));
    const store = new ConfigStore(home);
    store.ensureApiKey();

    store.save({ globalFastOverride: true, tunnelMode: "quick" });

    const loaded = store.load();
    expect(loaded.globalFastOverride).toBe(true);
    expect(loaded.tunnelMode).toBe("quick");
    expect(loaded.proxyApiKey).toMatch(/^eport_/);
  });

  it("merges per-model defaults without replacing other models", () => {
    home = mkdtempSync(join(tmpdir(), "eport-config-"));
    const store = new ConfigStore(home);
    store.ensureApiKey();

    store.setModelDefault("gpt-5.5", { effort: "xhigh" });
    store.setModelDefault("opus-4.8", { effort: "max" });

    const loaded = store.load();
    expect(loaded.modelDefaults["gpt-5.5"]).toEqual({ effort: "xhigh" });
    expect(loaded.modelDefaults["opus-4.8"]).toEqual({ effort: "max" });
  });

  it("parses global session flags without touching config", () => {
    home = mkdtempSync(join(tmpdir(), "eport-config-"));
    const store = new ConfigStore(home);
    store.ensureApiKey();
    const before = readFileSync(store.configPath, "utf8");

    const parsed = parseArgv(["init", "--fast", "--tunnel", "quick", "--verbose"]);
    expect(parsed.session.fast).toBe(true);
    expect(parsed.session.tunnel).toBe("quick");
    expect(parsed.session.verbose).toBe(true);

    const after = readFileSync(store.configPath, "utf8");
    expect(after).toBe(before);
    expect(existsSync(store.configPath)).toBe(true);
  });

  it("parses config --fast on|off separately from session --fast", () => {
    const persisted = parseArgv(["config", "--fast", "on"]);
    expect(persisted.configFast).toBe("on");
    expect(persisted.session.fast).toBeUndefined();

    const session = parseArgv(["up", "--fast"]);
    expect(session.session.fast).toBe(true);
    expect(session.configFast).toBeUndefined();
  });

  it("flag helpers and wizard path produce equivalent profile", () => {
    home = mkdtempSync(join(tmpdir(), "eport-config-"));
    const flagsStore = new ConfigStore(home);
    flagsStore.ensureApiKey();
    applyModelConfig(flagsStore, "gpt-5.5", { effort: "xhigh", fast: true });
    applyModelConfig(flagsStore, "opus-4.8", { effort: "max" });
    applyGlobalFast(flagsStore, false);
    applyTunnelMode(flagsStore, "quick");
    const flagsProfile = flagsStore.load();

    home = mkdtempSync(join(tmpdir(), "eport-config-"));
    const wizardStore = new ConfigStore(home);
    wizardStore.ensureApiKey();
    wizardStore.setModelDefault("gpt-5.5", { effort: "xhigh", fast: true });
    wizardStore.setModelDefault("opus-4.8", { effort: "max" });
    applyGlobalFast(wizardStore, false);
    applyTunnelMode(wizardStore, "quick");
    const wizardProfile = wizardStore.load();

    expect(wizardProfile.modelDefaults).toEqual(flagsProfile.modelDefaults);
    expect(wizardProfile.globalFastOverride).toBe(flagsProfile.globalFastOverride);
    expect(wizardProfile.tunnelMode).toBe(flagsProfile.tunnelMode);
    expect(formatFlagEquivalent(flagsProfile)).toBe(
      "eport config model gpt-5.5 --effort xhigh --fast && eport config model opus-4.8 --effort max && eport config --fast off && eport config --tunnel quick",
    );
  });

  it("rejects xhigh effort for Claude models", () => {
    expect(() => validateEffort("claude", "xhigh")).toThrow(/xhigh/);
    expect(() => validateEffort("claude", "max")).not.toThrow();
    expect(() => validateEffort("codex", "xhigh")).not.toThrow();
  });
});

describe("config CLI integration", () => {
  let home: string;

  afterEach(() => {
    if (home) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("persists model, fast, and tunnel flags", () => {
    home = mkdtempSync(join(tmpdir(), "eport-config-cli-"));
    runEport(["init"], home);

    const model = runEport(["config", "model", "gpt-5.5", "--effort", "xhigh", "--fast"], home);
    expect(model.status).toBe(0);
    expect(model.stdout).toContain("Flag equivalent:");

    const fast = runEport(["config", "--fast", "on"], home);
    expect(fast.status).toBe(0);

    const tunnel = runEport(["config", "--tunnel", "none"], home);
    expect(tunnel.status).toBe(0);

    const config = JSON.parse(readFileSync(join(home, ".eport", "config"), "utf8"));
    expect(config.modelDefaults["gpt-5.5"]).toEqual({ effort: "xhigh", fast: true });
    expect(config.globalFastOverride).toBe(true);
    expect(config.tunnelMode).toBe("none");
  });

  it("rejects Claude xhigh effort via CLI", () => {
    home = mkdtempSync(join(tmpdir(), "eport-config-cli-"));
    runEport(["init"], home);

    const result = runEport(["config", "model", "opus-4.8", "--effort", "xhigh"], home);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("xhigh");
  });

  it("session up flags do not persist to config", () => {
    home = mkdtempSync(join(tmpdir(), "eport-config-cli-"));
    runEport(["init"], home);
    runEport(["config", "--fast", "off"], home);
    const before = readFileSync(join(home, ".eport", "config"), "utf8");

    const child = spawnSync(
      "bun",
      ["run", cliEntry, "up", "--tunnel", "none", "--fast", "--port", "18788"],
      {
        cwd: repoRoot,
        env: { ...process.env, HOME: home },
        encoding: "utf8",
        timeout: 1500,
      },
    );

    expect(child.stdout).toContain("tunnel: none");
    const after = readFileSync(join(home, ".eport", "config"), "utf8");
    expect(after).toBe(before);
    expect(JSON.parse(after).globalFastOverride).toBe(false);
    expect(JSON.parse(after).tunnelMode).toBe("named");
  });
});
