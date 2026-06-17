import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");

export function getPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

export const GLOBAL_FLAGS_HELP = `GLOBAL FLAGS

  --tunnel <mode>    Tunnel mode: named (default), quick, or none
  --fast             Force Codex priority (fast) tier for this session
  --verbose          Verbose logging (request details, tunnel output)

  -h, --help         Show help for the current command
  -V, --version      Print version`;

export const ROOT_HELP = `NAME
  eport — Route Cursor through Codex and Claude subscriptions

SYNOPSIS
  eport [command] [options]

DESCRIPTION
  ePort is a local OpenAI-compatible proxy for Cursor (and other clients).
  It forwards requests to ChatGPT/Codex and Claude Max using subscription
  auth — no metered API keys. Cursor requires a public HTTPS URL; ePort
  exposes one via Cloudflare tunnel (named by default).

COMMANDS
  up                 Start the proxy and tunnel (default workflow)
  init               Initialize ~/.eport config (API key, defaults)
  status             Show proxy, auth, tunnel, and config summary
  auth               Manage subscription login (Codex + Claude)
  accounts           Manage multi-account queues (list, add, switch, reorder)
  api-key            Show or rotate the proxy API key for Cursor
  config             Set model defaults and global options
  tunnel             Configure Cloudflare tunnel (named or quick)
  service            Install and control background service (macOS/Windows)

EXAMPLES
  eport up
  eport init
  eport auth login
  eport api-key show
  eport config
  eport tunnel setup named
  eport service install

NEXT STEPS
  New install? Run:  eport init  →  eport auth login  →  eport config  →  eport tunnel setup named  →  eport up
  Then paste the printed block into Cursor → Settings → Models → OpenAI.
  See README.md for Cloudflare token/hostname setup and Cursor custom models.`;

export const INIT_HELP = `NAME
  eport init — Initialize ePort config directory

SYNOPSIS
  eport init [options]

DESCRIPTION
  Creates ~/.eport/ and writes initial config if missing. Auto-generates a
  cryptographically random proxy API key when none exists (same behavior as
  first eport up). Does not start the proxy or tunnel.

  Use before auth/tunnel setup on a fresh machine, or to ensure config exists
  without starting the server.

OPTIONS
  --force            Regenerate API key only if combined with api-key flow
                     (prefer eport api-key rotate for key rotation)
  --verbose          Show paths written

EXAMPLES
  eport init

NEXT STEPS
  eport auth login
  eport config
  eport tunnel setup named
  eport up  — prints Cursor paste block (Base URL + API key + Verify hint)`;

export const API_KEY_HELP = `NAME
  eport api-key — Manage proxy API key for Cursor

SYNOPSIS
  eport api-key show
  eport api-key rotate

DESCRIPTION
  The proxy API key is what Cursor sends as the OpenAI API key on your custom
  Base URL. Stored in ~/.eport/config.

  Auto-created on first eport up or eport init if missing.

  Required when tunnel is public (named or quick). Optional for local-only
  eport up --tunnel none.

SUBCOMMANDS
  show               Print current API key (for Cursor or curl)
  rotate             Generate new key; invalidate old key immediately; print new
                     Cursor paste block (Base URL + API key + Verify hint)

EXAMPLES
  eport api-key show
  eport api-key rotate

NEXT STEPS
  After rotate: update API key in Cursor → Settings → Models → OpenAI.
  Re-run Verify. Old key stops working immediately.`;

export const AUTH_STATUS_HELP = `NAME
  eport auth status — Show auth state for all providers

SYNOPSIS
  eport auth status [options]

DESCRIPTION
  Shows Codex and Claude credential status: source (CLI reuse vs ePort
  OAuth), expiry, and whether refresh is needed. Read-only.

OPTIONS
  --json             Machine-readable output
  --verbose          Show credential file paths

EXAMPLES
  eport auth status
  eport auth status --json

NEXT STEPS
  Missing or expired?   eport auth login  or  eport auth login codex|claude
  All good?             eport up`;

export const AUTH_LOGIN_HELP = `NAME
  eport auth login — Log in to subscription providers

SYNOPSIS
  eport auth login [codex|claude] [options]

DESCRIPTION
  Authenticates to upstream subscription providers. Without a provider
  argument, logs in to all providers that are missing or stale.

  Hybrid auth: ePort reuses fresh credentials from the Codex CLI
  (~/.codex/auth.json) or Claude Code when available; otherwise runs
  ePort OAuth for that provider.

ARGUMENTS
  codex              Log in to ChatGPT/Codex only
  claude             Log in to Claude Max only
  (none)             Log in to all missing/stale providers

OPTIONS
  --verbose          Show OAuth redirect and token paths

EXAMPLES
  eport auth login
  eport auth login codex

NEXT STEPS
  eport auth status
  eport config
  eport up`;

export const CONFIG_HELP = `NAME
  eport config — Set model defaults and global options

SYNOPSIS
  eport config [options]
  eport config model <bare-model> --effort <level> [--fast]

DESCRIPTION
  Saves per-model effort defaults, global fast override, and default tunnel
  mode to ~/.eport/config. Session flags on eport up do not mutate saved
  settings.

OPTIONS
  --effort <level>   Per-model effort (with model subcommand)
  --fast on|off      Global fast override (Codex priority on every request)
  --fast             Per-model fast tier (Codex only, with model subcommand)
  --tunnel <mode>    Default tunnel mode: named | quick | none

EXAMPLES
  eport config
  eport config --fast on
  eport config --tunnel named
  eport config model gpt-5.5 --effort xhigh
  eport config model opus-4.8 --effort max

NEXT STEPS
  Copy the printed "Flag equivalent" line to script or repeat settings.
  eport up`;

export const SERVICE_HELP = `NAME
  eport service — Install and control background service

SYNOPSIS
  eport service install|uninstall|start|stop|restart|status [options]

DESCRIPTION
  OS auto-start for proxy + tunnel (macOS launchd, Windows schtasks).
  Install runs the same entrypoint as eport up with saved config.

  Do not install when default tunnel mode is quick — URL changes on restart.

SUBCOMMANDS
  install            Register auto-start (named tunnel recommended)
  uninstall          Remove registration; keeps ~/.eport config and auth
  start              Start installed service
  stop               Stop service; keeps registration
  restart            Stop and start (after config/tunnel changes)
  status             Show install/running state, tunnel URL, auth summary

OPTIONS
  --verbose          Show paths (install/start) or log tail (status)
  --json             Machine-readable status (status subcommand)

EXAMPLES
  eport service install
  eport service status --verbose

NEXT STEPS
  Windows: re-run from elevated shell if schtasks reports access denied.
  eport service status  — confirm URL before pasting into Cursor`;

export function helpForCommand(command?: string, subcommand?: string): string | null {
  if (!command) {
    return ROOT_HELP;
  }

  switch (command) {
    case "init":
      return INIT_HELP;
    case "api-key":
      return API_KEY_HELP;
    case "auth":
      if (subcommand === "login") {
        return AUTH_LOGIN_HELP;
      }
      return AUTH_STATUS_HELP;
    case "config":
      return CONFIG_HELP;
    case "service":
      return SERVICE_HELP;
    default:
      if (subcommand) {
        return null;
      }
      return `${command}: not implemented in this release (slice 01).\nRun eport --help for available commands.`;
  }
}
