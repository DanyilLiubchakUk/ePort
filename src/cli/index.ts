import { homedir } from "node:os";

import { ConfigStore } from "../config/index.ts";
import {
  runAccountsAdd,
  runAccountsList,
  runAccountsReorder,
  runAccountsStatus,
  runAccountsSwitch,
} from "./accounts-commands.ts";
import {
  runApiKeyRotate,
  runApiKeyShow,
  runAuthLogin,
  runAuthStatus,
  runInit,
  runNotImplemented,
  runUp,
} from "./commands.ts";
import { runStatus } from "./status.ts";
import {
  getPackageVersion,
  GLOBAL_FLAGS_HELP,
  helpForCommand,
  ROOT_HELP,
} from "./help.ts";
import { parseArgv } from "./parser.ts";
import { runTunnel } from "./tunnel-commands.ts";

const IMPLEMENTED_COMMANDS = new Set([
  "init",
  "api-key",
  "auth",
  "accounts",
  "up",
  "tunnel",
  "status",
]);

function printHelp(command?: string, subcommand?: string): void {
  const text = helpForCommand(command, subcommand);
  if (text) {
    console.log(text);
    if (!command) {
      console.log("");
      console.log(GLOBAL_FLAGS_HELP);
    }
    return;
  }
  console.log(ROOT_HELP);
  console.log("");
  console.log(GLOBAL_FLAGS_HELP);
}

export async function runCli(argv: string[], home = homedir()): Promise<number> {
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (parsed.version && !parsed.command) {
    console.log(getPackageVersion());
    return 0;
  }

  if (parsed.help && !parsed.command) {
    printHelp();
    return 0;
  }

  if (!parsed.command) {
    printHelp();
    return 0;
  }

  if (parsed.help) {
    printHelp(parsed.command, parsed.subcommand);
    return 0;
  }

  const store = new ConfigStore(home);

  switch (parsed.command) {
    case "init":
      return runInit(store, parsed.session);
    case "api-key": {
      const action = parsed.subcommand;
      if (!action || action === "show") {
        return runApiKeyShow(store);
      }
      if (action === "rotate") {
        return runApiKeyRotate(store);
      }
      console.error(`unknown api-key subcommand: ${action}`);
      printHelp("api-key");
      return 1;
    }
    case "auth": {
      const action = parsed.subcommand;
      if (!action || action === "status") {
        return runAuthStatus(home, {
          json: parsed.json,
          verbose: parsed.session.verbose,
        });
      }
      if (action === "login") {
        const provider = parsed.rest[0];
        if (provider && provider !== "codex" && provider !== "claude") {
          console.error(`unknown auth provider: ${provider}`);
          printHelp("auth", "login");
          return 1;
        }
        return runAuthLogin(home, provider, parsed.session);
      }
      console.error(`unknown auth subcommand: ${action}`);
      printHelp("auth");
      return 1;
    }
    case "up":
      return runUp(store, home, parsed.session, parsed.port);
    case "status":
      return runStatus(home, {
        json: parsed.json,
        verbose: parsed.session.verbose,
      });
    case "tunnel":
      return runTunnel(store, parsed.subcommand, parsed.rest, {
        token: parsed.token,
        hostname: parsed.hostname,
      });
    case "accounts": {
      const action = parsed.subcommand;
      if (!action || action === "list") {
        return runAccountsList(home, parsed.rest[0], {
          json: parsed.json,
          verbose: parsed.session.verbose,
        });
      }
      if (action === "add") {
        return runAccountsAdd(
          home,
          parsed.rest[0],
          parsed.label,
          Boolean(parsed.session.verbose),
        );
      }
      if (action === "switch") {
        return runAccountsSwitch(home, parsed.rest[0], parsed.rest[1]);
      }
      if (action === "reorder") {
        return runAccountsReorder(home, parsed.rest[0], parsed.rest.slice(1));
      }
      if (action === "status") {
        return runAccountsStatus(home, parsed.rest[0], {
          json: parsed.json,
          verbose: parsed.session.verbose,
        });
      }
      console.error(`unknown accounts subcommand: ${action}`);
      return 1;
    }
    default:
      if (!IMPLEMENTED_COMMANDS.has(parsed.command)) {
        return runNotImplemented(parsed.command);
      }
      return 1;
  }
}

if (import.meta.main) {
  void runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
