import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { ClaudeUpstreamClient, type FetchFn as ClaudeFetchFn } from "../../src/claude/index.ts";
import { CodexUpstreamClient, type FetchFn } from "../../src/codex/index.ts";
import { AuthManager } from "../../src/auth/manager.ts";
import { getAccountAuthPath } from "../../src/auth/accounts-paths.ts";
import { writeCodexAuthFile } from "../../src/auth/codex-file.ts";
import { emptyConfigProfile } from "../../src/config/types.ts";
import { startEdgeServer } from "../../src/edge/index.ts";
import {
  makeClaudeAuthFile,
  makeCodexAuthFile,
  makeTestJwt,
  msFromNow,
  secondsFromNow,
  writeEportAuth,
  writeEportClaudeAuth,
} from "../auth/helpers.ts";
import {
  codexSseBody,
  functionCallStream,
  reasoningStream,
  responsesPassthroughToolStream,
} from "./fixtures/codex-tool-sse.ts";
import { chatToolFollowUpBody, expectedSanitizedToolInput } from "../codex/fixtures/ingress-bodies.ts";
import {
  expectedClaudeMultimodalContent,
  expectedCodexMultimodalContent,
  multimodalImageChatBody,
} from "./fixtures/multimodal-bodies.ts";

function codexSseResponse(events: Record<string, unknown>[]): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function anthropicSseResponse(events: Array<{ event: string; data: Record<string, unknown> }>): Response {
  const body = events
    .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("edge router", () => {
  let home: string;
  let server: ReturnType<typeof startEdgeServer> | undefined;

  afterEach(() => {
    server?.stop();
    server = undefined;
    if (home) rmSync(home, { recursive: true, force: true });
  });

  function startTestServer(options: {
    tunnelMode?: "none" | "named";
    proxyApiKey?: string;
    verbose?: boolean;
    codexFetchFn?: FetchFn;
    claudeFetchFn?: ClaudeFetchFn;
  } = {}) {
    home = mkdtempSync(`${tmpdir()}/eport-edge-`);
    writeEportAuth(home, makeCodexAuthFile(secondsFromNow(3600)));
    writeEportClaudeAuth(home, makeClaudeAuthFile(msFromNow(3_600_000)));

    const codexUpstream = new CodexUpstreamClient({
      installationId: "edge-install",
      fetchFn:
        options.codexFetchFn ??
        (async () =>
          codexSseResponse([
            { type: "response.output_text.delta", delta: "ok" },
            { type: "response.completed", response: { status: "completed" } },
          ])),
    });

    const claudeUpstream = new ClaudeUpstreamClient({
      fetchFn:
        options.claudeFetchFn ??
        (async () =>
          anthropicSseResponse([
            {
              event: "message_start",
              data: { message: { id: "msg_test", usage: { input_tokens: 1 } } },
            },
            {
              event: "content_block_delta",
              data: { delta: { type: "text_delta", text: "claude-ok" } },
            },
            { event: "message_stop", data: {} },
          ])),
    });

    const profile = {
      ...emptyConfigProfile(),
      proxyApiKey: options.proxyApiKey ?? "eport_test_key",
    };

    server = startEdgeServer({
      home,
      port: 0,
      config: profile,
      session: {},
      tunnelMode: options.tunnelMode ?? "none",
      proxyApiKey: profile.proxyApiKey,
      codexUpstream,
      claudeUpstream,
      verbose: options.verbose,
    });

    return { baseUrl: `http://${server.host}:${server.port}` };
  }

  it("GET /health succeeds without upstream validation", async () => {
    const { baseUrl } = startTestServer();
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("allows missing proxy API key for --tunnel none", async () => {
    const { baseUrl } = startTestServer({ tunnelMode: "none", proxyApiKey: "eport_test_key" });
    const response = await fetch(`${baseUrl}/v1/models`);
    expect(response.status).toBe(200);
  });

  it("requires proxy API key for public tunnel modes", async () => {
    const { baseUrl } = startTestServer({ tunnelMode: "named", proxyApiKey: "eport_test_key" });
    const denied = await fetch(`${baseUrl}/v1/models`);
    expect(denied.status).toBe(401);

    const allowed = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: "Bearer eport_test_key" },
    });
    expect(allowed.status).toBe(200);
  });

  it("routes Codex models to upstream and logs structured one-liner", async () => {
    let upstreamCalls = 0;
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const { baseUrl } = startTestServer({
        codexFetchFn: async () => {
          upstreamCalls += 1;
          return codexSseResponse([
            { type: "response.output_text.delta", delta: "hi" },
            { type: "response.completed", response: { status: "completed" } },
          ]);
        },
      });

      const response = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.5xhigh-fast",
          input: [{ role: "user", content: "hello" }],
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      await response.text();
      expect(upstreamCalls).toBe(1);
      expect(logs.some((line) => line.includes("POST /v1/responses"))).toBe(true);
      expect(logs.some((line) => line.includes("edge=responses"))).toBe(true);
      expect(logs.some((line) => line.includes("model=gpt-5.5xhigh-fast"))).toBe(true);
      expect(logs.some((line) => line.includes("provider=codex"))).toBe(true);
      expect(logs.some((line) => line.includes("finish=stop"))).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });

  it("dispatches chat and responses edge shapes separately for Codex", async () => {
    let upstreamCalls = 0;
    const { baseUrl } = startTestServer({
      codexFetchFn: async () => {
        upstreamCalls += 1;
        return codexSseResponse([
          { type: "response.output_text.delta", delta: "x" },
          { type: "response.completed", response: { status: "completed" } },
        ]);
      },
    });

    const responses = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        input: [{ role: "user", content: "responses-path" }],
        stream: true,
      }),
    });
    expect(responses.status).toBe(200);

    const chat = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        input: [{ role: "user", content: "chat-path" }],
        stream: true,
      }),
    });
    expect(chat.status).toBe(200);
    expect(upstreamCalls).toBe(2);
  });

  it("routes Claude models to Anthropic upstream on responses path", async () => {
    let claudeCalls = 0;
    let lastBody: Record<string, unknown> | undefined;
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const { baseUrl } = startTestServer({
        claudeFetchFn: async (_url, init) => {
          claudeCalls += 1;
          lastBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return anthropicSseResponse([
            {
              event: "message_start",
              data: { message: { id: "msg_opus", usage: { input_tokens: 2 } } },
            },
            {
              event: "content_block_delta",
              data: { delta: { type: "text_delta", text: "opus" } },
            },
            { event: "message_stop", data: {} },
          ]);
        },
      });

      const response = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "opus-4.8max",
          input: [{ role: "user", content: "claude route" }],
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      await response.text();
      expect(claudeCalls).toBe(1);
      expect(lastBody?.model).toBe("claude-opus-4-8");
      expect(lastBody?.thinking).toEqual({ type: "enabled", budget_tokens: 32000 });
      expect(JSON.stringify(lastBody)).not.toContain("xhigh");
      expect(logs.some((line) => line.includes("provider=claude"))).toBe(true);
      expect(logs.some((line) => line.includes("edge=responses"))).toBe(true);
      expect(logs.some((line) => line.includes("finish=stop"))).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });

  it("routes Claude models on chat path with chat-shaped stream", async () => {
    let claudeCalls = 0;
    const { baseUrl } = startTestServer({
      claudeFetchFn: async () => {
        claudeCalls += 1;
        return anthropicSseResponse([
          {
            event: "content_block_delta",
            data: { delta: { type: "text_delta", text: "hi" } },
          },
          { event: "message_stop", data: {} },
        ]);
      },
    });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "opus-4.8",
        messages: [{ role: "user", content: "chat claude" }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(claudeCalls).toBe(1);
    const text = await response.text();
    expect(text).toContain("chat.completion.chunk");
  });

  it("routes Claude chat tool loop with Anthropic request and chat tool_calls", async () => {
    let claudeCalls = 0;
    let lastBody: Record<string, unknown> | undefined;
    const { baseUrl } = startTestServer({
      claudeFetchFn: async (_url, init) => {
        claudeCalls += 1;
        lastBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return anthropicSseResponse([
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
      },
    });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "opus-4.8high",
        messages: [
          { role: "user", content: "weather in London?" },
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
              parameters: { type: "object", properties: { city: { type: "string" } } },
            },
          },
        ],
        tool_choice: "auto",
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(claudeCalls).toBe(1);
    expect(lastBody?.model).toBe("claude-opus-4-8");
    expect(JSON.stringify(lastBody)).not.toContain("xhigh");
    expect(lastBody?.tools).toEqual([
      {
        name: "get_weather",
        description: undefined,
        input_schema: { type: "object", properties: { city: { type: "string" } } },
      },
    ]);
    expect(lastBody?.tool_choice).toEqual({ type: "auto" });
    expect(lastBody?.messages).toEqual([
      { role: "user", content: "weather in London?" },
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
    expect(text).toContain('"tool_calls"');
    expect(text).toContain('"finish_reason":"tool_calls"');
  });

  it("translates Codex tool SSE to chat tool_calls on /v1/chat/completions", async () => {
    const { baseUrl } = startTestServer({
      codexFetchFn: async () =>
        new Response(codexSseBody(functionCallStream()), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        input: [{ role: "user", content: "weather?" }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain('"tool_calls"');
    expect(text).toContain('"get_weather"');
    expect(text).toContain('"finish_reason":"tool_calls"');
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("logs edge shape and tool_calls finish after a Codex chat stream completes", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const { baseUrl } = startTestServer({
        codexFetchFn: async () =>
          new Response(codexSseBody(functionCallStream()), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
      });

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.5",
          input: [{ role: "user", content: "weather?" }],
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      await response.text();
      const requestLog = logs.find((line) => line.includes("POST /v1/chat/completions"));
      expect(requestLog).toContain("edge=chat");
      expect(requestLog).toContain("finish=tool_calls");
      expect(requestLog).toContain("provider=codex");
    } finally {
      console.log = originalLog;
    }
  });

  it("logs unhandled upstream SSE event names only in verbose mode", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const { baseUrl } = startTestServer({
        verbose: true,
        codexFetchFn: async () =>
          codexSseResponse([
            { type: "response.web_search_call.in_progress", item_id: "ws_1" },
            { type: "response.output_text.delta", delta: "done" },
            { type: "response.completed", response: { status: "completed" } },
          ]),
      });

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.5",
          input: [{ role: "user", content: "search" }],
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      await response.text();
      expect(
        logs.some((line) =>
          line.includes("[codex-sse-unhandled] event=response.web_search_call.in_progress"),
        ),
      ).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });

  it("uses client prompt_cache_key as Codex session_id through the edge route", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const { baseUrl } = startTestServer({
      codexFetchFn: async (_url, init) => {
        capturedHeaders = Object.fromEntries(
          new Headers(init?.headers as HeadersInit).entries(),
        );
        return codexSseResponse([
          { type: "response.output_text.delta", delta: "ok" },
          { type: "response.completed", response: { status: "completed" } },
        ]);
      },
    });

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        input: [{ role: "user", content: "resume this session" }],
        prompt_cache_key: "cursor-agent-session-16",
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    await response.text();
    expect(capturedHeaders?.session_id).toBe("cursor-agent-session-16");
  });

  it("converts chat tool follow-up ingress to Responses input on upstream", async () => {
    let upstreamCalls = 0;
    let lastBody: Record<string, unknown> | undefined;

    const { baseUrl } = startTestServer({
      codexFetchFn: async (_url, init) => {
        upstreamCalls += 1;
        lastBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (upstreamCalls === 1) {
          return new Response(codexSseBody(functionCallStream()), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        return codexSseResponse([
          { type: "response.output_text.delta", delta: "18C and sunny" },
          { type: "response.completed", response: { status: "completed" } },
        ]);
      },
    });

    const turn1 = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "weather in London?" }],
        stream: true,
      }),
    });
    expect(turn1.status).toBe(200);
    await turn1.text();

    const turn2 = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(chatToolFollowUpBody),
    });
    expect(turn2.status).toBe(200);
    await turn2.text();

    expect(upstreamCalls).toBe(2);
    expect(lastBody?.tools).toEqual(chatToolFollowUpBody.tools);
    expect(lastBody?.tool_choice).toBe("auto");
    expect(lastBody?.input).toEqual(expectedSanitizedToolInput);
  });

  it("round-trips Codex encrypted reasoning on chat egress and follow-up ingress", async () => {
    let upstreamCalls = 0;
    let lastBody: Record<string, unknown> | undefined;

    const { baseUrl } = startTestServer({
      codexFetchFn: async (_url, init) => {
        upstreamCalls += 1;
        lastBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (upstreamCalls === 1) {
          return new Response(codexSseBody(reasoningStream()), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        return codexSseResponse([
          { type: "response.output_text.delta", delta: "continued" },
          { type: "response.completed", response: { status: "completed" } },
        ]);
      },
    });

    const turn1 = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "reason about this" }],
        stream: true,
      }),
    });
    expect(turn1.status).toBe(200);
    const turn1Text = await turn1.text();
    expect(turn1Text).toContain('"reasoning"');
    expect(turn1Text).toContain("encrypted-reasoning-blob");

    const turn2 = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        input: [
          { role: "user", content: "reason about this" },
          {
            type: "reasoning",
            id: "rs_1",
            summary: [],
            encrypted_content: "encrypted-reasoning-blob",
          },
          { role: "user", content: "continue" },
        ],
        stream: true,
      }),
    });
    expect(turn2.status).toBe(200);
    await turn2.text();

    expect(upstreamCalls).toBe(2);
    expect(lastBody?.input).toEqual([
      { role: "user", content: "reason about this" },
      {
        type: "reasoning",
        id: "rs_1",
        summary: [],
        encrypted_content: "encrypted-reasoning-blob",
      },
      { role: "user", content: "continue" },
    ]);
    expect(lastBody?.include).toContain("reasoning.encrypted_content");
  });

  it("routes Codex Responses-shaped input image_url to upstream input_image", async () => {
    let lastBody: Record<string, unknown> | undefined;
    const { baseUrl } = startTestServer({
      codexFetchFn: async (_url, init) => {
        lastBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return codexSseResponse([
          { type: "response.output_text.delta", delta: "image" },
          { type: "response.completed", response: { status: "completed" } },
        ]);
      },
    });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5xhigh-fast",
        input: [
          { role: "developer", content: "be helpful" },
          {
            role: "user",
            content: [
              { type: "input_text", text: "what on this image" },
              {
                type: "image_url",
                image_url: { url: "https://example.com/screenshot.png" },
              },
            ],
          },
        ],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    await response.text();
    expect(lastBody?.instructions).toBe("be helpful");
    expect(lastBody?.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "what on this image" },
          { type: "input_image", image_url: "https://example.com/screenshot.png" },
        ],
      },
    ]);
  });

  it("routes Codex multimodal image ingress to Responses input content", async () => {
    let lastBody: Record<string, unknown> | undefined;
    const { baseUrl } = startTestServer({
      codexFetchFn: async (_url, init) => {
        lastBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return codexSseResponse([
          { type: "response.output_text.delta", delta: "image" },
          { type: "response.completed", response: { status: "completed" } },
        ]);
      },
    });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(multimodalImageChatBody),
    });

    expect(response.status).toBe(200);
    await response.text();
    expect(lastBody?.input).toEqual([
      { role: "user", content: expectedCodexMultimodalContent },
    ]);
  });

  it("routes Claude multimodal image ingress to Anthropic image blocks", async () => {
    let lastBody: Record<string, unknown> | undefined;
    const { baseUrl } = startTestServer({
      claudeFetchFn: async (_url, init) => {
        lastBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return anthropicSseResponse([
          {
            event: "content_block_delta",
            data: { delta: { type: "text_delta", text: "image" } },
          },
          { event: "message_stop", data: {} },
        ]);
      },
    });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...multimodalImageChatBody, model: "opus-4.8" }),
    });

    expect(response.status).toBe(200);
    await response.text();
    expect(lastBody?.messages).toEqual([
      { role: "user", content: expectedClaudeMultimodalContent },
    ]);
  });

  it("returns 400 for unmappable multimodal image parts", async () => {
    const { baseUrl } = startTestServer();

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: {} }],
          },
        ],
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string; type: string } };
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("unsupported image content part");
  });

  it("passthrough Codex tool SSE on /v1/responses without chat translation", async () => {
    const { baseUrl } = startTestServer({
      codexFetchFn: async () =>
        new Response(codexSseBody(responsesPassthroughToolStream()), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    });

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        input: [{ role: "user", content: "read file" }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("response.output_item.added");
    expect(text).toContain("function_call");
    expect(text).toContain("response.function_call_arguments.delta");
    expect(text).not.toContain("chat.completion.chunk");
    expect(text).not.toContain("tool_calls");
  });

  it("rotates Codex account on upstream 429 and retries once", async () => {
    home = mkdtempSync(`${tmpdir()}/eport-edge-queue-`);
    writeEportClaudeAuth(home, makeClaudeAuthFile(msFromNow(3_600_000)));

    const auth = new AuthManager(home);
    for (const [id, key] of [
      ["a1", "acct-1"],
      ["a2", "acct-2"],
    ] as const) {
      const authPath = getAccountAuthPath(home, "codex", id);
      const file = makeCodexAuthFile(secondsFromNow(3600));
      file.tokens.account_id = key;
      file.tokens.access_token = makeTestJwt(secondsFromNow(3600), key);
      file.tokens.id_token = file.tokens.access_token;
      writeCodexAuthFile(authPath, file);
      auth.accounts.addAccount("codex", { id, authPath, accountKey: key });
    }

    let upstreamCalls = 0;
    const accountIds: string[] = [];
    const codexUpstream = new CodexUpstreamClient({
      installationId: "edge-install",
      fetchFn: async (_url, init) => {
        upstreamCalls += 1;
        const headers = init?.headers as Record<string, string> | undefined;
        accountIds.push(headers?.["chatgpt-account-id"] ?? "");
        if (upstreamCalls === 1) {
          return new Response("rate limited", { status: 429 });
        }
        return codexSseResponse([
          { type: "response.output_text.delta", delta: "ok" },
          { type: "response.completed", response: { status: "completed" } },
        ]);
      },
    });

    const profile = { ...emptyConfigProfile(), proxyApiKey: "eport_test_key" };
    server = startEdgeServer({
      home,
      port: 0,
      config: profile,
      session: {},
      tunnelMode: "none",
      proxyApiKey: profile.proxyApiKey,
      auth,
      codexUpstream,
      claudeUpstream: new ClaudeUpstreamClient({
        fetchFn: async () =>
          anthropicSseResponse([{ event: "message_stop", data: {} }]),
      }),
    });

    const response = await fetch(`http://${server.host}:${server.port}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        input: [{ role: "user", content: "rotate me" }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(upstreamCalls).toBe(2);
    expect(accountIds).toEqual(["acct-1", "acct-2"]);
    expect(auth.accounts.getActiveEntry("codex")?.id).toBe("a2");
  });
});
