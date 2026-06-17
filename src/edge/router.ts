import { AuthManager } from "../auth/manager.ts";
import { CodexUpstreamClient, CodexUpstreamError } from "../codex/index.ts";
import type { ConfigProfile, SessionFlags, TunnelMode } from "../config/types.ts";
import { ModelResolver } from "../resolver/index.ts";
import { ModelRoutingError } from "../resolver/types.ts";
import {
  authorizeProxyRequest,
  unauthorizedResponse,
  withCors,
} from "./api-key.ts";
import { logRequestSummary } from "./log.ts";
import { passthroughSseResponse, translateResponsesSseToChat } from "./stream.ts";

const CODEX_MODEL_STUBS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.2",
];

export type EdgeShape = "chat" | "responses";

export interface EdgeRouterDeps {
  auth: AuthManager;
  resolver: ModelResolver;
  upstream: CodexUpstreamClient;
  config: ConfigProfile;
  session: SessionFlags;
  tunnelMode: TunnelMode;
  proxyApiKey: string;
  verbose?: boolean;
}

export function createEdgeHandler(deps: EdgeRouterDeps) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const started = Date.now();

    if (req.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    if (url.pathname === "/health" || url.pathname === "/v1/health") {
      return withCors(Response.json({ status: "ok" }));
    }

    if (!authorizeProxyRequest(req, deps.proxyApiKey, deps.tunnelMode)) {
      return unauthorizedResponse();
    }

    try {
      if (url.pathname === "/v1/models" && req.method === "GET") {
        return withCors(handleListModels());
      }

      if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
        return await handleCodexRoute(req, deps, "chat", started);
      }

      if (url.pathname === "/v1/responses" && req.method === "POST") {
        return await handleCodexRoute(req, deps, "responses", started);
      }

      return withCors(
        Response.json(
          {
            error: {
              message: `not found: ${req.method} ${url.pathname}`,
              type: "not_found",
            },
          },
          { status: 404 },
        ),
      );
    } catch (error) {
      const status = error instanceof ModelRoutingError ? 400 : 500;
      const message = error instanceof Error ? error.message : String(error);
      logRequestSummary(
        {
          method: req.method,
          path: url.pathname,
          model: "?",
          effort: null,
          fast: false,
          provider: "?",
          status,
          latencyMs: Date.now() - started,
          error: message,
        },
        Boolean(deps.verbose),
      );
      return withCors(
        Response.json(
          {
            error: {
              message,
              type: status === 400 ? "invalid_request_error" : "server_error",
              code: error instanceof ModelRoutingError ? error.code : null,
            },
          },
          { status },
        ),
      );
    }
  };
}

