import type { Provider } from "./types.ts";

export type RotationReason = "429" | "401-refresh-failed" | "manual";

export interface AccountEntry {
  id: string;
  label?: string;
  authPath: string;
  accountKey?: string;
}

export interface RotationEvent {
  reason: RotationReason;
  at: number;
  accountId: string;
  detail?: string;
}

export interface ProviderQueue {
  order: string[];
  accounts: Record<string, AccountEntry>;
  lastRotation?: RotationEvent;
}

export interface AccountsIndex {
  codex: ProviderQueue;
  claude: ProviderQueue;
}

export interface ActiveAccountInfo {
  provider: Provider;
  id: string;
  label?: string;
  index: number;
  accountKey?: string;
}

export interface ProviderAccountsStatus {
  provider: Provider;
  queueLength: number;
  active: ActiveAccountInfo | null;
  lastRotation?: RotationEvent;
}

export interface AccountsStatusSummary {
  codex: ProviderAccountsStatus;
  claude: ProviderAccountsStatus;
}

export const ROTATION_POLICY_LINES = [
  "429  → rotate to next account; move exhausted to back; retry once",
  "401  → refresh current account first; rotate only if refresh fails; retry once",
  "5xx  → no rotation",
  "manual switch/reorder → active changes for subsequent requests",
] as const;
