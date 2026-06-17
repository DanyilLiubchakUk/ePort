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
      expect(upstreamCalls).toBe(1);
      expect(logs.some((line) => line.includes("POST /v1/responses"))).toBe(true);
      expect(logs.some((line) => line.includes("model=gpt-5.5xhigh-fast"))).toBe(true);
      expect(logs.some((line) => line.includes("provider=codex"))).toBe(true);
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
      expect(claudeCalls).toBe(1);
      expect(lastBody?.model).toBe("claude-opus-4-8");
      expect(lastBody?.thinking).toEqual({ type: "enabled", budget_tokens: 32000 });
      expect(JSON.stringify(lastBody)).not.toContain("xhigh");
      expect(logs.some((line) => line.includes("provider=claude"))).toBe(true);
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
