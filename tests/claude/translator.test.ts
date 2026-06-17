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
import {
  expectedClaudeMultimodalContent,
  multimodalImageChatBody,
} from "../edge/fixtures/multimodal-bodies.ts";

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

  it("maps chat tool_calls and tool results to Anthropic tool blocks", () => {
    const normalized = normalizeEdgeBody({
      model: "opus-4.8",
      messages: [
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: "checking",
          tool_calls: [
            {
              id: "call_weather",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":"London"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_weather", content: "18C" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "get_weather" } },
      stream: true,
    });

    const anthropic = translateToAnthropicRequest(normalized, {
      provider: "claude",
      canonicalModelId: "claude-opus-4-8",
      bareModelId: "claude-opus-4-8",
      effort: "high",
      fastTier: false,
    });

    expect(anthropic.messages).toEqual([
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "checking" },
          {
            type: "tool_use",
            id: "call_weather",
            name: "get_weather",
            input: { city: "London" },
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_weather", content: "18C" }],
      },
    ]);
    expect(anthropic.tools).toEqual([
      {
        name: "get_weather",
        description: "Get weather",
        input_schema: { type: "object", properties: { city: { type: "string" } } },
      },
    ]);
    expect(anthropic.tool_choice).toEqual({ type: "tool", name: "get_weather" });
    expect(anthropicRequestContainsXhigh(anthropic)).toBe(false);
  });

  it("maps URL and base64 image parts to Anthropic image blocks", () => {
    const normalized = normalizeEdgeBody({ ...multimodalImageChatBody, model: "opus-4.8" });

    const anthropic = translateToAnthropicRequest(normalized, {
      provider: "claude",
      canonicalModelId: "claude-opus-4-8",
      bareModelId: "claude-opus-4-8",
      effort: null,
      fastTier: false,
    });

    expect(anthropic.messages).toEqual([
      { role: "user", content: expectedClaudeMultimodalContent },
    ]);
  });

  it("throws a clear error for unmappable image parts", () => {
    expect(() =>
      normalizeEdgeBody({
        model: "opus-4.8",
        messages: [
          {
            role: "user",
            content: [{ type: "input_image" }],
          },
        ],
      }),
    ).toThrow("unsupported image content part");
  });

  it("keeps Responses function_call and function_call_output mapping to tool blocks", () => {
    const normalized = normalizeEdgeBody({
      model: "opus-4.8",
      input: [
        { role: "user", content: "call" },
        { type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"q":"x"}' },
        { type: "function_call_output", call_id: "call_1", output: "result" },
      ],
    });

    expect(normalized.messages).toEqual([
      { role: "user", content: "call" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call_1", name: "lookup", input: { q: "x" } }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_1", content: "result" }],
      },
    ]);
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

  it("translates Anthropic tool_use SSE to responses tool events", async () => {
    const upstream = anthropicSse([
      { event: "message_start", data: { message: { id: "msg_tool" } } },
      {
        event: "content_block_delta",
        data: { index: 0, delta: { type: "text_delta", text: "checking" } },
      },
      {
        event: "content_block_start",
        data: {
          index: 1,
          content_block: { type: "tool_use", id: "toolu_weather", name: "get_weather" },
        },
      },
      {
        event: "content_block_delta",
        data: { index: 1, delta: { type: "input_json_delta", partial_json: '{"city":' } },
      },
      {
        event: "content_block_delta",
        data: { index: 1, delta: { type: "input_json_delta", partial_json: '"London"}' } },
      },
      { event: "content_block_stop", data: { index: 1 } },
      { event: "message_delta", data: { delta: { stop_reason: "tool_use" } } },
      { event: "message_stop", data: {} },
    ]);

    const response = await translateAnthropicSseToResponses(upstream, { model: "opus-4.8" });
    const text = await response.text();
    expect(text).toContain('"type":"response.output_text.delta"');
    expect(text).toContain('"type":"response.output_item.added"');
    expect(text).toContain('"type":"function_call"');
    expect(text).toContain('"type":"response.function_call_arguments.delta"');
    expect(text).toContain('"type":"response.output_item.done"');
    expect(text).not.toContain("output_text.delta\",\"delta\":\"{");
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

  it("translates Anthropic tool_use SSE to chat tool_calls", async () => {
    const upstream = anthropicSse([
      {
        event: "content_block_delta",
        data: { index: 0, delta: { type: "text_delta", text: "checking" } },
      },
      {
        event: "content_block_start",
        data: {
          index: 1,
          content_block: { type: "tool_use", id: "toolu_weather", name: "get_weather" },
        },
      },
      {
        event: "content_block_delta",
        data: { index: 1, delta: { type: "input_json_delta", partial_json: '{"city":' } },
      },
      {
        event: "content_block_delta",
        data: { index: 1, delta: { type: "input_json_delta", partial_json: '"London"}' } },
      },
      { event: "message_delta", data: { delta: { stop_reason: "tool_use" } } },
      { event: "message_stop", data: {} },
    ]);

    const response = await translateAnthropicSseToChat(upstream, { model: "opus-4.8" });
    const text = await response.text();
    expect(text).toContain('"content":"checking"');
    expect(text).toContain('"tool_calls"');
    expect(text).toContain('"id":"toolu_weather"');
    expect(text).toContain('"name":"get_weather"');
    expect(text).toContain('"{\\"city\\":"');
    expect(text).toContain('"\\"London\\"}"');
    expect(text).toContain('"finish_reason":"tool_calls"');
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
