import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigStore } from "../../src/config/store.ts";
import { parseArgv } from "../../src/cli/parser.ts";

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
});
