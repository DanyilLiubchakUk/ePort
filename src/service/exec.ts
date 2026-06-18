import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";

export interface SpawnSyncFn {
  (
    command: string,
    args: string[],
    options?: SpawnSyncOptions,
  ): SpawnSyncReturns<string>;
}

export const defaultSpawnSync: SpawnSyncFn = (command, args, options) =>
  spawnSync(command, args, { encoding: "utf8", ...options }) as SpawnSyncReturns<string>;

export function trimCommandOutput(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}
