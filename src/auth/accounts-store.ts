import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type {
  AccountEntry,
  AccountsIndex,
  AccountsStatusSummary,
  ActiveAccountInfo,
  ProviderAccountsStatus,
  ProviderQueue,
  RotationEvent,
  RotationReason,
} from "./account-types.ts";
import { getAccountsIndexPath } from "./accounts-paths.ts";
import type { Provider } from "./types.ts";

function emptyQueue(): ProviderQueue {
  return { order: [], accounts: {} };
}

function emptyIndex(): AccountsIndex {
  return { codex: emptyQueue(), claude: emptyQueue() };
}

function normalizeQueue(raw: unknown): ProviderQueue {
  if (!raw || typeof raw !== "object") return emptyQueue();
  const data = raw as Record<string, unknown>;
  const order = Array.isArray(data.order)
    ? data.order.filter((entry): entry is string => typeof entry === "string")
    : [];
  const accounts: Record<string, AccountEntry> = {};
  if (data.accounts && typeof data.accounts === "object") {
    for (const [id, value] of Object.entries(data.accounts as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      const authPath = typeof entry.authPath === "string" ? entry.authPath : "";
      if (!authPath) continue;
      accounts[id] = {
        id,
        authPath,
        label: typeof entry.label === "string" ? entry.label : undefined,
        accountKey: typeof entry.accountKey === "string" ? entry.accountKey : undefined,
      };
    }
  }

  const filteredOrder = order.filter((id) => accounts[id]);
  const lastRotation =
    data.lastRotation && typeof data.lastRotation === "object"
      ? normalizeRotation(data.lastRotation)
      : undefined;

  return {
    order: filteredOrder,
    accounts,
    lastRotation,
  };
}

function normalizeRotation(raw: unknown): RotationEvent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as Record<string, unknown>;
  const reason = data.reason;
  if (reason !== "429" && reason !== "401-refresh-failed" && reason !== "manual") {
    return undefined;
  }
  const accountId = typeof data.accountId === "string" ? data.accountId : "";
  const at = typeof data.at === "number" ? data.at : 0;
  if (!accountId || !at) return undefined;
  return {
    reason,
    accountId,
    at,
    detail: typeof data.detail === "string" ? data.detail : undefined,
  };
}

function normalizeIndex(raw: unknown): AccountsIndex {
  if (!raw || typeof raw !== "object") return emptyIndex();
  const data = raw as Record<string, unknown>;
  return {
    codex: normalizeQueue(data.codex),
    claude: normalizeQueue(data.claude),
  };
}

export class AccountsStore {
  private readonly home: string;
  private index: AccountsIndex;

  constructor(home: string) {
    this.home = home;
    this.index = this.load();
  }

  get indexPath(): string {
    return getAccountsIndexPath(this.home);
  }

  hasQueue(provider: Provider): boolean {
    return this.index[provider].order.length > 0;
  }

  getQueue(provider: Provider): ProviderQueue {
    return this.index[provider];
  }

  getActiveEntry(provider: Provider): AccountEntry | null {
    const queue = this.index[provider];
    const activeId = queue.order[0];
    if (!activeId) return null;
    return queue.accounts[activeId] ?? null;
  }

  getActiveInfo(provider: Provider): ActiveAccountInfo | null {
    const queue = this.index[provider];
    const activeId = queue.order[0];
    if (!activeId) return null;
    const entry = queue.accounts[activeId];
    if (!entry) return null;
    return {
      provider,
      id: entry.id,
      label: entry.label,
      index: 1,
      accountKey: entry.accountKey,
    };
  }

  listEntries(provider: Provider): Array<AccountEntry & { active: boolean; index: number }> {
    const queue = this.index[provider];
    return queue.order.map((id, idx) => {
      const entry = queue.accounts[id];
      if (!entry) {
        throw new Error(`missing account entry for id ${id}`);
      }
      return {
        ...entry,
        active: idx === 0,
        index: idx + 1,
      };
    });
  }

  addAccount(
    provider: Provider,
    entry: Omit<AccountEntry, "id"> & { id: string },
    options: { makeActive?: boolean } = {},
  ): AccountEntry {
    const queue = this.index[provider];
    const next: AccountEntry = {
      id: entry.id,
      authPath: entry.authPath,
      label: entry.label,
      accountKey: entry.accountKey,
    };
    queue.accounts[next.id] = next;
    if (queue.order.length === 0 || options.makeActive) {
      queue.order = [next.id, ...queue.order.filter((id) => id !== next.id)];
    } else {
      queue.order.push(next.id);
    }
    this.save();
    return next;
  }

