import type { ClaudeCredentials } from "../auth/types.ts";
import type { ResolvedRoute } from "../resolver/types.ts";
import { normalizeEdgeBody } from "./normalize.ts";
import {
  anthropicRequestContainsXhigh,
  translateToAnthropicRequest,
} from "./translate-request.ts";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

const CLAUDE_CODE_BETA_HEADERS =
  "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14";

export type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ClaudeUpstreamDeps {
  fetchFn?: FetchFn;
}

export interface ClaudeUpstreamRequest {
  rawBody: Record<string, unknown>;
  route: ResolvedRoute;
  credentials: ClaudeCredentials;
  signal?: AbortSignal;
}

export class ClaudeUpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
    public readonly requestId: string | null,
  ) {
    super(`upstream error ${status}: ${detail || "(no body)"}`);
    this.name = "ClaudeUpstreamError";
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

export class ClaudeUpstreamClient {
  private readonly fetchFn: FetchFn;

  constructor(deps: ClaudeUpstreamDeps = {}) {
    this.fetchFn = deps.fetchFn ?? fetch;
  }

  prepareRequest(
    rawBody: Record<string, unknown>,
    route: ResolvedRoute,
  ): ReturnType<typeof translateToAnthropicRequest> {
    const normalized = normalizeEdgeBody(rawBody);
    return translateToAnthropicRequest(normalized, route);
  }

  buildUpstreamHeaders(credentials: ClaudeCredentials): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${credentials.accessToken}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": CLAUDE_CODE_BETA_HEADERS,
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }

  async stream(request: ClaudeUpstreamRequest): Promise<Response> {
    const body = this.prepareRequest(request.rawBody, request.route);
    if (anthropicRequestContainsXhigh(body)) {
      throw new ClaudeUpstreamError(
        400,
        "Claude routes must not emit xhigh effort upstream",
        null,
      );
    }

    const headers = this.buildUpstreamHeaders(request.credentials);
    const response = await this.fetchFn(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!response.ok) {
      const detail = await safeReadText(response);
      throw new ClaudeUpstreamError(
        response.status,
        detail,
        response.headers.get("request-id"),
      );
    }

    if (!response.body) {
      throw new ClaudeUpstreamError(502, "upstream returned empty body", null);
    }

    return response;
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
