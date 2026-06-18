import { ConfigStore } from "../config/index.ts";
import type { ConfigProfile, SessionFlags } from "../config/types.ts";
import { startEdgeServer } from "../edge/index.ts";
import { AuthManager, formatAuthStatus } from "../auth/index.ts";
import type { Provider } from "../auth/index.ts";
import {
  composeNamedPublicBaseUrl,
  composeNgrokPublicBaseUrl,
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

  const baseUrl =
    profile.tunnelMode === "ngrok" && profile.ngrok.url?.trim()
      ? composeNgrokPublicBaseUrl(profile.ngrok.url)
      : profile.tunnel.hostname?.trim() && profile.tunnelMode !== "none"
        ? composeNamedPublicBaseUrl(profile.tunnel.hostname)
        : null;
  if (baseUrl) {
    printCursorPasteBlock({
      baseUrl,
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

  try {
    validateTunnelConfig(tunnelMode, profile);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

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
    ngrokConfig: profile.ngrok,
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

function validateTunnelConfig(
  tunnelMode: ConfigProfile["tunnelMode"],
  profile: ConfigProfile,
): void {
  if (tunnelMode === "ngrok") {
    const authtoken = profile.ngrok.authtoken?.trim();
    const url = profile.ngrok.url?.trim();
    if (!authtoken || !url) {
      throw new Error("ngrok tunnel is not configured. Run: eport tunnel setup ngrok");
    }
  }

  if (tunnelMode === "named") {
    const token = profile.tunnel.token?.trim();
    const hostname = profile.tunnel.hostname?.trim();
    if (!token || !hostname) {
      throw new Error("Named tunnel is not configured. Run: eport tunnel setup named");
    }
  }
}
