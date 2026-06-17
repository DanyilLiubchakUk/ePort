import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "src", "cli", "index.ts");

function runEport(args: string[], home: string) {
  return spawnSync("bun", ["run", cliEntry, ...args], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home },
    encoding: "utf8",
  });
}

describe("CLI integration", () => {
  let home: string;

  afterEach(() => {
    if (home) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("prints version", () => {
    home = mkdtempSync(join(tmpdir(), "eport-cli-"));
    const result = runEport(["--version"], home);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
  });

  it("init then api-key show and rotate", () => {
    home = mkdtempSync(join(tmpdir(), "eport-cli-"));

    const init = runEport(["init"], home);
    expect(init.status).toBe(0);

    const configPath = join(home, ".eport", "config");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.proxyApiKey).toMatch(/^eport_/);

    const show = runEport(["api-key", "show"], home);
    expect(show.status).toBe(0);
    expect(show.stdout.trim()).toBe(config.proxyApiKey);

    const rotate = runEport(["api-key", "rotate"], home);
    expect(rotate.status).toBe(0);
    const newKey = rotate.stdout.trim().split("\n")[0];
    expect(newKey).toMatch(/^eport_/);
    expect(newKey).not.toBe(config.proxyApiKey);

    const after = JSON.parse(readFileSync(configPath, "utf8"));
    expect(after.proxyApiKey).toBe(newKey);
  });

  it("session flags on init do not persist overrides", () => {
    home = mkdtempSync(join(tmpdir(), "eport-cli-"));

    runEport(["init"], home);
    const before = readFileSync(join(home, ".eport", "config"), "utf8");

    const withFlags = runEport(["init", "--fast", "--tunnel", "quick", "--verbose"], home);
    expect(withFlags.status).toBe(0);

    const after = readFileSync(join(home, ".eport", "config"), "utf8");
    const parsed = JSON.parse(after);
    expect(parsed.globalFastOverride).toBe(false);
    expect(parsed.tunnelMode).toBe("named");
    expect(after).toBe(before);
  });

  it("stubs unimplemented commands", () => {
    home = mkdtempSync(join(tmpdir(), "eport-cli-"));
    const result = runEport(["up"], home);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not implemented");
  });
});