  switchActive(provider: Provider, selector: string): ActiveAccountInfo {
    const queue = this.index[provider];
    const targetId = this.resolveSelector(provider, selector);
    const previousId = queue.order[0];
    queue.order = [targetId, ...queue.order.filter((id) => id !== targetId)];
    queue.lastRotation = {
      reason: "manual",
      at: Date.now(),
      accountId: previousId ?? targetId,
      detail: `switched to ${targetId}`,
    };
    this.save();
    const active = this.getActiveInfo(provider);
    if (!active) {
      throw new Error(`failed to switch active account for ${provider}`);
    }
    return active;
  }

  reorder(provider: Provider, indices: number[]): ActiveAccountInfo {
    const queue = this.index[provider];
    const current = this.listEntries(provider);
    if (indices.length !== current.length) {
      throw new Error(
        `reorder requires all ${current.length} account index(es); got ${indices.length}`,
      );
    }

    const seen = new Set<number>();
    const newOrder: string[] = [];
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 1 || index > current.length) {
        throw new Error(`invalid queue index: ${index}`);
      }
      if (seen.has(index)) {
        throw new Error(`duplicate index in reorder: ${index}`);
      }
      seen.add(index);
      const entry = current[index - 1];
      if (!entry) {
        throw new Error(`missing account at index ${index}`);
      }
      newOrder.push(entry.id);
    }

    const previousId = queue.order[0];
    queue.order = newOrder;
    queue.lastRotation = {
      reason: "manual",
      at: Date.now(),
      accountId: previousId ?? newOrder[0] ?? "",
      detail: `reordered to ${newOrder.join(",")}`,
    };
    this.save();

    const active = this.getActiveInfo(provider);
    if (!active) {
      throw new Error(`failed to reorder accounts for ${provider}`);
    }
    return active;
  }

  rotateToNext(provider: Provider, reason: RotationReason, detail?: string): boolean {
    const queue = this.index[provider];
    if (queue.order.length <= 1) {
      return false;
    }

    const exhaustedId = queue.order[0];
    if (!exhaustedId) return false;

    const [, ...rest] = queue.order;
    queue.order = [...rest, exhaustedId];
    queue.lastRotation = {
      reason,
      at: Date.now(),
      accountId: exhaustedId,
      detail,
    };
    this.save();
    return true;
  }

  status(provider?: Provider): AccountsStatusSummary {
    if (provider === "codex") {
      return { codex: this.providerStatus("codex"), claude: this.emptyProviderStatus("claude") };
    }
    if (provider === "claude") {
      return { codex: this.emptyProviderStatus("codex"), claude: this.providerStatus("claude") };
    }
    return {
      codex: this.providerStatus("codex"),
      claude: this.providerStatus("claude"),
    };
  }

  reload(): void {
    this.index = this.load();
  }

  private providerStatus(provider: Provider): ProviderAccountsStatus {
    const queue = this.index[provider];
    return {
      provider,
      queueLength: queue.order.length,
      active: this.getActiveInfo(provider),
      lastRotation: queue.lastRotation,
    };
  }

  private emptyProviderStatus(provider: Provider): ProviderAccountsStatus {
    return {
      provider,
      queueLength: 0,
      active: null,
    };
  }

  private resolveSelector(provider: Provider, selector: string): string {
    const queue = this.index[provider];
    const entries = this.listEntries(provider);
    if (entries.length === 0) {
      throw new Error(`no ${provider} accounts in queue`);
    }

    const asIndex = Number.parseInt(selector, 10);
    if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= entries.length) {
      const entry = entries[asIndex - 1];
      if (!entry) throw new Error(`invalid queue index: ${selector}`);
      return entry.id;
    }

    const byId = queue.accounts[selector];
    if (byId) return byId.id;

    const byLabel = entries.find(
      (entry) => entry.label && entry.label.toLowerCase() === selector.toLowerCase(),
    );
    if (byLabel) return byLabel.id;

    throw new Error(`account not found: ${selector}`);
  }

  private load(): AccountsIndex {
    const path = this.indexPath;
    if (!existsSync(path)) return emptyIndex();
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
      return normalizeIndex(raw);
    } catch {
      return emptyIndex();
    }
  }

  private save(): void {
    mkdirSync(getAccountsIndexPath(this.home).replace(/\/index\.json$/, ""), {
      recursive: true,
    });
    writeFileSync(this.indexPath, `${JSON.stringify(this.index, null, 2)}\n`, "utf8");
  }
}
