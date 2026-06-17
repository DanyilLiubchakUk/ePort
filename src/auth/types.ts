export type Provider = "codex" | "claude";

export type CredentialSource = "cli" | "eport-oauth" | "none";

export interface CodexTokenSet {
  id_token: string;
  access_token: string;
  refresh_token: string;
  account_id: string;
}

export interface CodexAuthFile {
  OPENAI_API_KEY: string | null;
  auth_mode?: string;
  last_refresh?: string | null;
  tokens: CodexTokenSet;
}

export interface CodexCredentials {
  accessToken: string;
  accountId: string;
  refreshToken: string;
  expiresAt: number;
  source: CredentialSource;
  storePath: string;
}

export interface ProviderAuthStatus {
  provider: Provider;
  authenticated: boolean;
  source: CredentialSource;
  expiresAt: number | null;
  needsRefresh: boolean;
  storePath?: string;
  guidance?: string;
}

export interface AuthStatusSummary {
  codex: ProviderAuthStatus;
  claude: ProviderAuthStatus;
}

export const REFRESH_SAFETY_WINDOW_MS = 60_000;

export const REFRESH_TOKEN_EXPIRED_HINT =
  "refresh_token_expired or after `codex logout`: run `eport auth login codex`";
