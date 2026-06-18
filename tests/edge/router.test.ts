import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClaudeUpstreamClient, type FetchFn as ClaudeFetchFn } from "../../src/claude/index.ts";
import { CodexUpstreamClient, type FetchFn } from "../../src/codex/index.ts";
import { AuthManager } from "../../src/auth/manager.ts";
import { getAccountAuthPath } from "../../src/auth/accounts-paths.ts";
import { writeClaudeAuthFile } from "../../src/auth/claude-file.ts";
import { writeCodexAuthFile } from "../../src/auth/codex-file.ts";
import { emptyConfigProfile } from "../../src/config/types.ts";
import { startEdgeServer } from "../../src/edge/index.ts";
import {
  getClaudeEportDailySnapshotPath,
  getClaudeEportRawEventsPath,
  getClaudeEportSessionFilePath,
} from "../../src/usage/claude.ts";
import { providerAccountFingerprintFor } from "../../src/usage/common.ts";
import {
  getCodexEportDailySnapshotPath,
  getCodexEportRawEventsPath,
  getCodexEportSessionFilePath,
  type CodexUsageRecorder,
} from "../../src/usage/codex.ts";
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
    codexUsageRecorder?: CodexUsageRecorder;
    configureAuth?: (auth: AuthManager, home: string) => void;
  } = {}) {
    home = mkdtempSync(`${tmpdir()}/eport-edge-`);
    writeEportAuth(home, makeCodexAuthFile(secondsFromNow(3600)));
    writeEportClaudeAuth(home, makeClaudeAuthFile(msFromNow(3_600_000)));
    const auth = new AuthManager(home);
    options.configureAuth?.(auth, home);

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
      auth,
      verbose: options.verbose,
      codexUsageRecorder: options.codexUsageRecorder,
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

  it("records Codex Responses passthrough usage under the ePort account partition", async () => {
    const completedAt = Date.parse("2026-06-17T15:00:00.000Z") / 1000;
    const { baseUrl } = startTestServer({
      codexFetchFn: async () =>
        codexSseResponse([
          { type: "response.output_text.delta", delta: "ok" },
          {
            type: "response.completed",
            response: {
              id: "resp_usage_stop",
              status: "completed",
              created_at: completedAt,
              usage: {
                input_tokens: 100,
                input_tokens_details: { cached_tokens: 40 },
                output_tokens: 25,
                output_tokens_details: { reasoning_tokens: 10 },
                total_tokens: 125,
              },
            },
          },
        ]),
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
    await response.text();

    const fingerprint = providerAccountFingerprintFor("codex", "acct-test");
    const rawEvents = readFileSync(getCodexEportRawEventsPath(home, fingerprint), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rawEvents).toHaveLength(1);
    expect(rawEvents[0]).toMatchObject({
      provider: "codex",
      providerAccountFingerprint: fingerprint,
      responseId: "resp_usage_stop",
      clientModel: "gpt-5.5xhigh-fast",
      bareModelId: "gpt-5.5",
      effort: "xhigh",
      fastTier: true,
      finish: "stop",
      normalizedUsage: {
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 25,
        reasoningOutputTokens: 10,
        totalTokens: 125,
      },
    });

    const snapshot = JSON.parse(
      readFileSync(getCodexEportDailySnapshotPath(home, fingerprint, "2026-06-17"), "utf8"),
    ) as Record<string, unknown>;
    expect(snapshot).toMatchObject({
      dataIdentity: `eport:codex:${fingerprint}:daily:2026-06-17`,
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 25,
      reasoningOutputTokens: 10,
      totalTokens: 125,
    });
    expect(
      existsSync(getCodexEportSessionFilePath(home, fingerprint, "2026-06-17T15:00:00.000Z")),
    ).toBe(true);
    expect(existsSync(join(home, ".codex", "sessions"))).toBe(false);
  });

  it("records Codex chat translation usage once for tool-call completions", async () => {
    const completedAt = Date.parse("2026-06-17T15:10:00.000Z") / 1000;
    const toolEvents = functionCallStream().map((event) =>
      event.type === "response.completed"
        ? {
            ...event,
            response: {
              id: "resp_usage_tool",
              status: "completed",
              created_at: completedAt,
              usage: {
                input_tokens: 200,
                input_tokens_details: { cached_tokens: 75 },
                output_tokens: 30,
                output_tokens_details: { reasoning_tokens: 12 },
                total_tokens: 230,
              },
            },
          }
        : event,
    );
    const { baseUrl } = startTestServer({
      codexFetchFn: async () => codexSseResponse(toolEvents),
    });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.5",
        input: [{ role: "user", content: "use tool" }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"finish_reason":"tool_calls"');

    const fingerprint = providerAccountFingerprintFor("codex", "acct-test");
    const rawEvents = readFileSync(getCodexEportRawEventsPath(home, fingerprint), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rawEvents).toHaveLength(1);
    expect(rawEvents[0]).toMatchObject({
      responseId: "resp_usage_tool",
      finish: "tool_calls",
      normalizedUsage: {
        inputTokens: 200,
        cachedInputTokens: 75,
        outputTokens: 30,
        reasoningOutputTokens: 12,
        totalTokens: 230,
      },
    });
  });

  it("logs failed Codex usage writes without corrupting the client stream", async () => {
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    try {
      const { baseUrl } = startTestServer({
        codexUsageRecorder: () => {
          throw new Error("disk unavailable");
        },
        codexFetchFn: async () =>
          codexSseResponse([
            { type: "response.output_text.delta", delta: "still streams" },
            {
              type: "response.completed",
              response: {
                id: "resp_usage_fail",
                status: "completed",
                created_at: Date.parse("2026-06-17T15:20:00.000Z") / 1000,
                usage: {
                  input_tokens: 1,
                  output_tokens: 2,
                  total_tokens: 3,
                },
              },
            },
          ]),
      });

      const response = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.5",
          input: [{ role: "user", content: "hello" }],
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("still streams");
      expect(
        errors.some((line) => line.includes("[eport-usage] failed to record codex usage")),
      ).toBe(true);
      expect(errors.some((line) => line.includes("disk unavailable"))).toBe(true);
    } finally {
      console.error = originalError;
    }
  });

  it("keeps Codex suffix effort and fast tier over Cursor body defaults", async () => {
    let lastBody: Record<string, unknown> | undefined;
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const { baseUrl } = startTestServer({
        codexFetchFn: async (_url, init) => {
          lastBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return codexSseResponse([
            { type: "response.output_text.delta", delta: "ok" },
            { type: "response.completed", response: { status: "completed" } },
          ]);
        },
      });

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.5xhigh-fast",
          input: [{ role: "user", content: "hello" }],
          reasoning: { effort: "medium" },
          service_tier: "auto",
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      await response.text();
      expect(lastBody?.reasoning).toMatchObject({ effort: "xhigh" });
      expect(lastBody?.service_tier).toBe("priority");
      expect(logs.some((line) => line.includes("model=gpt-5.5xhigh-fast"))).toBe(true);
      expect(logs.some((line) => line.includes("effort=xhigh"))).toBe(true);
      expect(logs.some((line) => line.includes("fast=1"))).toBe(true);
    } finally {
      console.log = originalLog;
    }
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

  it("records Claude Responses usage under the queued account partition", async () => {
    const completedAt = "2026-06-17T16:00:00.000Z";
    const accountKey = "claude-work-account";
    const { baseUrl } = startTestServer({
      configureAuth: (auth, testHome) => {
        const id = "claude-a1";
        const authPath = getAccountAuthPath(testHome, "claude", id);
        writeClaudeAuthFile(authPath, makeClaudeAuthFile(msFromNow(3_600_000)));
        auth.accounts.addAccount("claude", { id, authPath, accountKey });
      },
      claudeFetchFn: async () =>
        anthropicSseResponse([
          {
            event: "message_start",
            data: {
              message: {
                id: "msg_usage_response",
                created_at: completedAt,
                usage: { input_tokens: 1 },
              },
            },
          },
          {
            event: "content_block_delta",
            data: { delta: { type: "text_delta", text: "usage" } },
          },
          {
            event: "message_delta",
            data: {
              delta: { stop_reason: "end_turn" },
              usage: {
                input_tokens: 100,
                cache_creation_input_tokens: 20,
                cache_read_input_tokens: 30,
                output_tokens: 40,
                server_tool_use: { web_search_requests: 1 },
              },
            },
          },
          { event: "message_stop", data: {} },
        ]),
    });

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "opus-4.8max",
        input: [{ role: "user", content: "hello" }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    await response.text();

    const fingerprint = providerAccountFingerprintFor("claude", accountKey);
    const rawEvents = readFileSync(getClaudeEportRawEventsPath(home, fingerprint), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rawEvents).toHaveLength(1);
    expect(rawEvents[0]).toMatchObject({
      provider: "claude",
      providerAccountFingerprint: fingerprint,
      responseId: "msg_usage_response",
      clientModel: "opus-4.8max",
      bareModelId: "opus-4.8",
      effort: "max",
      finish: "stop",
      usage: {
        server_tool_use: { web_search_requests: 1 },
      },
      normalizedUsage: {
        inputTokens: 100,
        cacheCreationInputTokens: 20,
        cacheReadInputTokens: 30,
        outputTokens: 40,
        totalTokens: 190,
        serverToolUse: { web_search_requests: 1 },
      },
    });

    const snapshot = JSON.parse(
      readFileSync(getClaudeEportDailySnapshotPath(home, fingerprint, "2026-06-17"), "utf8"),
    ) as Record<string, unknown>;
    expect(snapshot).toMatchObject({
      dataIdentity: `eport:claude:${fingerprint}:daily:2026-06-17`,
      provider: "claude",
      inputTokens: 100,
      cacheCreationInputTokens: 20,
      cacheReadInputTokens: 30,
      outputTokens: 40,
      totalTokens: 190,
      serverToolUse: { web_search_requests: 1 },
    });

    const sessionPath = getClaudeEportSessionFilePath(home, fingerprint, completedAt);
    expect(existsSync(sessionPath)).toBe(true);
    expect(sessionPath).toContain(join("projects", "eport-cursor-proxy", "2026-06-17.jsonl"));
    expect(existsSync(join(home, ".claude", "projects"))).toBe(false);
  });

  it("records Claude chat translation usage once for tool-call completions", async () => {
    const accountKey = "claude-chat-account";
    const { baseUrl } = startTestServer({
      configureAuth: (auth, testHome) => {
        const id = "claude-a2";
        const authPath = getAccountAuthPath(testHome, "claude", id);
        writeClaudeAuthFile(authPath, makeClaudeAuthFile(msFromNow(3_600_000)));
        auth.accounts.addAccount("claude", { id, authPath, accountKey });
      },
      claudeFetchFn: async () =>
        anthropicSseResponse([
          {
            event: "message_start",
            data: {
              message: {
                id: "msg_usage_chat",
                usage: {
                  input_tokens: 50,
                  cache_creation_input_tokens: 5,
                  cache_read_input_tokens: 10,
                  output_tokens: 15,
                },
              },
            },
          },
          {
            event: "content_block_start",
            data: {
              index: 0,
              content_block: { type: "tool_use", id: "toolu_weather", name: "get_weather" },
            },
          },
          { event: "message_delta", data: { delta: { stop_reason: "tool_use" } } },
          { event: "message_stop", data: {} },
        ]),
    });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "opus-4.8high",
        messages: [{ role: "user", content: "use tool" }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"finish_reason":"tool_calls"');

    const fingerprint = providerAccountFingerprintFor("claude", accountKey);
    const rawEvents = readFileSync(getClaudeEportRawEventsPath(home, fingerprint), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rawEvents).toHaveLength(1);
    expect(rawEvents[0]).toMatchObject({
      responseId: "msg_usage_chat",
      clientModel: "opus-4.8high",
      bareModelId: "opus-4.8",
      effort: "high",
      finish: "tool_calls",
      normalizedUsage: {
        inputTokens: 50,
        cacheCreationInputTokens: 5,
        cacheReadInputTokens: 10,
        outputTokens: 15,
        totalTokens: 80,
      },
    });
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
