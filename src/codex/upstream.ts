import type { CodexCredentials } from "../auth/types.ts";
import type { ResolvedRoute } from "../resolver/types.ts";
import { ConcurrencyGate } from "./concurrency.ts";
import {
  resolvePromptCacheKey,
  sanitizeCodexRequest,
  type SanitizeCodexRequestOptions,
} from "./sanitize.ts";
import { normalizeCodexEdgeBody } from "./translate-request.ts";

export const CODEX_RESPONSES_URL =
  "https://chatgpt.com/backend-api/codex/responses";

export const ORIGINATOR = "codex_cli_rs";
export const CODEX_USER_AGENT_VERSION = "0.120.0";
const DEFAULT_CONCURRENCY_LIMIT = 10;

export type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface CodexUpstreamDeps {
  fetchFn?: FetchFn;
  concurrencyLimit?: number;
  installationId?: string;
}

export interface CodexUpstreamRequest {
  rawBody: Record<string, unknown>;
  route: ResolvedRoute;
  credentials: CodexCredentials;
  signal?: AbortSignal;
}

export class CodexUpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
    public readonly requestId: string | null,
  ) {
    super(`upstream error ${status}: ${detail || "(no body)"}`);
    this.name = "CodexUpstreamError";
  }

  toOpenAiError(): {
    status: number;
    body: { error: { message: string; type: string; code: string | null } };
  } {
    return {
      status: this.status,
      body: {
        error: {
          message: `${this.detail || this.message}${
            this.requestId ? ` (request id ${this.requestId})` : ""
          }`,
          type: classifyErrorType(this.status),
          code: null,
        },
      },
    };
  }
}

export class CodexUpstreamClient {
  private readonly fetchFn: FetchFn;
  private readonly gate: ConcurrencyGate;
  readonly installationId: string;

  constructor(deps: CodexUpstreamDeps = {}) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.gate = new ConcurrencyGate(deps.concurrencyLimit ?? DEFAULT_CONCURRENCY_LIMIT);
    this.installationId = deps.installationId ?? crypto.randomUUID();
  }

  prepareRequest(
    rawBody: Record<string, unknown>,
    route: ResolvedRoute,
  ): Record<string, unknown> {
    const normalized = normalizeCodexEdgeBody(rawBody);
    return sanitizeCodexRequest(normalized, this.sanitizeOptions(route));
  }

  sessionIdForBody(body: Record<string, unknown>): string {
    return resolvePromptCacheKey(body, this.installationId);
  }

  buildUpstreamHeaders(
    body: Record<string, unknown>,
    credentials: CodexCredentials,
  ): Record<string, string> {
    const sessionId = this.sessionIdForBody(body);
    return {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${credentials.accessToken}`,
      "chatgpt-account-id": credentials.accountId,
      "openai-beta": "responses=experimental",
      originator: ORIGINATOR,
      "user-agent": `${ORIGINATOR}/${CODEX_USER_AGENT_VERSION} (eport)`,
      session_id: sessionId,
      "x-codex-installation-id": this.installationId,
    };
  }

  async stream(request: CodexUpstreamRequest): Promise<Response> {
    const release = await this.gate.acquire();
    try {
      const body = this.prepareRequest(request.rawBody, request.route);
      const headers = this.buildUpstreamHeaders(body, request.credentials);
      const response = await this.fetchFn(CODEX_RESPONSES_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: request.signal,
      });

      if (!response.ok) {
        const detail = await safeReadText(response);
        throw new CodexUpstreamError(
          response.status,
          detail,
          response.headers.get("x-request-id"),
        );
      }

      if (!response.body) {
        throw new CodexUpstreamError(502, "upstream returned empty body", null);
      }

      return response;
    } finally {
      release();
    }
  }

  get concurrencyGate(): ConcurrencyGate {
    return this.gate;
  }

  private sanitizeOptions(route: ResolvedRoute): SanitizeCodexRequestOptions {
    return {
      installationId: this.installationId,
      canonicalModelId: route.canonicalModelId,
      effort: route.effort,
      fastTier: route.fastTier,
    };
  }
}

function classifyErrorType(status: number): string {
  if (status === 401 || status === 403) return "authentication_error";
  if (status === 429) return "rate_limit_error";
  if (status >= 500) return "server_error";
  return "invalid_request_error";
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}
