import { AuthManager } from "../auth/manager.ts";
import {
  ClaudeUpstreamClient,
  ClaudeUpstreamError,
  translateAnthropicSseToChat,
  translateAnthropicSseToResponses,
} from "../claude/index.ts";
import { CodexUpstreamClient, CodexUpstreamError } from "../codex/index.ts";
import type { ConfigProfile, SessionFlags, TunnelMode } from "../config/types.ts";
import { ModelResolver } from "../resolver/index.ts";
import { ModelRoutingError } from "../resolver/types.ts";
import {
  providerAccountFingerprintFor,
  recordCodexCalculatedUsage,
  type CodexUsageRecorder,
} from "../usage/codex.ts";
import {
  authorizeProxyRequest,
  unauthorizedResponse,
  withCors,
} from "./api-key.ts";
import { EdgeRequestError } from "./errors.ts";
import { logRequestSummary } from "./log.ts";
import {
  passthroughSseResponse,
  translateResponsesSseToChat,
  type CodexCompletedUsageCapture,
} from "./stream.ts";

export type EdgeShape = "chat" | "responses";

export interface EdgeRouterDeps {
  home: string;
  auth: AuthManager;
  resolver: ModelResolver;
  codexUpstream: CodexUpstreamClient;
  claudeUpstream: ClaudeUpstreamClient;
  config: ConfigProfile;
  session: SessionFlags;
  tunnelMode: TunnelMode;
  proxyApiKey: string;
  verbose?: boolean;
  codexUsageRecorder?: CodexUsageRecorder;
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
        return withCors(await handleListModels(deps));
      }

      if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
        return await handleInferenceRoute(req, deps, "chat", started);
      }

      if (url.pathname === "/v1/responses" && req.method === "POST") {
        return await handleInferenceRoute(req, deps, "responses", started);
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
      const status =
        error instanceof ModelRoutingError || error instanceof EdgeRequestError ? 400 : 500;
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

async function handleInferenceRoute(
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
        edgeShape,
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
        edgeShape,
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

  if (route.provider === "claude") {
    return handleClaudeRoute(req, deps, edgeShape, started, parsed, model, route);
  }

  return handleCodexRoute(req, deps, edgeShape, started, parsed, model, route);
}

async function handleCodexRoute(
  req: Request,
  deps: EdgeRouterDeps,
  edgeShape: EdgeShape,
  started: number,
  parsed: Record<string, unknown>,
  model: string,
  route: ReturnType<ModelResolver["resolve"]>,
  retried = false,
): Promise<Response> {
  const url = new URL(req.url);
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

  const prepared = deps.codexUpstream.prepareRequest(parsed, route);
  if (deps.verbose) {
    console.log(`[codex-upstream-body] ${JSON.stringify(prepared)}`);
  }
  const onUsage = createCodexUsageCaptureHandler(deps, credentials, route, model);

  try {
    const upstream = await deps.codexUpstream.stream({
      rawBody: parsed,
      route,
      credentials,
      signal: abort.signal,
    });

    if (edgeShape === "responses") {
      return withCors(
        passthroughSseResponse(upstream, abort.signal, {
          onUsage,
          onFinish: (finish) =>
            logInferenceSuccess(req, url.pathname, edgeShape, route, model, started, finish),
        }),
      );
    }

    return withCors(
      await translateResponsesSseToChat(upstream, {
        model,
        signal: abort.signal,
        onUsage,
        onFinish: (finish) =>
          logInferenceSuccess(req, url.pathname, edgeShape, route, model, started, finish),
        onUnhandledEvent: (eventType) =>
          logUnhandledSseEvent("codex", eventType, deps.verbose),
      }),
    );
  } catch (error) {
    const upstreamError = error instanceof CodexUpstreamError ? error : null;
    if (
      !retried &&
      upstreamError &&
      (upstreamError.status === 429 || upstreamError.status === 401)
    ) {
      const action = await deps.auth.handleUpstreamError("codex", upstreamError.status);
      if (action === "retry") {
        return handleCodexRoute(
          req,
          deps,
          edgeShape,
          started,
          parsed,
          model,
          route,
          true,
        );
      }
    }

    return handleUpstreamError(error, {
      method: req.method,
      path: url.pathname,
      model,
      route,
      started,
      verbose: deps.verbose,
      provider: "codex",
    });
  }
}

function createCodexUsageCaptureHandler(
  deps: EdgeRouterDeps,
  credentials: Awaited<ReturnType<AuthManager["getCodexCredentials"]>>,
  route: ReturnType<ModelResolver["resolve"]>,
  clientModel: string,
): (capture: CodexCompletedUsageCapture) => void {
  const activeEntry = deps.auth.accounts.getActiveEntry("codex");
  const accountIdentity = activeEntry?.accountKey || credentials.accountId || activeEntry?.id || "unknown";
  const providerAccountFingerprint = providerAccountFingerprintFor(
    "codex",
    accountIdentity,
  );
  const recorder = deps.codexUsageRecorder ?? recordCodexCalculatedUsage;

  return (capture) => {
    try {
      recorder({
        home: deps.home,
        providerAccountFingerprint,
        responseId: capture.responseId,
        clientModel,
        bareModelId: route.bareModelId,
        effort: route.effort,
        fastTier: route.fastTier,
        finish: capture.finish,
        usage: capture.usage,
        recordedAt: readCodexResponseTimestamp(capture.response),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[eport-usage] failed to record codex usage response=${capture.responseId ?? "-"} account=${providerAccountFingerprint}: ${message}`,
      );
    }
  };
}

function readCodexResponseTimestamp(response: Record<string, unknown>): string | number | null {
  const createdAt = response.created_at;
  if (typeof createdAt === "string" || typeof createdAt === "number") return createdAt;
  const created = response.created;
  if (typeof created === "string" || typeof created === "number") return created;
  return null;
}

async function handleClaudeRoute(
  req: Request,
  deps: EdgeRouterDeps,
  edgeShape: EdgeShape,
  started: number,
  parsed: Record<string, unknown>,
  model: string,
  route: ReturnType<ModelResolver["resolve"]>,
  retried = false,
): Promise<Response> {
  const url = new URL(req.url);
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });

  let credentials;
  try {
    credentials = await deps.auth.getClaudeCredentials();
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

  const prepared = deps.claudeUpstream.prepareRequest(parsed, route);
  if (deps.verbose) {
    console.log(`[claude-upstream-body] ${JSON.stringify(prepared)}`);
  }

  try {
    const upstream = await deps.claudeUpstream.stream({
      rawBody: parsed,
      route,
      credentials,
      signal: abort.signal,
    });

    if (edgeShape === "responses") {
      return withCors(
        await translateAnthropicSseToResponses(upstream, {
          model,
          signal: abort.signal,
          onFinish: (finish) =>
            logInferenceSuccess(req, url.pathname, edgeShape, route, model, started, finish),
          onUnhandledEvent: (eventType) =>
            logUnhandledSseEvent("claude", eventType, deps.verbose),
        }),
      );
    }

    return withCors(
      await translateAnthropicSseToChat(upstream, {
        model,
        signal: abort.signal,
        onFinish: (finish) =>
          logInferenceSuccess(req, url.pathname, edgeShape, route, model, started, finish),
        onUnhandledEvent: (eventType) =>
          logUnhandledSseEvent("claude", eventType, deps.verbose),
      }),
    );
  } catch (error) {
    const upstreamError = error instanceof ClaudeUpstreamError ? error : null;
    if (
      !retried &&
      upstreamError &&
      (upstreamError.status === 429 || upstreamError.status === 401)
    ) {
      const action = await deps.auth.handleUpstreamError("claude", upstreamError.status);
      if (action === "retry") {
        return handleClaudeRoute(
          req,
          deps,
          edgeShape,
          started,
          parsed,
          model,
          route,
          true,
        );
      }
    }

    return handleUpstreamError(error, {
      method: req.method,
      path: url.pathname,
      model,
      route,
      started,
      verbose: deps.verbose,
      provider: "claude",
    });
  }
}

function handleUpstreamError(
  error: unknown,
  context: {
    method: string;
    path: string;
    model: string;
    route: ReturnType<ModelResolver["resolve"]>;
    started: number;
    verbose?: boolean;
    provider: "codex" | "claude";
  },
): Response {
  const upstreamError =
    error instanceof CodexUpstreamError || error instanceof ClaudeUpstreamError
      ? error
      : null;

  if (upstreamError) {
    const { status, body } = upstreamError.toOpenAiError();
    logRequestSummary(
      {
        method: context.method,
        path: context.path,
        model: context.model,
        effort: context.route.effort,
        fast: context.route.fastTier,
        provider: context.provider,
        status,
        latencyMs: Date.now() - context.started,
        error: body.error.message,
      },
      Boolean(context.verbose),
    );
    return withCors(Response.json(body, { status }));
  }

  const message = error instanceof Error ? error.message : String(error);
  logRequestSummary(
    {
      method: context.method,
      path: context.path,
      model: context.model,
      effort: context.route.effort,
      fast: context.route.fastTier,
      provider: context.provider,
      status: 502,
      latencyMs: Date.now() - context.started,
      error: message,
    },
    Boolean(context.verbose),
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

function logInferenceSuccess(
  req: Request,
  path: string,
  edgeShape: EdgeShape,
  route: ReturnType<ModelResolver["resolve"]>,
  model: string,
  started: number,
  finish: string,
): void {
  logRequestSummary(
    {
      method: req.method,
      path,
      edgeShape,
      model,
      effort: route.effort,
      fast: route.fastTier,
      provider: route.provider,
      finish,
      status: 200,
      latencyMs: Date.now() - started,
    },
    false,
  );
}

function logUnhandledSseEvent(
  provider: "codex" | "claude",
  eventType: string,
  verbose?: boolean,
): void {
  if (!verbose) return;
  console.log(`[${provider}-sse-unhandled] event=${eventType}`);
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

async function handleListModels(deps: EdgeRouterDeps): Promise<Response> {
  const list = await deps.resolver.listModels();
  return Response.json(list);
}
