export type TunnelMode = "named" | "quick" | "none";

export interface ModelDefaults {
  effort?: string;
  fast?: boolean;
}

export interface NamedTunnelConfig {
  token?: string;
  hostname?: string;
}

export interface ConfigProfile {
  proxyApiKey: string;
  modelDefaults: Record<string, ModelDefaults>;
  globalDefaultEffort?: string;
  globalFastOverride: boolean;
  tunnelMode: TunnelMode;
  tunnel: NamedTunnelConfig;
}

export interface SessionFlags {
  verbose?: boolean;
  tunnel?: TunnelMode;
  fast?: boolean;
}

export function emptyConfigProfile(): ConfigProfile {
  return {
    proxyApiKey: "",
    modelDefaults: {},
    globalFastOverride: false,
    tunnelMode: "named",
    tunnel: {},
  };
}
