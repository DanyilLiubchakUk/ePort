import { getCodexCliAuthPath, getEportCodexAuthPath } from "./paths.ts";
import {
  credentialsFromAuthFile,
  getFileMtimeMs,
  isAccessTokenExpired,
  isAccessTokenFresh,
  needsProactiveRefresh,
  readCodexAuthFile,
  tokenResponseToAuthFile,
  writeCodexAuthFile,
} from "./codex-file.ts";
import {
  resolveOAuthDeps,
  runCodexOAuthLogin,
  type CodexOAuthDeps,
} from "./codex-oauth.ts";
import type {
  AuthStatusSummary,
  CodexAuthFile,
  CodexCredentials,
  CredentialSource,
  Provider,
  ProviderAuthStatus,
} from "./types.ts";
import { REFRESH_SAFETY_WINDOW_MS, REFRESH_TOKEN_EXPIRED_HINT as EXPIRED_HINT } from "./types.ts";

interface ResolvedCodexStore {
  source: CredentialSource;
  path: string;
  auth: CodexAuthFile;
  mtimeMs: number;
}

export interface AuthManagerDeps {
  oauth?: CodexOAuthDeps;
}

export class AuthManager {
  private readonly home: string;
  private readonly oauthDeps: ReturnType<typeof resolveOAuthDeps>;
  private cachedCodex: CodexCredentials | null = null;
  private cachedMtimeMs = 0;
  private inflightRefresh: Promise<void> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshFailureHint: string | undefined;

  constructor(home: string, deps: AuthManagerDeps = {}) {
    this.home = home;
    this.oauthDeps = resolveOAuthDeps(deps.oauth);
  }

  status(): AuthStatusSummary {
    return {
      codex: this.inspectCodex(),
      claude: claudeStubStatus(),
    };
  }

  async login(provider?: Provider): Promise<void> {
    const targets = resolveLoginTargets(provider);
    for (const target of targets) {
      if (target === "claude") {
        console.log("Claude auth is not available yet (slice 06). Skipping.");
        continue;
      }
      await this.loginCodex();
    }
  }

  async getCodexCredentials(): Promise<CodexCredentials> {
    const resolved = this.resolveCodexStore();
    if (!resolved) {
      throw new Error("Codex is not authenticated. Run: eport auth login codex");
    }

    const credentials = credentialsFromAuthFile(
      resolved.auth,
      resolved.source,
      resolved.path,
    );
    this.cachedCodex = credentials;
    this.cachedMtimeMs = resolved.mtimeMs;

    if (needsProactiveRefresh(credentials.accessToken) && !isAccessTokenExpired(credentials.accessToken)) {
      this.scheduleBackgroundRefresh();
      return credentials;
    }

    if (isAccessTokenExpired(credentials.accessToken)) {
      await this.coalescedRefresh();
      const refreshed = this.resolveCodexStore();
      if (!refreshed) {
        throw new Error("Codex credentials expired. Run: eport auth login codex");
      }
      const next = credentialsFromAuthFile(
        refreshed.auth,
        refreshed.source,
        refreshed.path,
      );
      this.cachedCodex = next;
      this.cachedMtimeMs = refreshed.mtimeMs;
      return next;
    }

    this.scheduleProactiveTimer(credentials.expiresAt);
    return credentials;
  }

  private inspectCodex(): ProviderAuthStatus {
    const resolved = this.resolveCodexStore();
    if (!resolved) {
      return {
        provider: "codex",
        authenticated: false,
        source: "none",
        expiresAt: null,
        needsRefresh: false,
        guidance: "Run `eport auth login codex` (or `codex login` to reuse CLI credentials).",
      };
    }

    const expiresAt = credentialsFromAuthFile(
      resolved.auth,
      resolved.source,
      resolved.path,
    ).expiresAt;
    const authenticated = !isAccessTokenExpired(resolved.auth.tokens.access_token);
    const needsRefresh =
      needsProactiveRefresh(resolved.auth.tokens.access_token) || !authenticated;

    return {
      provider: "codex",
      authenticated,
      source: resolved.source,
      expiresAt: expiresAt > 0 ? expiresAt : null,
      needsRefresh,
      storePath: resolved.path,
      guidance: this.refreshFailureHint ?? (needsRefresh ? EXPIRED_HINT : undefined),
    };
  }