async function handleCodexRoute(
  req: Request,
  deps: EdgeRouterDeps,
  edgeShape: EdgeShape,
  started: number,
): Promise<Response> {
  const url = new URL(req.url);
  const rawText = await req.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawText) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logRequestSummary(
      {
        method: req.method,
        path: url.pathname,
        model: "?",
        effort: null,
        fast: false,
        provider: "?",
        status: 400,
        latencyMs: Date.now() - started,
        error: `invalid JSON: ${message}`,
      },
      Boolean(deps.verbose),
    );
    return withCors(
      Response.json(
        {
          error: {
            message: `invalid JSON body: ${message}`,
            type: "invalid_request_error",
          },
        },
        { status: 400 },
      ),
    );
  }

  if (!isResponsesShapedBody(parsed, edgeShape)) {
    logRequestSummary(
      {
        method: req.method,
        path: url.pathname,
        model: typeof parsed.model === "string" ? parsed.model : "?",
        effort: null,
        fast: false,
        provider: "?",
        status: 400,
        latencyMs: Date.now() - started,
        error: "unsupported request shape",
      },
      Boolean(deps.verbose),
    );
    return withCors(
      Response.json(
        {
          error: {
            message:
              edgeShape === "responses"
                ? 'POST /v1/responses requires a Responses API body with an "input" array'
                : 'POST /v1/chat/completions requires a Responses-shaped body with an "input" array',
            type: "invalid_request_error",
          },
        },
        { status: 400 },
      ),
    );
  }

  const model = typeof parsed.model === "string" ? parsed.model : "";
  const route = deps.resolver.resolve(model, parsed, deps.config, {
    session: deps.session,
  });

  if (route.provider !== "codex") {
    logRequestSummary(
      {
        method: req.method,
        path: url.pathname,
        model,
        effort: route.effort,
        fast: route.fastTier,
        provider: route.provider,
        status: 501,
        latencyMs: Date.now() - started,
        error: "Claude routes ship in slice 06",
      },
      Boolean(deps.verbose),
    );
    return withCors(
      Response.json(
        {
          error: {
            message: "Claude routes are not available yet (slice 06)",
            type: "not_implemented",
          },
        },
        { status: 501 },
      ),
    );
  }

  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });

  let credentials;
  try {
    credentials = await deps.auth.getCodexCredentials();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logRequestSummary(
      {
        method: req.method,
        path: url.pathname,
        model,
        effort: route.effort,
        fast: route.fastTier,
        provider: route.provider,
        status: 401,
        latencyMs: Date.now() - started,
        error: message,
      },
      Boolean(deps.verbose),
    );
    return withCors(
      Response.json(
        {
          error: {
            message,
            type: "authentication_error",
          },
        },
        { status: 401 },
      ),
    );
  }

  const prepared = deps.upstream.prepareRequest(parsed, route);
  if (deps.verbose) {
    console.log(`[upstream-body] ${JSON.stringify(prepared)}`);
  }

  try {
    const upstream = await deps.upstream.stream({
      rawBody: parsed,
      route,
      credentials,
      signal: abort.signal,
    });

    logRequestSummary(
      {
        method: req.method,
        path: url.pathname,
        model,
        effort: route.effort,
        fast: route.fastTier,
        provider: route.provider,
        status: 200,
        latencyMs: Date.now() - started,
      },
      Boolean(deps.verbose),
    );

    if (edgeShape === "responses") {
      return withCors(passthroughSseResponse(upstream, abort.signal));
    }

    return withCors(
      await translateResponsesSseToChat(upstream, {
        model,
        signal: abort.signal,
      }),
    );
  } catch (error) {
    if (error instanceof CodexUpstreamError) {
      const { status, body } = error.toOpenAiError();
      logRequestSummary(
        {
          method: req.method,
          path: url.pathname,
          model,
          effort: route.effort,
          fast: route.fastTier,
          provider: route.provider,
          status,
          latencyMs: Date.now() - started,
          error: body.error.message,
        },
        Boolean(deps.verbose),
      );
      return withCors(Response.json(body, { status }));
    }

    const message = error instanceof Error ? error.message : String(error);
    logRequestSummary(
      {
        method: req.method,
        path: url.pathname,
        model,
        effort: route.effort,
        fast: route.fastTier,
        provider: route.provider,
        status: 502,
        latencyMs: Date.now() - started,
        error: message,
      },
      Boolean(deps.verbose),
    );
    return withCors(
      Response.json(
        {
          error: {
            message,
            type: "server_error",
            code: null,
          },
        },
        { status: 502 },
      ),
    );
  }
}

function isResponsesShapedBody(
  body: Record<string, unknown>,
  edgeShape: EdgeShape,
): boolean {
  if (Array.isArray(body.input)) {
    return true;
  }
  return edgeShape === "chat" && Array.isArray(body.messages);
}

function handleListModels(): Response {
  const created = Math.floor(Date.now() / 1000);
  return Response.json({
    object: "list",
    data: CODEX_MODEL_STUBS.map((id) => ({
      id,
      object: "model",
      created,
      owned_by: "eport",
    })),
  });
}
