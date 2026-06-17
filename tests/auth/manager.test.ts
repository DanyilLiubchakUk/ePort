import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuthManager } from "../../src/auth/manager.ts";
import type { ClaudeOAuthDeps } from "../../src/auth/claude-oauth.ts";
import type { CodexOAuthDeps } from "../../src/auth/codex-oauth.ts";
import {
  makeClaudeAuthFile,
  makeCodexAuthFile,
  msFromNow,
  secondsFromNow,
  writeCliAuth,
  writeClaudeCliAuth,
  writeEportAuth,
  writeEportClaudeAuth,
} from "./helpers.ts";

describe("auth manager — hybrid Codex credentials", () => {
  let home: string;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("reuses fresh CLI credentials without OAuth", async () => {
    home = mkdtempSync(join(tmpdir(), "eport-auth-"));
    writeCliAuth(home, makeCodexAuthFile(secondsFromNow(3600)));

    let oauthCalls = 0;
    const deps: CodexOAuthDeps = {
      loginWithPkce: async () => {
        oauthCalls += 1;
        return makeCodexAuthFile(secondsFromNow(3600));
      },
    };

    const auth = new AuthManager(home, { oauth: deps });
    await auth.login("codex");
    expect(oauthCalls).toBe(0);

    const status = auth.status().codex;
    expect(status.authenticated).toBe(true);
    expect(status.source).toBe("cli");
    expect(status.needsRefresh).toBe(false);

    const creds = await auth.getCodexCredentials();
    expect(creds.source).toBe("cli");
  });

  it("falls back to ePort OAuth store when CLI is stale", async () => {
    home = mkdtempSync(join(tmpdir(), "eport-auth-"));
    writeCliAuth(home, makeCodexAuthFile(secondsFromNow(-120)));
    writeEportAuth(home, makeCodexAuthFile(secondsFromNow(3600)));

    const auth = new AuthManager(home);
    const status = auth.status().codex;
    expect(status.source).toBe("eport-oauth");
    expect(status.authenticated).toBe(true);

    const creds = await auth.getCodexCredentials();
    expect(creds.source).toBe("eport-oauth");
  });

  it("runs OAuth when credentials are missing or stale", async () => {
    home = mkdtempSync(join(tmpdir(), "eport-auth-"));

    let oauthCalls = 0;
    const deps: CodexOAuthDeps = {
      loginWithPkce: async () => {
        oauthCalls += 1;
        return makeCodexAuthFile(secondsFromNow(3600));
      },
    };

    const auth = new AuthManager(home, { oauth: deps });
    await auth.login("codex");
    expect(oauthCalls).toBe(1);

    const status = auth.status().codex;
    expect(status.source).toBe("eport-oauth");
    expect(status.authenticated).toBe(true);
  });
});

describe("auth manager — coalesced refresh", () => {
  let home: string;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("coalesces concurrent refresh into a single in-flight request", async () => {
    home = mkdtempSync(join(tmpdir(), "eport-auth-"));
    writeEportAuth(home, makeCodexAuthFile(secondsFromNow(-30)));

    let refreshCalls = 0;
    const deps: CodexOAuthDeps = {
      exchangeRefreshToken: async () => {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          access_token: makeCodexAuthFile(secondsFromNow(3600)).tokens.access_token,
          refresh_token: "refresh-test-token",
          id_token: makeCodexAuthFile(secondsFromNow(3600)).tokens.id_token,
        };
      },
    };

    const auth = new AuthManager(home, { oauth: deps });
    const results = await Promise.all([
      auth.getCodexCredentials(),
      auth.getCodexCredentials(),
      auth.getCodexCredentials(),
    ]);

    expect(refreshCalls).toBe(1);
    expect(results.every((entry) => entry.source === "eport-oauth")).toBe(true);
    expect(auth.inflightRefreshCount).toBe(0);
  });

  it("does not synchronously refresh on every request when token is still valid", async () => {
    home = mkdtempSync(join(tmpdir(), "eport-auth-"));
    writeEportAuth(home, makeCodexAuthFile(secondsFromNow(3600)));

    let refreshCalls = 0;
    const deps: CodexOAuthDeps = {
      exchangeRefreshToken: async () => {
        refreshCalls += 1;
        return {
          access_token: makeCodexAuthFile(secondsFromNow(3600)).tokens.access_token,
          refresh_token: "refresh-test-token",
        };
      },
    };

    const auth = new AuthManager(home, { oauth: deps });
    const first = await auth.getCodexCredentials();
    const second = await auth.getCodexCredentials();

    expect(first.accessToken).toBe(second.accessToken);
    expect(refreshCalls).toBe(0);
  });
});

