import { join } from "node:path";

import { getEportHome } from "../config/paths.ts";

export function getCodexCliAuthPath(home: string): string {
  return join(home, ".codex", "auth.json");
}

export function getEportCodexAuthPath(home: string): string {
  return join(getEportHome(home), "auth", "codex.json");
}
