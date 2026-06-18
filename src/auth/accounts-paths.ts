import { join } from "node:path";

import { getEportHome } from "../config/paths.ts";
import type { Provider } from "./types.ts";

export function getAccountsIndexPath(home: string): string {
  return join(getEportHome(home), "accounts", "index.json");
}

export function getAccountAuthPath(home: string, provider: Provider, accountId: string): string {
  return join(getEportHome(home), "accounts", provider, `${accountId}.json`);
}
