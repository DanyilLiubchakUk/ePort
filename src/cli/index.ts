import { homedir } from "node:os";

import { ConfigStore } from "../config/index.ts";
import {
  runApiKeyRotate,
  runApiKeyShow,
  runInit,
  runNotImplemented,
} from "./commands.ts";
import {
  getPackageVersion,
  GLOBAL_FLAGS_HELP,
  helpForCommand,
  ROOT_HELP,
} from "./help.ts";
import { parseArgv } from "./parser.ts";

const IMPLEMENTED_COMMANDS = new Set(["init", "api-key"]);

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

export function runCli(argv: string[], home = homedir()): number {
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
    default:
      if (!IMPLEMENTED_COMMANDS.has(parsed.command)) {
        return runNotImplemented(parsed.command);
      }
      return 1;
  }
}

if (import.meta.main) {
  const code = runCli(process.argv.slice(2));
  process.exit(code);
}
