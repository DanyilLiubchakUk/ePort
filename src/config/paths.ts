import { homedir } from "node:os";
import { join } from "node:path";

export function getEportHome(home = homedir()): string {
  return join(home, ".eport");
}

export function getConfigPath(home = homedir()): string {
  return join(getEportHome(home), "config");
}