  private async loginCodex(): Promise<void> {
    const cliPath = getCodexCliAuthPath(this.home);
    const cliAuth = readCodexAuthFile(cliPath);
    if (cliAuth && isAccessTokenFresh(cliAuth.tokens.access_token)) {
      console.log(`Codex: reusing fresh CLI credentials (${cliPath})`);
      this.invalidateCache();
      this.scheduleProactiveTimerFromStore();
      return;
    }

    const eportPath = getEportCodexAuthPath(this.home);
    const eportAuth = readCodexAuthFile(eportPath);
    if (eportAuth && isAccessTokenFresh(eportAuth.tokens.access_token)) {
      console.log(`Codex: reusing fresh ePort OAuth credentials (${eportPath})`);
      this.invalidateCache();
      this.scheduleProactiveTimerFromStore();
      return;
    }

    await runCodexOAuthLogin(this.home, {
      deps: {
        fetchFn: this.oauthDeps.fetchFn,
        openBrowser: this.oauthDeps.openBrowser,
        loginWithPkce: this.oauthDeps.loginWithPkce,
      },
    });
    console.log(`Codex: saved ePort OAuth credentials (${eportPath})`);
    this.invalidateCache();
    this.refreshFailureHint = undefined;
    this.scheduleProactiveTimerFromStore();
  }

  private resolveCodexStore(): ResolvedCodexStore | null {
    const cliPath = getCodexCliAuthPath(this.home);
    const eportPath = getEportCodexAuthPath(this.home);
    const cliAuth = readCodexAuthFile(cliPath);
    const eportAuth = readCodexAuthFile(eportPath);

    const candidates: ResolvedCodexStore[] = [];
    if (cliAuth) {
      candidates.push({
        source: "cli",
        path: cliPath,
        auth: cliAuth,
        mtimeMs: getFileMtimeMs(cliPath),
      });
    }
    if (eportAuth) {
      candidates.push({
        source: "eport-oauth",
        path: eportPath,
        auth: eportAuth,
        mtimeMs: getFileMtimeMs(eportPath),
      });
    }

    const freshCli = candidates.find(
      (entry) =>
        entry.source === "cli" &&
        isAccessTokenFresh(entry.auth.tokens.access_token),
    );
    if (freshCli) return this.withCache(freshCli);

    const freshEport = candidates.find(
      (entry) =>
        entry.source === "eport-oauth" &&
        isAccessTokenFresh(entry.auth.tokens.access_token),
    );
    if (freshEport) return this.withCache(freshEport);

    const refreshableCli = candidates.find(
      (entry) => entry.source === "cli" && entry.auth.tokens.refresh_token,
    );
    if (refreshableCli) return this.withCache(refreshableCli);

    const refreshableEport = candidates.find(
      (entry) => entry.source === "eport-oauth" && entry.auth.tokens.refresh_token,
    );
    if (refreshableEport) return this.withCache(refreshableEport);

    return null;
  }

  private withCache(entry: ResolvedCodexStore): ResolvedCodexStore {
    if (
      this.cachedCodex &&
      this.cachedCodex.storePath === entry.path &&
      this.cachedMtimeMs === entry.mtimeMs
    ) {
      return {
        ...entry,
        auth: this.authFileFromCache(entry.auth),
      };
    }
    return entry;
  }

  private authFileFromCache(fallback: CodexAuthFile): CodexAuthFile {
    if (!this.cachedCodex) return fallback;
    return {
      ...fallback,
      tokens: {
        id_token: fallback.tokens.id_token,
        access_token: this.cachedCodex.accessToken,
        refresh_token: this.cachedCodex.refreshToken,
        account_id: this.cachedCodex.accountId,
      },
      last_refresh: fallback.last_refresh ?? new Date().toISOString(),
    };
  }

  private scheduleBackgroundRefresh(): void {
    void this.coalescedRefresh().catch((error) => {
      this.refreshFailureHint =
        error instanceof Error && (error as Error & { code?: string }).code === "refresh_token_expired"
          ? EXPIRED_HINT
          : String(error);
    });
  }

