import { describe, expect, it } from "bun:test";

import {
  ClaudeUpstreamClient,
  anthropicRequestContainsXhigh,
  mapEffortToAnthropicThinking,
  normalizeEdgeBody,
  translateAnthropicSseToChat,
  translateAnthropicSseToResponses,
  translateToAnthropicRequest,
} from "../../src/claude/index.ts";
import { makeClaudeAuthFile, msFromNow } from "../auth/helpers.ts";
import { credentialsFromClaudeAuthFile } from "../../src/auth/claude-file.ts";

function anthropicSse(events: Array<{ event: string; data: Record<string, unknown> }>): Response {
  const body = events
    .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("claude translator — request normalization", () => {
  it("maps responses ingress to Anthropic request with alias effort", () => {
    const normalized = normalizeEdgeBody({
      model: "opus-4.8max",
      input: [
        { role: "developer", content: "be concise" },
        { role: "user", content: "hello" },
      ],
      stream: true,
    });

    const route = {
      provider: "claude" as const,
      canonicalModelId: "claude-opus-4-8",
      bareModelId: "claude-opus-4-8",
      effort: "max",
      fastTier: false,
    };

    const anthropic = translateToAnthropicRequest(normalized, route);
    expect(anthropic.model).toBe("claude-opus-4-8");
    expect(anthropic.system).toBe("be concise");
    expect(anthropic.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(anthropic.thinking).toEqual({ type: "enabled", budget_tokens: 32000 });
    expect(anthropicRequestContainsXhigh(anthropic)).toBe(false);
  });

  it("maps chat ingress messages array to Anthropic request", () => {
    const normalized = normalizeEdgeBody({
      model: "claude-4.6-opus-high",
      messages: [{ role: "user", content: "chat ingress" }],
      stream: true,
    });

    const anthropic = translateToAnthropicRequest(normalized, {
      provider: "claude",
      canonicalModelId: "claude-opus-4-6",
      bareModelId: "claude-opus-4-6",
      effort: "high",
      fastTier: false,
    });

    expect(anthropic.messages).toEqual([{ role: "user", content: "chat ingress" }]);
    expect(anthropic.thinking).toEqual({ type: "enabled", budget_tokens: 16000 });
  });

  it("never maps xhigh effort upstream", () => {
    expect(mapEffortToAnthropicThinking("xhigh")).toBeUndefined();
    const body = translateToAnthropicRequest(
      normalizeEdgeBody({
        model: "opus-4.8",
        input: [{ role: "user", content: "x" }],
      }),
      {
        provider: "claude",
        canonicalModelId: "claude-opus-4-8",
        bareModelId: "claude-opus-4-8",
        effort: "xhigh",
        fastTier: false,
      },
    );
    expect(body.thinking).toBeUndefined();
    expect(anthropicRequestContainsXhigh(body)).toBe(false);
  });
});

describe("claude translator — stream egress", () => {
  it("translates Anthropic SSE to responses events", async () => {
    const upstream = anthropicSse([
      {
        event: "message_start",
        data: { message: { id: "msg_1", usage: { input_tokens: 3 } } },
      },
      {
        event: "content_block_delta",
        data: { delta: { type: "text_delta", text: "hello" } },
      },
      { event: "message_stop", data: {} },
    ]);

    const response = await translateAnthropicSseToResponses(upstream, { model: "opus-4.8" });
    const text = await response.text();
    expect(text).toContain('"type":"response.created"');
    expect(text).toContain('"type":"response.output_text.delta"');
    expect(text).toContain('"type":"response.completed"');
  });

  it("translates Anthropic SSE to chat completion chunks", async () => {
    const upstream = anthropicSse([
      {
        event: "content_block_delta",
        data: { delta: { type: "text_delta", text: "chunk" } },
      },
      { event: "message_stop", data: {} },
    ]);

    const response = await translateAnthropicSseToChat(upstream, { model: "opus-4.8" });
    const text = await response.text();
    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain('"content":"chunk"');
    expect(text).toContain("[DONE]");
  });
});

describe("claude upstream client", () => {
  it("posts Anthropic Messages request with OAuth headers", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const client = new ClaudeUpstreamClient({
      fetchFn: async (url, init) => {
        capturedUrl = String(url);
        capturedInit = init;
        return anthropicSse([{ event: "message_stop", data: {} }]);
      },
    });

    const auth = makeClaudeAuthFile(msFromNow(3600_000));
    const credentials = credentialsFromClaudeAuthFile(auth, "eport-oauth", "/tmp/claude.json");

    await client.stream({
      rawBody: {
        model: "opus-4.8max",
        input: [{ role: "user", content: "upstream" }],
        stream: true,
      },
      route: {
        provider: "claude",
        canonicalModelId: "claude-opus-4-8",
        bareModelId: "claude-opus-4-8",
        effort: "max",
        fastTier: false,
      },
      credentials,
    });

    expect(capturedUrl).toContain("api.anthropic.com/v1/messages");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.authorization).toContain("Bearer ");
    expect(headers["anthropic-beta"]).toContain("oauth-2025-04-20");
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(body.model).toBe("claude-opus-4-8");
    expect(JSON.stringify(body)).not.toContain("xhigh");
  });
});
