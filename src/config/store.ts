import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

import { generateProxyApiKey } from "./api-key.ts";
import { getConfigPath, getEportHome } from "./paths.ts";
import {
  emptyConfigProfile,
  type ConfigProfile,
  type ModelDefaults,
  type TunnelMode,
} from "./types.ts";

function isTunnelMode(value: unknown): value is TunnelMode {
  return value === "named" || value === "quick" || value === "none";
}

function normalizeProfile(raw: unknown): ConfigProfile {
  const base = emptyConfigProfile();
  if (!raw || typeof raw !== "object") {
    return base;
  }

  const data = raw as Record<string, unknown>;

  return {
    proxyApiKey:
      typeof data.proxyApiKey === "string" ? data.proxyApiKey : base.proxyApiKey,
    modelDefaults:
      data.modelDefaults && typeof data.modelDefaults === "object"
        ? (data.modelDefaults as ConfigProfile["modelDefaults"])
        : base.modelDefaults,
    globalDefaultEffort:
      typeof data.globalDefaultEffort === "string"
        ? data.globalDefaultEffort
        : base.globalDefaultEffort,
    globalFastOverride:
      typeof data.globalFastOverride === "boolean"
        ? data.globalFastOverride
        : base.globalFastOverride,
    tunnelMode: isTunnelMode(data.tunnelMode) ? data.tunnelMode : base.tunnelMode,
    tunnel:
      data.tunnel && typeof data.tunnel === "object"
        ? {
            token:
              typeof (data.tunnel as Record<string, unknown>).token === "string"
                ? ((data.tunnel as Record<string, unknown>).token as string)
                : undefined,
            hostname:
              typeof (data.tunnel as Record<string, unknown>).hostname === "string"
                ? ((data.tunnel as Record<string, unknown>).hostname as string)
                : undefined,
          }
        : base.tunnel,
  };
}

export class ConfigStore {
  private readonly home: string;

  constructor(home = homedir()) {
    this.home = home;
  }

  get configPath(): string {
    return getConfigPath(this.home);
  }

  get eportHome(): string {
    return getEportHome(this.home);
  }

  exists(): boolean {
    return existsSync(this.configPath);
  }

  load(): ConfigProfile {
    if (!this.exists()) {
      return emptyConfigProfile();
    }

    const raw = readFileSync(this.configPath, "utf8");
    return normalizeProfile(JSON.parse(raw));
  }

  save(partial: Partial<ConfigProfile>): ConfigProfile {
    mkdirSync(this.eportHome, { recursive: true });
    const current = this.load();
    const modelDefaults = { ...current.modelDefaults };
    if (partial.modelDefaults) {
      for (const [bareModelId, defaults] of Object.entries(partial.modelDefaults)) {
        modelDefaults[bareModelId] = {
          ...modelDefaults[bareModelId],
          ...defaults,
        };
      }
    }

    const next: ConfigProfile = {
      ...current,
      ...partial,
      modelDefaults,
      tunnel: partial.tunnel ? { ...current.tunnel, ...partial.tunnel } : current.tunnel,
    };
    writeFileSync(this.configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }

  setModelDefault(bareModelId: string, defaults: ModelDefaults): ConfigProfile {
    return this.save({
      modelDefaults: {
        [bareModelId]: defaults,
      },
    });
  }

  ensureApiKey(): ConfigProfile {
    const current = this.load();
    if (current.proxyApiKey) {
      return current;
    }
    return this.save({ proxyApiKey: generateProxyApiKey() });
  }

  rotateApiKey(): ConfigProfile {
    return this.save({ proxyApiKey: generateProxyApiKey() });
  }

  getModelDefault(bareModel: string) {
    return this.load().modelDefaults[bareModel] ?? null;
  }
}
