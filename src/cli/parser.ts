import type { SessionFlags, TunnelMode } from "../config/types.ts";

export interface ParsedArgv {
  command?: string;
  subcommand?: string;
  rest: string[];
  session: SessionFlags;
  port?: number;
  token?: string;
  hostname?: string;
  url?: string;
  label?: string;
  effort?: string;
  configFast?: "on" | "off";
  help: boolean;
  version: boolean;
  json: boolean;
}

const TUNNEL_MODES = new Set<TunnelMode>(["ngrok", "named", "quick", "none"]);

function isFlag(token: string): boolean {
  return token.startsWith("-");
}

function parseTunnelMode(value: string): TunnelMode | null {
  return TUNNEL_MODES.has(value as TunnelMode) ? (value as TunnelMode) : null;
}

export function parseArgv(argv: string[]): ParsedArgv {
  const session: SessionFlags = {};
  const positional: string[] = [];
  let help = false;
  let version = false;
  let json = false;
  let port: number | undefined;
  let tunnelToken: string | undefined;
  let hostname: string | undefined;
  let url: string | undefined;
  let label: string | undefined;
  let effort: string | undefined;
  let configFast: "on" | "off" | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "-V" || arg === "--version") {
      version = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--verbose") {
      session.verbose = true;
      continue;
    }
    if (arg === "--fast") {
      const value = argv[i + 1];
      if (value === "on" || value === "off") {
        i += 1;
        configFast = value;
        continue;
      }
      session.fast = true;
      continue;
    }
    if (arg === "--effort") {
      const value = argv[++i];
      if (!value || isFlag(value)) {
        throw new Error("--effort requires a level");
      }
      effort = value;
      continue;
    }
    if (arg === "--tunnel") {
      const value = argv[++i];
      if (!value || isFlag(value)) {
        throw new Error("--tunnel requires a mode: ngrok, named, quick, or none");
      }
      const mode = parseTunnelMode(value);
      if (!mode) {
        throw new Error(`invalid tunnel mode: ${value}`);
      }
      session.tunnel = mode;
      continue;
    }
    if (arg === "--port") {
      const value = argv[++i];
      if (!value || isFlag(value)) {
        throw new Error("--port requires a number");
      }
      const parsedPort = Number.parseInt(value, 10);
      if (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        throw new Error(`invalid port: ${value}`);
      }
      port = parsedPort;
      continue;
    }
    if (arg === "--token") {
      const value = argv[++i];
      if (!value || isFlag(value)) {
        throw new Error("--token requires a value");
      }
      tunnelToken = value;
      continue;
    }
    if (arg === "--hostname") {
      const value = argv[++i];
      if (!value || isFlag(value)) {
        throw new Error("--hostname requires a value");
      }
      hostname = value;
      continue;
    }
    if (arg === "--url") {
      const value = argv[++i];
      if (!value || isFlag(value)) {
        throw new Error("--url requires a value");
      }
      url = value;
      continue;
    }
    if (arg === "--label") {
      const value = argv[++i];
      if (!value || isFlag(value)) {
        throw new Error("--label requires a value");
      }
      label = value;
      continue;
    }

    positional.push(arg);
  }

  const [command, subcommand, ...rest] = positional;

  return {
    command,
    subcommand,
    rest,
    session,
    port,
    token: tunnelToken,
    hostname,
    url,
    label,
    effort,
    configFast,
    help,
    version,
    json,
  };
}
