import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "src", "cli", "index.ts");

function runEport(args: string[], home: string, extraEnv: Record<string, string> = {}) {
  return spawnSync("bun", ["run", cliEntry, ...args], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home, ...extraEnv },
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

  it("rejects named tunnel until slice 05", () => {
    home = mkdtempSync(join(tmpdir(), "eport-cli-"));
    const result = runEport(["up"], home);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("slice 05");
  });

  it("up --tunnel none prints listen URL", () => {
    home = mkdtempSync(join(tmpdir(), "eport-cli-"));
    runEport(["init"], home);

    const child = spawnSync(
      "bun",
      ["run", cliEntry, "up", "--tunnel", "none", "--port", "18787"],
      {
        cwd: repoRoot,
        env: { ...process.env, HOME: home },
        encoding: "utf8",
        timeout: 1500,
      },
    );

    expect(child.stdout).toContain("ePort listening on http://127.0.0.1:18787");
    expect(child.stdout).toContain("local base URL: http://127.0.0.1:18787/v1");
  });

  it("auth status after mocked login shows Codex ePort OAuth row", () => {
    home = mkdtempSync(join(tmpdir(), "eport-cli-"));
    const fixtureDir = mkdtempSync(join(tmpdir(), "eport-oauth-fixture-"));
    const fixturePath = join(fixtureDir, "codex.json");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({
        exp,
        "https://api.openai.com/auth": { chatgpt_account_id: "acct-cli-test" },
      }),
    ).toString("base64url");
    const accessToken = `${header}.${payload}.sig`;
    const fixture = {
      OPENAI_API_KEY: null,
      auth_mode: "chatgpt",
      tokens: {
        id_token: accessToken,
        access_token: accessToken,
        refresh_token: "refresh-cli-test",
        account_id: "acct-cli-test",
      },
    };
    writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

    const login = runEport(["auth", "login", "codex"], home, {
      EPORT_TEST_OAUTH_FIXTURE: fixturePath,
    });
    expect(login.status).toBe(0);

    const status = runEport(["auth", "status"], home);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain("Codex:");
    expect(status.stdout).toContain("ePort OAuth");
    expect(status.stdout).toContain("authenticated");

    rmSync(fixtureDir, { recursive: true, force: true });
  });
});
