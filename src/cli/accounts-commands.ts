import { AuthManager } from "../auth/manager.ts";
import { formatAccountsList, formatAccountsStatus } from "../auth/accounts-format.ts";
import type { Provider } from "../auth/types.ts";

function parseProvider(value: string | undefined): Provider | undefined {
  if (!value) return undefined;
  if (value === "codex" || value === "claude") return value;
  throw new Error(`unknown provider: ${value}`);
}

function parseReorderIndices(args: string[]): number[] {
  const indices: number[] = [];
  for (const arg of args) {
    const parsed = Number.parseInt(arg, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`invalid queue index: ${arg}`);
    }
    indices.push(parsed);
  }
  if (indices.length === 0) {
    throw new Error("reorder requires at least one index");
  }
  return indices;
}

export async function runAccountsAdd(
  home: string,
  providerArg: string | undefined,
  label: string | undefined,
  verbose: boolean,
): Promise<number> {
  try {
    const provider = parseProvider(providerArg);
    if (!provider) {
      throw new Error("provider required: codex or claude");
    }
    const auth = new AuthManager(home);
    await auth.addAccount(provider, label, verbose);
    console.log(`Added ${provider} account to queue.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  return 0;
}

export function runAccountsList(
  home: string,
  providerArg: string | undefined,
  options: { json?: boolean; verbose?: boolean },
): number {
  try {
    const provider = parseProvider(providerArg);
    const auth = new AuthManager(home);
    process.stdout.write(formatAccountsList(auth.accounts, provider, options));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function runAccountsSwitch(
  home: string,
  providerArg: string | undefined,
  selector: string | undefined,
): number {
  try {
    const provider = parseProvider(providerArg);
    if (!provider) throw new Error("provider required: codex or claude");
    if (!selector) throw new Error("account index, id, or label required");
    const auth = new AuthManager(home);
    const active = auth.switchAccount(provider, selector);
    console.log(`Active ${provider} account: ${active.id}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function runAccountsReorder(
  home: string,
  providerArg: string | undefined,
  indexArgs: string[],
): number {
  try {
    const provider = parseProvider(providerArg);
    if (!provider) throw new Error("provider required: codex or claude");
    const indices = parseReorderIndices(indexArgs);
    const auth = new AuthManager(home);
    const active = auth.reorderAccounts(provider, indices);
    console.log(`Active ${provider} account: ${active.id}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function runAccountsStatus(
  home: string,
  providerArg: string | undefined,
  options: { json?: boolean; verbose?: boolean },
): number {
  try {
    const provider = parseProvider(providerArg);
    const auth = new AuthManager(home);
    const summary = auth.accountsStatus(provider);
    process.stdout.write(formatAccountsStatus(summary, options));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
