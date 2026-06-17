import { ConfigStore } from "../config/index.ts";
import type { SessionFlags } from "../config/types.ts";
import { startEdgeServer } from "../edge/index.ts";
import { AuthManager, formatAuthStatus } from "../auth/index.ts";
import type { Provider } from "../auth/index.ts";
import {
  composeNamedPublicBaseUrl,
  printCursorPasteBlock,
  TunnelManager,
} from "../tunnel/index.ts";
import { writeProxyRuntimeState } from "../runtime/state.ts";

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

  const hostname = profile.tunnel.hostname?.trim();
  if (hostname && profile.tunnelMode !== "none") {
    printCursorPasteBlock({
      baseUrl: composeNamedPublicBaseUrl(hostname),
      proxyApiKey: profile.proxyApiKey,
      tunnelMode: profile.tunnelMode,
    });
  } else {
    console.log("(Run eport up for the full Base URL paste block.)");
  }

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

  const tunnel = new TunnelManager({
    namedConfig: profile.tunnel,
    verbose: session.verbose,
  });

  try {
    const tunnelResult = await tunnel.start(tunnelMode, server.port);
    writeProxyRuntimeState(home, {
      pid: process.pid,
      port: server.port,
      startedAt: Date.now(),
      tunnelMode,
      publicBaseUrl: tunnelResult.publicBaseUrl,
      activeAccounts: {},
    });

    console.log(`ePort listening on http://${server.host}:${server.port}`);
    console.log(`  local base URL: ${server.baseUrl}`);
    console.log(`  tunnel: ${tunnelMode}`);

    if (tunnelMode === "none") {
      if (profile.proxyApiKey) {
        console.log("  proxy API key: optional for --tunnel none");
        console.log(`  curl example: curl ${server.baseUrl.replace(/\/v1$/, "")}/health`);
      }
    } else if (tunnelResult.publicBaseUrl) {
      printCursorPasteBlock({
        baseUrl: tunnelResult.publicBaseUrl,
        proxyApiKey: profile.proxyApiKey,
        tunnelMode,
      });
    }

    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        await tunnel.stop();
        server.stop();
        resolve();
      };
      process.on("SIGINT", () => {
        void shutdown();
      });
      process.on("SIGTERM", () => {
        void shutdown();
      });
    });

    return 0;
  } catch (error) {
    server.stop();
    await tunnel.stop();
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
