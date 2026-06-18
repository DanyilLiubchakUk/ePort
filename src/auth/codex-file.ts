import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { extractAccountId, jwtExpiryMs } from "./jwt.ts";
import type { CodexAuthFile, CodexCredentials, CredentialSource } from "./types.ts";
import { REFRESH_SAFETY_WINDOW_MS } from "./types.ts";

export function parseCodexAuthFile(raw: unknown): CodexAuthFile | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const tokens = data.tokens;
  if (!tokens || typeof tokens !== "object") return null;
  const tokenData = tokens as Record<string, unknown>;
  const accessToken =
    typeof tokenData.access_token === "string" ? tokenData.access_token : "";
  const refreshToken =
    typeof tokenData.refresh_token === "string" ? tokenData.refresh_token : "";
  if (!accessToken || !refreshToken) return null;

  const accountId =
    typeof tokenData.account_id === "string"
      ? tokenData.account_id
      : extractAccountId(
          typeof tokenData.id_token === "string" ? tokenData.id_token : accessToken,
        ) ?? "";

  return {
    OPENAI_API_KEY:
      typeof data.OPENAI_API_KEY === "string" ? data.OPENAI_API_KEY : null,
    auth_mode: typeof data.auth_mode === "string" ? data.auth_mode : undefined,
    last_refresh:
      typeof data.last_refresh === "string" ? data.last_refresh : undefined,
    tokens: {
      id_token: typeof tokenData.id_token === "string" ? tokenData.id_token : "",
      access_token: accessToken,
      refresh_token: refreshToken,
      account_id: accountId,
    },
  };
}

export function readCodexAuthFile(path: string): CodexAuthFile | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parseCodexAuthFile(raw);
  } catch {
    return null;
  }
}

export function writeCodexAuthFile(path: string, auth: CodexAuthFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
}

export function credentialsFromAuthFile(
  auth: CodexAuthFile,
  source: CredentialSource,
  storePath: string,
): CodexCredentials {
  return {
    accessToken: auth.tokens.access_token,
    accountId: auth.tokens.account_id,
    refreshToken: auth.tokens.refresh_token,
    expiresAt: jwtExpiryMs(auth.tokens.access_token) ?? 0,
    source,
    storePath,
  };
}

export function isAccessTokenFresh(accessToken: string, now = Date.now()): boolean {
  const expiresAt = jwtExpiryMs(accessToken);
  if (expiresAt === null) return false;
  return now < expiresAt - REFRESH_SAFETY_WINDOW_MS;
}

export function isAccessTokenExpired(accessToken: string, now = Date.now()): boolean {
  const expiresAt = jwtExpiryMs(accessToken);
  if (expiresAt === null) return true;
  return now >= expiresAt;
}

export function needsProactiveRefresh(accessToken: string, now = Date.now()): boolean {
  const expiresAt = jwtExpiryMs(accessToken);
  if (expiresAt === null) return true;
  return now >= expiresAt - REFRESH_SAFETY_WINDOW_MS;
}

export function getFileMtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

export function tokenResponseToAuthFile(data: {
  id_token?: string;
  access_token: string;
  refresh_token?: string;
}): CodexAuthFile {
  const idToken = data.id_token ?? "";
  const accountId = extractAccountId(idToken) ?? extractAccountId(data.access_token) ?? "";
  return {
    OPENAI_API_KEY: null,
    auth_mode: "chatgpt",
    last_refresh: new Date().toISOString(),
    tokens: {
      id_token: idToken,
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? "",
      account_id: accountId,
    },
  };
}
