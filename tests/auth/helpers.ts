import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CodexAuthFile } from "../../src/auth/types.ts";

export function makeTestJwt(expSeconds: number, accountId = "acct-test"): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      exp: expSeconds,
      "https://api.openai.com/auth": { chatgpt_account_id: accountId },
    }),
  ).toString("base64url");
  return `${header}.${payload}.sig`;
}

export function makeCodexAuthFile(accessExpSeconds: number): CodexAuthFile {
  const accessToken = makeTestJwt(accessExpSeconds);
  return {
    OPENAI_API_KEY: null,
    auth_mode: "chatgpt",
    last_refresh: new Date().toISOString(),
    tokens: {
      id_token: accessToken,
      access_token: accessToken,
      refresh_token: "refresh-test-token",
      account_id: "acct-test",
    },
  };
}

export function writeCliAuth(home: string, auth: CodexAuthFile): string {
  const dir = join(home, ".codex");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "auth.json");
  writeFileSync(path, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
  return path;
}

export function writeEportAuth(home: string, auth: CodexAuthFile): string {
  const dir = join(home, ".eport", "auth");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "codex.json");
  writeFileSync(path, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
  return path;
}

export function secondsFromNow(offsetSeconds: number): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}
