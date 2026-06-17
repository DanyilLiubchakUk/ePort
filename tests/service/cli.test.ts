import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("service CLI", () => {
  let home: string;

  afterEach(() => {
    if (home) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("warns on install when default tunnel mode is quick", () => {
    home = mkHome();
    runEport(["init"], home);
    writeFileSync(join(home, ".eport", "config"), JSON.stringify({
      proxyApiKey: "eport_test",
      modelDefaults: {},
      globalFastOverride: false,
      tunnelMode: "quick",
      tunnel: {},
    }, null, 2));

    const originalPlatform = process.platform;
    if (originalPlatform !== "darwin" && originalPlatform !== "win32") {
      const result = runEport(["service", "install"], home);
      expect(result.status).toBe(1);
      return;
    }

    const result = runEport(["service", "install"], home);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).toContain("quick");
    expect(combined.toLowerCase()).toContain("warning");
  });

  it("service status reports not installed on fresh home", () => {
    home = mkHome();
    runEport(["init"], home);
    const result = runEport(["service", "status"], home);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("installed:  no");
  });
});

function mkHome(): string {
  const dir = join(tmpdir(), `eport-service-cli-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
