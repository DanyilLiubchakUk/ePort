import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkgPath = join(repoRoot, "package.json");
const cliHelpPath = join(repoRoot, "docs", "CLI-HELP.md");

export function getPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

function loadHelpBlocks(): Record<string, string> {
  const spec = readFileSync(cliHelpPath, "utf8");
  const blocks: Record<string, string> = {};
  const blockPattern = /^## (?:`([^`]+)`|Global flags)\n[\s\S]*?^```\n([\s\S]*?)^```/gm;

  for (const match of spec.matchAll(blockPattern)) {
    const key = match[1] ?? "global-flags";
    blocks[key] = match[2].trimEnd();
  }

  return blocks;
}

const HELP_BLOCKS = loadHelpBlocks();

export const GLOBAL_FLAGS_HELP = HELP_BLOCKS["global-flags"];
export const ROOT_HELP = HELP_BLOCKS.eport;

function commandKey(command: string, subcommand?: string, rest: string[] = []): string {
  if (command === "auth" && subcommand === "login") {
    const provider = rest[0];
    return provider === "codex" || provider === "claude"
      ? `eport auth login ${provider}`
      : "eport auth login";
  }

  if (command === "auth") {
    return "eport auth status";
  }

  if (command === "accounts") {
    return `eport accounts ${subcommand ?? "list"}`;
  }

  if (command === "config" && subcommand === "model") {
    return "eport config model";
  }

  if (command === "tunnel" && subcommand === "setup") {
    const mode = rest[0];
    return mode === "ngrok" || mode === "named" || mode === "quick"
      ? `eport tunnel setup ${mode}`
      : "eport tunnel setup";
  }

  if (command === "service") {
    return `eport service ${subcommand ?? "status"}`;
  }

  return `eport ${command}`;
}

export function helpForCommand(
  command?: string,
  subcommand?: string,
  rest: string[] = [],
): string | null {
  if (!command) {
    return ROOT_HELP;
  }

  return (
    HELP_BLOCKS[commandKey(command, subcommand, rest)] ??
    (subcommand
      ? null
      : `${command}: not implemented in this release (slice 01).\nRun eport --help for available commands.`)
  );
}
