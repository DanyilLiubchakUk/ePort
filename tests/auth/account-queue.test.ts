import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AccountsStore } from "../../src/auth/accounts-store.ts";
import { getAccountAuthPath } from "../../src/auth/accounts-paths.ts";
import { AuthManager } from "../../src/auth/manager.ts";
import type { CodexOAuthDeps } from "../../src/auth/codex-oauth.ts";
import {
  makeCodexAuthFile,
  makeTestJwt,
  secondsFromNow,
  writeEportAuth,
} from "./helpers.ts";
import { writeCodexAuthFile } from "../../src/auth/codex-file.ts";

function seedQueueAccount(
  home: string,
  provider: "codex",
  id: string,
  label: string,
  accountKey: string,
  accessExpSeconds: number,
): string {
  const authPath = getAccountAuthPath(home, provider, id);
  const auth = makeCodexAuthFile(accessExpSeconds);
  auth.tokens.account_id = accountKey;
  auth.tokens.access_token = makeTestJwt(accessExpSeconds, accountKey);
  auth.tokens.id_token = auth.tokens.access_token;
  writeCodexAuthFile(authPath, auth);
  return authPath;
}

describe("accounts store", () => {
  let home: string;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("switch moves selected account to front", () => {
    home = mkdtempSync(join(tmpdir(), "eport-accounts-"));
    const store = new AccountsStore(home);
    store.addAccount("codex", {
      id: "a1",
      authPath: seedQueueAccount(home, "codex", "a1", "one", "acct-1", secondsFromNow(3600)),
      label: "one",
      accountKey: "acct-1",
    });
    store.addAccount("codex", {
      id: "a2",
      authPath: seedQueueAccount(home, "codex", "a2", "two", "acct-2", secondsFromNow(3600)),
      label: "two",
      accountKey: "acct-2",
    });

    store.switchActive("codex", "2");
    const listed = store.listEntries("codex");
    expect(listed[0]?.id).toBe("a2");
    expect(listed[0]?.active).toBe(true);
  });

  it("reorder sets new active from first index", () => {
    home = mkdtempSync(join(tmpdir(), "eport-accounts-"));
    const store = new AccountsStore(home);
    for (const [id, label, key] of [
      ["a1", "one", "acct-1"],
      ["a2", "two", "acct-2"],
      ["a3", "three", "acct-3"],
    ] as const) {
      store.addAccount("codex", {
        id,
        authPath: seedQueueAccount(home, "codex", id, label, key, secondsFromNow(3600)),
        label,
        accountKey: key,
      });
    }

    store.reorder("codex", [2, 1, 3]);
    expect(store.listEntries("codex").map((entry) => entry.id)).toEqual(["a2", "a1", "a3"]);
  });

  it("rotateToNext moves exhausted account to back", () => {
    home = mkdtempSync(join(tmpdir(), "eport-accounts-"));
    const store = new AccountsStore(home);
    for (const id of ["a1", "a2", "a3"]) {
      store.addAccount("codex", {
        id,
        authPath: seedQueueAccount(
          home,
          "codex",
          id,
          id,
          `acct-${id}`,
          secondsFromNow(3600),
        ),
      });
    }

    expect(store.rotateToNext("codex", "429")).toBe(true);
    expect(store.listEntries("codex").map((entry) => entry.id)).toEqual(["a2", "a3", "a1"]);
    expect(store.getQueue("codex").lastRotation?.reason).toBe("429");
  });
});

