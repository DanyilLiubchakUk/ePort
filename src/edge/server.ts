import { AuthManager } from "../auth/manager.ts";
import { ClaudeUpstreamClient } from "../claude/index.ts";
import { CodexUpstreamClient } from "../codex/index.ts";
import type { ConfigProfile, SessionFlags, TunnelMode } from "../config/types.ts";
import { ModelResolver } from "../resolver/index.ts";
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
  const resolver = new ModelResolver();

  const handler = createEdgeHandler({
    auth,
    resolver,
    codexUpstream,
    claudeUpstream,
    config: options.config,
    session: options.session,
    tunnelMode: options.tunnelMode,
    proxyApiKey: options.proxyApiKey,
    verbose: options.verbose,
  });

  const server = Bun.serve({
    hostname: host,
    port: options.port ?? 8787,
    idleTimeout: 240,
    fetch: handler,
  });

  const port = server.port ?? options.port ?? 8787;

  return {
    host,
    port,
    baseUrl: `http://${host}:${port}/v1`,
    stop: () => server.stop(),
  };
}