describe("auth manager — status", () => {
  let home: string;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("reports refresh guidance for stale credentials", () => {
    home = mkdtempSync(join(tmpdir(), "eport-auth-"));
    writeEportAuth(home, makeCodexAuthFile(secondsFromNow(-30)));

    const auth = new AuthManager(home);
    const status = auth.status().codex;
    expect(status.needsRefresh).toBe(true);
    expect(status.guidance).toContain("eport auth login codex");
  });

  it("keeps Claude status independent when only Codex is authenticated", () => {
    home = mkdtempSync(join(tmpdir(), "eport-auth-"));
    writeCliAuth(home, makeCodexAuthFile(secondsFromNow(3600)));

    const auth = new AuthManager(home);
    const summary = auth.status();
    expect(summary.codex.authenticated).toBe(true);
    expect(summary.claude.authenticated).toBe(false);
    expect(summary.claude.source).toBe("none");
  });
});

describe("auth manager — hybrid Claude credentials", () => {
  let home: string;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("reuses fresh Claude CLI credentials without OAuth", async () => {
    home = mkdtempSync(join(tmpdir(), "eport-auth-"));
    writeClaudeCliAuth(home, makeClaudeAuthFile(msFromNow(3_600_000)));

    let oauthCalls = 0;
    const deps: ClaudeOAuthDeps = {
      loginWithPkce: async () => {
        oauthCalls += 1;
        return makeClaudeAuthFile(msFromNow(3_600_000));
      },
    };

    const auth = new AuthManager(home, { claudeOauth: deps });
    await auth.login("claude");
    expect(oauthCalls).toBe(0);

    const status = auth.status().claude;
    expect(status.authenticated).toBe(true);
    expect(status.source).toBe("cli");

    const creds = await auth.getClaudeCredentials();
    expect(creds.source).toBe("cli");
  });

  it("falls back to ePort Claude OAuth store when CLI is stale", async () => {
    home = mkdtempSync(join(tmpdir(), "eport-auth-"));
    writeClaudeCliAuth(home, makeClaudeAuthFile(msFromNow(-120_000)));
    writeEportClaudeAuth(home, makeClaudeAuthFile(msFromNow(3_600_000)));

    const auth = new AuthManager(home);
    const status = auth.status().claude;
    expect(status.source).toBe("eport-oauth");
    expect(status.authenticated).toBe(true);
  });

  it("coalesces concurrent Claude refresh into a single in-flight request", async () => {
    home = mkdtempSync(join(tmpdir(), "eport-auth-"));
    writeEportClaudeAuth(home, makeClaudeAuthFile(msFromNow(-30_000)));

    let refreshCalls = 0;
    const deps: ClaudeOAuthDeps = {
      exchangeRefreshToken: async () => {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          access_token: makeClaudeAuthFile(msFromNow(3_600_000)).claudeAiOauth.accessToken,
          refresh_token: "claude-refresh-test-token",
          expires_in: 3600,
        };
      },
    };

    const auth = new AuthManager(home, { claudeOauth: deps });
    const results = await Promise.all([
      auth.getClaudeCredentials(),
      auth.getClaudeCredentials(),
    ]);

    expect(refreshCalls).toBe(1);
    expect(results.every((entry) => entry.source === "eport-oauth")).toBe(true);
    expect(auth.inflightClaudeRefreshCount).toBe(0);
  });
});