describe("auth manager — account queue rotation", () => {
  let home: string;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  function setupThreeAccountQueue(): AuthManager {
    home = mkdtempSync(join(tmpdir(), "eport-auth-queue-"));
    const auth = new AuthManager(home);
    for (const [id, label, key] of [
      ["a1", "one", "acct-1"],
      ["a2", "two", "acct-2"],
      ["a3", "three", "acct-3"],
    ] as const) {
      auth.accounts.addAccount("codex", {
        id,
        authPath: seedQueueAccount(home, "codex", id, label, key, secondsFromNow(3600)),
        label,
        accountKey: key,
      });
    }
    return auth;
  }

  it("429 rotates to next account in order", async () => {
    const auth = setupThreeAccountQueue();
    expect(auth.accounts.getActiveEntry("codex")?.id).toBe("a1");

    const action = await auth.handleUpstreamError("codex", 429);
    expect(action).toBe("retry");
    expect(auth.accounts.getActiveEntry("codex")?.id).toBe("a2");
    expect(auth.accounts.getQueue("codex").lastRotation?.reason).toBe("429");
  });

  it("401 refresh success does not rotate", async () => {
    home = mkdtempSync(join(tmpdir(), "eport-auth-queue-"));
    const authPath = seedQueueAccount(
      home,
      "codex",
      "a1",
      "one",
      "acct-1",
      secondsFromNow(-30),
    );
    const auth = new AuthManager(home, {
      oauth: {
        exchangeRefreshToken: async () => ({
          access_token: makeCodexAuthFile(secondsFromNow(3600)).tokens.access_token,
          refresh_token: "refresh-test-token",
        }),
      },
    });
    auth.accounts.addAccount("codex", {
      id: "a1",
      authPath,
      label: "one",
      accountKey: "acct-1",
    });
    auth.accounts.addAccount("codex", {
      id: "a2",
      authPath: seedQueueAccount(home, "codex", "a2", "two", "acct-2", secondsFromNow(3600)),
      label: "two",
      accountKey: "acct-2",
    });

    const action = await auth.handleUpstreamError("codex", 401);
    expect(action).toBe("retry");
    expect(auth.accounts.getActiveEntry("codex")?.id).toBe("a1");
  });

  it("401 refresh failure rotates to next account", async () => {
    home = mkdtempSync(join(tmpdir(), "eport-auth-queue-"));
    const auth = new AuthManager(home, {
      oauth: {
        exchangeRefreshToken: async () => {
          throw new Error("refresh failed");
        },
      },
    });
    auth.accounts.addAccount("codex", {
      id: "a1",
      authPath: seedQueueAccount(
        home,
        "codex",
        "a1",
        "one",
        "acct-1",
        secondsFromNow(-30),
      ),
      label: "one",
      accountKey: "acct-1",
    });
    auth.accounts.addAccount("codex", {
      id: "a2",
      authPath: seedQueueAccount(home, "codex", "a2", "two", "acct-2", secondsFromNow(3600)),
      label: "two",
      accountKey: "acct-2",
    });

    const action = await auth.handleUpstreamError("codex", 401);
    expect(action).toBe("retry");
    expect(auth.accounts.getActiveEntry("codex")?.id).toBe("a2");
    expect(auth.accounts.getQueue("codex").lastRotation?.reason).toBe("401-refresh-failed");
  });

  it("manual switch updates active account immediately", () => {
    const auth = setupThreeAccountQueue();
    const active = auth.switchAccount("codex", "3");
    expect(active.id).toBe("a3");
    expect(auth.accounts.getActiveEntry("codex")?.id).toBe("a3");
    expect(auth.accounts.getQueue("codex").lastRotation?.reason).toBe("manual");
  });

  it("coalesced refresh remains single-flight with queue account", async () => {
    home = mkdtempSync(join(tmpdir(), "eport-auth-queue-"));
    const authPath = seedQueueAccount(
      home,
      "codex",
      "a1",
      "one",
      "acct-1",
      secondsFromNow(-30),
    );
    const deps: CodexOAuthDeps = {
      exchangeRefreshToken: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          access_token: makeCodexAuthFile(secondsFromNow(3600)).tokens.access_token,
          refresh_token: "refresh-test-token",
        };
      },
    };
    const auth = new AuthManager(home, { oauth: deps });
    auth.accounts.addAccount("codex", {
      id: "a1",
      authPath,
      label: "one",
      accountKey: "acct-1",
    });

    const results = await Promise.all([
      auth.getCodexCredentials(),
      auth.getCodexCredentials(),
    ]);
    expect(results).toHaveLength(2);
    expect(auth.inflightRefreshCount).toBe(0);
  });

  it("uses legacy single auth when queue is empty", async () => {
    home = mkdtempSync(join(tmpdir(), "eport-auth-queue-"));
    writeEportAuth(home, makeCodexAuthFile(secondsFromNow(3600)));
    const auth = new AuthManager(home);
    const creds = await auth.getCodexCredentials();
    expect(creds.source).toBe("eport-oauth");
    expect(auth.accounts.hasQueue("codex")).toBe(false);
  });
});
