import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getEportHome } from "../config/paths.ts";

export const SERVICE_LABEL = "com.eport.proxy";
export const WINDOWS_TASK_NAME = "ePort";

export function getServiceLogPath(home = homedir()): string {
  return join(getEportHome(home), "service.log");
}

export function getLaunchAgentPlistPath(home = homedir()): string {
  return join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}

export function getWindowsServiceDir(home = homedir()): string {
  return join(getEportHome(home), "service");
}

export function getRunnerCmdPath(home = homedir()): string {
  return join(getWindowsServiceDir(home), "runner.cmd");
}

export function getLauncherVbsPath(home = homedir()): string {
  return join(getWindowsServiceDir(home), "launcher.vbs");
}

export function resolveCliEntryPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "cli", "index.ts");
}
