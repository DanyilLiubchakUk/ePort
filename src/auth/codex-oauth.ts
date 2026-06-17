import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

import {
  readCodexAuthFile,
  tokenResponseToAuthFile,
  writeCodexAuthFile,
} from "./codex-file.ts";
import { getEportCodexAuthPath } from "./paths.ts";
import type { CodexAuthFile } from "./types.ts";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OAUTH_ISSUER = "https://auth.openai.com";
const TOKEN_URL = `${OAUTH_ISSUER}/oauth/token`;
const CALLBACK_PORT = 1455;

export interface OAuthTokenResponse {
  id_token?: string;
  access_token: string;
  refresh_token?: string;
}

export interface CodexOAuthDeps {
  fetchFn?: typeof fetch;
  openBrowser?: (url: string) => Promise<void>;
  loginWithPkce?: (options: {
    verbose?: boolean;
    fetchFn: typeof fetch;
    openBrowser: (url: string) => Promise<void>;
  }) => Promise<CodexAuthFile>;
  exchangeRefreshToken?: (
    refreshToken: string,
    fetchFn: typeof fetch,
  ) => Promise<OAuthTokenResponse>;
}

function defaultOpenBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const command =
    platform === "darwin"
      ? ["open", url]
      : platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  return Bun.spawn({ cmd: command, stdout: "ignore", stderr: "ignore" })
    .exited.then(() => undefined);
}

function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9\-._~]/g, "")
    .slice(0, 128);
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

function buildAuthorizeUrl(
  redirectUri: string,
  state: string,
  codeChallenge: string,
): string {
  const params: Record<string, string> = {
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "codex_cli_rs",
  };
  const qs = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${OAUTH_ISSUER}/oauth/authorize?${qs}`;
}

async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  fetchFn: typeof fetch,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const response = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Codex OAuth token exchange failed: ${response.status} ${text}`);
  }
  return (await response.json()) as OAuthTokenResponse;
}

export async function exchangeRefreshToken(
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<OAuthTokenResponse> {
  const response = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(`Codex token refresh failed: ${response.status} ${text}`);
    if (text.includes("refresh_token_expired") || text.includes("invalid_grant")) {
      (error as Error & { code?: string }).code = "refresh_token_expired";
    }
    throw error;
  }
  return (await response.json()) as OAuthTokenResponse;
}

async function defaultLoginWithPkce(options: {
  verbose?: boolean;
  fetchFn: typeof fetch;
  openBrowser: (url: string) => Promise<void>;
}): Promise<CodexAuthFile> {
  const { codeVerifier, codeChallenge } = generatePkce();
  const state = randomBytes(16).toString("hex");
  const redirectUri = `http://localhost:${CALLBACK_PORT}/auth/callback`;
  const authUrl = buildAuthorizeUrl(redirectUri, state, codeChallenge);

  const authFile = await new Promise<CodexAuthFile>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);
        if (url.pathname !== "/auth/callback") {
          res.writeHead(404);
          res.end();
          return;
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        if (!code || returnedState !== state) {
          res.writeHead(400);
          res.end("Invalid OAuth callback");
          reject(new Error("Invalid OAuth callback"));
          server.close();
          return;
        }

        const tokens = await exchangeAuthorizationCode(
          code,
          codeVerifier,
          redirectUri,
          options.fetchFn,
        );
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Login successful</h1><p>You can close this window.</p>");
        resolve(tokenResponseToAuthFile(tokens));
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });

    server.listen(CALLBACK_PORT, "127.0.0.1", () => {
      if (options.verbose) {
        console.log(`OAuth redirect URI: ${redirectUri}`);
        console.log(`Open in browser: ${authUrl}`);
      } else {
        console.log("Opening browser for Codex login...");
      }
      void options.openBrowser(authUrl).catch(() => {
        console.log(`Open this URL in your browser:\n${authUrl}`);
      });
    });

    server.on("error", reject);
  });

  return authFile;
}

export function readTestOAuthFixture(home: string): CodexAuthFile | null {
  const fixturePath = process.env.EPORT_TEST_OAUTH_FIXTURE;
  if (!fixturePath) return null;
  return readCodexAuthFile(fixturePath);
}

export async function runCodexOAuthLogin(
  home: string,
  options: { verbose?: boolean; deps?: CodexOAuthDeps } = {},
): Promise<CodexAuthFile> {
  const fixture = readTestOAuthFixture(home);
  if (fixture) {
    const path = getEportCodexAuthPath(home);
    writeCodexAuthFile(path, fixture);
    return fixture;
  }

  const fetchFn = options.deps?.fetchFn ?? fetch;
  const openBrowser = options.deps?.openBrowser ?? defaultOpenBrowser;
  const loginWithPkce =
    options.deps?.loginWithPkce ??
    ((loginOptions) => defaultLoginWithPkce(loginOptions));

  const authFile = await loginWithPkce({ verbose: options.verbose, fetchFn, openBrowser });
  writeCodexAuthFile(getEportCodexAuthPath(home), authFile);
  return authFile;
}

export function resolveOAuthDeps(deps?: CodexOAuthDeps): Required<
  Pick<CodexOAuthDeps, "fetchFn" | "openBrowser" | "loginWithPkce" | "exchangeRefreshToken">
> {
  const fetchFn = deps?.fetchFn ?? fetch;
  const openBrowser = deps?.openBrowser ?? defaultOpenBrowser;
  return {
    fetchFn,
    openBrowser,
    loginWithPkce:
      deps?.loginWithPkce ??
      ((options) => defaultLoginWithPkce(options)),
    exchangeRefreshToken:
      deps?.exchangeRefreshToken ??
      ((refreshToken, fn) => exchangeRefreshToken(refreshToken, fn)),
  };
}