  private scheduleProactiveTimerFromStore(): void {
    const resolved = this.resolveCodexStore();
    if (!resolved) return;
    const expiresAt = credentialsFromAuthFile(
      resolved.auth,
      resolved.source,
      resolved.path,
    ).expiresAt;
    this.scheduleProactiveTimer(expiresAt);
  }

  private scheduleProactiveTimer(expiresAt: number): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (expiresAt <= 0) return;

    const delay = Math.max(
      0,
      expiresAt - REFRESH_SAFETY_WINDOW_MS - Date.now(),
    );
    const timer = setTimeout(() => {
      this.refreshTimer = null;
      this.scheduleBackgroundRefresh();
    }, delay);
    if (typeof timer.unref === "function") timer.unref();
    this.refreshTimer = timer;
  }

  private coalescedRefresh(): Promise<void> {
    if (this.inflightRefresh) return this.inflightRefresh;
    this.inflightRefresh = this.refreshOnce().finally(() => {
      this.inflightRefresh = null;
    });
    return this.inflightRefresh;
  }

  private async refreshOnce(): Promise<void> {
    const resolved = this.resolveCodexStore();
    if (!resolved) {
      throw new Error("No Codex credentials to refresh");
    }

    const refreshToken = resolved.auth.tokens.refresh_token;
    if (!refreshToken) {
      throw new Error("Codex credentials have no refresh_token");
    }

    const tokens = await this.oauthDeps.exchangeRefreshToken(
      refreshToken,
      this.oauthDeps.fetchFn,
    );
    const merged = tokenResponseToAuthFile({
      id_token: tokens.id_token ?? resolved.auth.tokens.id_token,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? refreshToken,
    });

    writeCodexAuthFile(resolved.path, merged);
    this.cachedCodex = credentialsFromAuthFile(
      merged,
      resolved.source,
      resolved.path,
    );
    this.cachedMtimeMs = getFileMtimeMs(resolved.path);
    this.refreshFailureHint = undefined;
    this.scheduleProactiveTimer(this.cachedCodex.expiresAt);
  }

  private invalidateCache(): void {
    this.cachedCodex = null;
    this.cachedMtimeMs = 0;
  }

  /** Test hook: count in-flight refresh operations. */
  get inflightRefreshCount(): number {
    return this.inflightRefresh ? 1 : 0;
  }
}

function resolveLoginTargets(provider?: Provider): Provider[] {
  if (provider === "codex") return ["codex"];
  if (provider === "claude") return ["claude"];
  return ["codex", "claude"];
}

function claudeStubStatus(): ProviderAuthStatus {
  return {
    provider: "claude",
    authenticated: false,
    source: "none",
    expiresAt: null,
    needsRefresh: false,
    guidance: "Claude auth ships in slice 06. Run `eport auth login claude` later.",
  };
}

export function formatAuthStatus(
  summary: AuthStatusSummary,
  options: { json?: boolean; verbose?: boolean } = {},
): string {
  if (options.json) {
    return `${JSON.stringify(summary, null, 2)}\n`;
  }

  const lines: string[] = [];
  for (const row of [summary.codex, summary.claude]) {
    lines.push(`${capitalize(row.provider)}:`);
    lines.push(`  source:     ${formatSource(row)}`);
    lines.push(`  status:     ${row.authenticated ? "authenticated" : "not authenticated"}`);
    lines.push(`  expires:    ${formatExpiry(row.expiresAt)}`);
    lines.push(`  refresh:    ${row.needsRefresh ? "needed" : "not needed"}`);
    if (options.verbose && row.storePath) {
      lines.push(`  path:       ${row.storePath}`);
    }
    if (row.guidance) {
      lines.push(`  note:       ${row.guidance}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSource(row: ProviderAuthStatus): string {
  if (row.source === "cli") return "CLI reuse (~/.codex/auth.json)";
  if (row.source === "eport-oauth") return "ePort OAuth";
  return "none";
}

function formatExpiry(expiresAt: number | null): string {
  if (!expiresAt) return "—";
  return new Date(expiresAt).toISOString();
}

export { REFRESH_TOKEN_EXPIRED_HINT } from "./types.ts";
