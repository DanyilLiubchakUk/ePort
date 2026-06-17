import type { ConfigStore } from "../config/index.ts";
import {
  effortTokensFor,
  printFlagEquivalent,
  resolveBareModelProvider,
  validateEffort,
} from "../config/index.ts";
import type { ConfigProfile, TunnelMode } from "../config/types.ts";
import { promptChoice, promptLine, promptYesNo } from "./prompt.ts";

export interface ConfigCommandOptions {
  subcommand?: string;
  rest: string[];
  effort?: string;
  configFast?: "on" | "off";
  modelFast?: boolean;
  tunnel?: TunnelMode;
}

function parseConfigFast(value: "on" | "off"): boolean {
  return value === "on";
}

export function applyModelConfig(
  store: ConfigStore,
  bareModel: string,
  options: { effort: string; fast?: boolean },
): ConfigProfile {
  const provider = resolveBareModelProvider(bareModel);
  validateEffort(provider, options.effort);

  const defaults: ConfigProfile["modelDefaults"][string] = {
    effort: options.effort,
  };
  if (options.fast && provider === "codex") {
    defaults.fast = true;
  }

  return store.setModelDefault(bareModel.trim(), defaults);
}

export function applyGlobalFast(store: ConfigStore, enabled: boolean): ConfigProfile {
  return store.save({ globalFastOverride: enabled });
}

export function applyTunnelMode(store: ConfigStore, mode: TunnelMode): ConfigProfile {
  return store.save({ tunnelMode: mode });
}

export function runConfigModel(
  store: ConfigStore,
  bareModel: string | undefined,
  options: { effort?: string; fast?: boolean },
): number {
  try {
    if (!bareModel) {
      console.error("usage: eport config model <bare-model> --effort <level> [--fast]");
      return 1;
    }
    if (!options.effort) {
      console.error("--effort is required for eport config model");
      return 1;
    }

    store.ensureApiKey();
    const profile = applyModelConfig(store, bareModel, {
      effort: options.effort,
      fast: options.fast,
    });

    console.log(`Saved default effort for ${bareModel.trim()}: ${options.effort}`);
    if (options.fast) {
      console.log("  fast tier: enabled for this model");
    }
    printFlagEquivalent(profile);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function runConfigFlags(
  store: ConfigStore,
  options: {
    configFast?: "on" | "off";
    tunnel?: TunnelMode;
  },
): number {
  try {
    store.ensureApiKey();
    let profile = store.load();
    let changed = false;

    if (options.configFast) {
      profile = applyGlobalFast(store, parseConfigFast(options.configFast));
      changed = true;
      console.log(`Global fast override: ${options.configFast}`);
    }

    if (options.tunnel) {
      profile = applyTunnelMode(store, options.tunnel);
      changed = true;
      console.log(`Default tunnel mode: ${options.tunnel}`);
    }

    if (!changed) {
      return 1;
    }

    printFlagEquivalent(profile);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function runConfigWizard(store: ConfigStore): Promise<number> {
  try {
    store.ensureApiKey();
    const modelDefaults: ConfigProfile["modelDefaults"] = {};

    console.log("");
    console.log("Interactive config — set per-model effort defaults and global options.");
    console.log("Bare model IDs only (no suffixes), e.g. gpt-5.5 or opus-4.8.");
    console.log("");

    while (true) {
      const bareModel = await promptLine("Bare model ID (empty to finish models): ");
      if (!bareModel) {
        break;
      }

      const provider = resolveBareModelProvider(bareModel);
      const effortChoices = [...effortTokensFor(provider)];
      console.log("");
      console.log(`Effort for ${bareModel} (${provider}):`);
      const effort = await promptChoice("Select effort", effortChoices);

      let fast = false;
      if (provider === "codex") {
        fast = await promptYesNo("Enable fast tier for this model?");
      }

      modelDefaults[bareModel] = {
        effort,
        ...(fast ? { fast: true } : {}),
      };
      console.log("");
    }

    const globalFast = await promptYesNo("Enable global fast override for all Codex requests?");
    const tunnelMode = await promptChoice("Default tunnel mode", ["named", "quick", "none"]);

    let profile = store.load();
    for (const [bareModelId, defaults] of Object.entries(modelDefaults)) {
      profile = store.setModelDefault(bareModelId, defaults);
    }
    profile = applyGlobalFast(store, globalFast);
    profile = applyTunnelMode(store, tunnelMode as TunnelMode);

    console.log("");
    console.log("Saved config profile.");
    printFlagEquivalent(profile);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function runConfig(
  store: ConfigStore,
  options: ConfigCommandOptions,
): Promise<number> {
  if (options.subcommand === "model") {
    return runConfigModel(store, options.rest[0], {
      effort: options.effort,
      fast: options.modelFast,
    });
  }

  const hasPersistFlags = Boolean(options.configFast || options.tunnel);
  if (hasPersistFlags) {
    return runConfigFlags(store, {
      configFast: options.configFast,
      tunnel: options.tunnel,
    });
  }

  if (options.rest.length > 0 || options.effort || options.modelFast) {
    console.error("usage: eport config [model <bare-model> --effort <level>] [--fast on|off] [--tunnel <mode>]");
    return 1;
  }

  return runConfigWizard(store);
}
