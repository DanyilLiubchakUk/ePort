import { ConfigStore } from "../config/index.ts";
import type { SessionFlags } from "../config/types.ts";
import { startEdgeServer } from "../edge/index.ts";
import { AuthManager, formatAuthStatus } from "../auth/index.ts";
import type { Provider } from "../auth/index.ts";

export function runInit(store: ConfigStore, session: SessionFlags): number {
  const profile = store.ensureApiKey();
  store.save(profile);

  if (session.verbose) {
    console.log(`Created config directory: ${store.eportHome}`);
    console.log(`Wrote config: ${store.configPath}`);
  }

  return 0;
}

export function runApiKeyShow(store: ConfigStore): number {
  const profile = store.ensureApiKey();
  if (!profile.proxyApiKey) {
    console.error("No proxy API key found. Run: eport init");
    return 1;
  }
  console.log(profile.proxyApiKey);
  return 0;
}

export function runApiKeyRotate(store: ConfigStore): number {
  const profile = store.rotateApiKey();
  console.log(profile.proxyApiKey);
  console.log("");
  console.log("Proxy API key rotated. Old key is invalid immediately.");
  console.log("Update Cursor → Settings → Models → OpenAI → API key, then Verify.");
  console.log("(Full Base URL paste block ships in a later release.)");
  return 0;
}

export function runNotImplemented(command: string): number {
  console.error(`${command}: not implemented yet`);
  return 1;
}

function parseAuthProvider(value: string | undefined): Provider | undefined {
  if (!value) return undefined;
  if (value === "codex" || value === "claude") return value;
  throw new Error(`unknown auth provider: ${value}`);
}

export async function runAuthLogin(
  home: string,
  providerArg: string | undefined,
  session: SessionFlags,
): Promise<number> {
  try {
    const provider = parseAuthProvider(providerArg);
    const auth = new AuthManager(home);
    await auth.login(provider);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function runAuthStatus(
  home: string,
  options: { json?: boolean; verbose?: boolean },
): number {
  const auth = new AuthManager(home);
  const summary = auth.status();
  process.stdout.write(formatAuthStatus(summary, options));
  return 0;
}

export async function runUp(
  store: ConfigStore,
  home: string,
  session: SessionFlags,
  port?: number,
): Promise<number> {
  const profile = store.ensureApiKey();
  const tunnelMode = session.tunnel ?? profile.tunnelMode;

  if (tunnelMode !== "none") {
    console.error(
      "Named and quick tunnel modes ship in slice 05. Use: eport up --tunnel none",
    );
    return 1;
  }

  const listenPort = port ?? 8787;
  const server = startEdgeServer({
    home,
    port: listenPort,
    config: profile,
    session,
    tunnelMode,
    proxyApiKey: profile.proxyApiKey,
    verbose: session.verbose,
  });

  console.log(`ePort listening on http://${server.host}:${server.port}`);
  console.log(`  local base URL: ${server.baseUrl}`);
  console.log("  tunnel: none (public paste block ships in slice 05)");
  if (profile.proxyApiKey) {
    console.log("  proxy API key: optional for --tunnel none");
    console.log(`  curl example: curl ${server.baseUrl.replace(/\/v1$/, "")}/health`);
  }

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      server.stop();
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

  return 0;
}
