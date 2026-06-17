import type { SessionFlags, TunnelMode } from "../config/types.ts";

export interface ParsedArgv {
  command?: string;
  subcommand?: string;
  rest: string[];
  session: SessionFlags;
  port?: number;
  help: boolean;
  version: boolean;
  json: boolean;
}

const TUNNEL_MODES = new Set<TunnelMode>(["named", "quick", "none"]);

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

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "-h" || token === "--help") {
      help = true;
      continue;
    }
    if (token === "-V" || token === "--version") {
      version = true;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--verbose") {
      session.verbose = true;
      continue;
    }
    if (token === "--fast") {
      session.fast = true;
      continue;
    }
    if (token === "--tunnel") {
      const value = argv[++i];
      if (!value || isFlag(value)) {
        throw new Error("--tunnel requires a mode: named, quick, or none");
      }
      const mode = parseTunnelMode(value);
      if (!mode) {
        throw new Error(`invalid tunnel mode: ${value}`);
      }
      session.tunnel = mode;
      continue;
    }
    if (token === "--port") {
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

    positional.push(token);
  }

  const [command, subcommand, ...rest] = positional;

  return {
    command,
    subcommand,
    rest,
    session,
    port,
    help,
    version,
    json,
  };
}
