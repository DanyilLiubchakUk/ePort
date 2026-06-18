import { AuthManager } from "../auth/manager.ts";
import { ClaudeUpstreamClient } from "../claude/index.ts";
import { CodexUpstreamClient } from "../codex/index.ts";
import type { ConfigProfile, SessionFlags, TunnelMode } from "../config/types.ts";
import { ModelCatalog, ModelResolver } from "../resolver/index.ts";
import { clearProxyRuntimeState } from "../runtime/state.ts";
import type { ClaudeUsageRecorder } from "../usage/claude.ts";
import type { CodexUsageRecorder } from "../usage/codex.ts";
import { createEdgeHandler } from "./router.ts";

export interface EdgeServerOptions {
  host?: string;
  port?: number;
  home: string;
  config: ConfigProfile;
  session: SessionFlags;
  tunnelMode: TunnelMode;
  proxyApiKey: string;
  verbose?: boolean;
  codexUpstream?: CodexUpstreamClient;
  claudeUpstream?: ClaudeUpstreamClient;
  auth?: AuthManager;
  catalog?: ModelCatalog;
  resolver?: ModelResolver;
  codexUsageRecorder?: CodexUsageRecorder;
  claudeUsageRecorder?: ClaudeUsageRecorder;
}

export interface EdgeServerHandle {
  host: string;
  port: number;
  baseUrl: string;
  stop: () => void;
}

export function startEdgeServer(options: EdgeServerOptions): EdgeServerHandle {
  const host = options.host ?? "127.0.0.1";
  const auth = options.auth ?? new AuthManager(options.home);
  const codexUpstream = options.codexUpstream ?? new CodexUpstreamClient();
  const claudeUpstream = options.claudeUpstream ?? new ClaudeUpstreamClient();
  const catalog =
    options.catalog ??
    new ModelCatalog({
      home: options.home,
      auth,
    });
  const ownsCatalog = !options.catalog;
  if (ownsCatalog) {
    auth.setCatalog(catalog);
    catalog.start();
  }
  const resolver = options.resolver ?? new ModelResolver(catalog);

  const handler = createEdgeHandler({
    home: options.home,
    auth,
    resolver,
    codexUpstream,
    claudeUpstream,
    config: options.config,
    session: options.session,
    tunnelMode: options.tunnelMode,
    proxyApiKey: options.proxyApiKey,
    verbose: options.verbose,
    codexUsageRecorder: options.codexUsageRecorder,
    claudeUsageRecorder: options.claudeUsageRecorder,
  });

  const server = Bun.serve({
    hostname: host,
    port: options.port ?? 8787,
    idleTimeout: 240,
    fetch: handler,
  });

  const port = server.port ?? options.port ?? 8787;
  auth.setRuntimePort(port);

  return {
    host,
    port,
    baseUrl: `http://${host}:${port}/v1`,
    stop: () => {
      if (ownsCatalog) catalog.stop();
      clearProxyRuntimeState(options.home);
      server.stop();
    },
  };
}
