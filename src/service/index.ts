export { defaultSpawnSync, trimCommandOutput, type SpawnSyncFn } from "./exec.ts";
export {
  formatSchtasksError,
  ServiceError,
  ServiceInstaller,
  type ServiceInstallerDeps,
} from "./installer.ts";
export { readLogTail } from "./log-tail.ts";
export {
  getLaunchAgentPlistPath,
  getLauncherVbsPath,
  getRunnerCmdPath,
  getServiceLogPath,
  getWindowsServiceDir,
  resolveCliEntryPath,
  SERVICE_LABEL,
  WINDOWS_TASK_NAME,
} from "./paths.ts";
export type { ServicePlatform, ServiceStatus } from "./types.ts";
