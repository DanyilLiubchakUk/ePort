import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { CodexUpstreamClient, type FetchFn } from "../../src/codex/index.ts";
import { emptyConfigProfile } from "../../src/config/types.ts";
import { startEdgeServer } from "../../src/edge/index.ts";
import { makeCodexAuthFile, secondsFromNow, writeEportAuth } from "../auth/helpers.ts";

function sseResponse(events: Record<string, unknown>[]): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
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
    fetchFn?: FetchFn;
  } = {}) {
    home = mkdtempSync(`${tmpdir()}/eport-edge-`);
    writeEportAuth(home, makeCodexAuthFile(secondsFromNow(3600)));

    const upstream = new CodexUpstreamClient({
      installationId: "edge-install",
      fetchFn:
        options.fetchFn ??
        (async () =>
          sseResponse([
            {
              type: "response.output_text.delta",
              delta: "ok",
            },
            {
              type: "response.completed",
              response: { status: "completed" },
            },
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
      upstream,
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
        fetchFn: async () => {
          upstreamCalls += 1;
          return sseResponse([
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

  it("dispatches chat and responses edge shapes separately", async () => {
    let upstreamCalls = 0;
    const { baseUrl } = startTestServer({
      fetchFn: async () => {
        upstreamCalls += 1;
        return sseResponse([
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
    expect(responses.headers.get("content-type")).toContain("text/event-stream");

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
    expect(chat.headers.get("content-type")).toContain("text/event-stream");
    expect(upstreamCalls).toBe(2);
  });

  it("returns 501 for Claude-routed models", async () => {
    const { baseUrl } = startTestServer();
    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "opus-4.8max",
        input: [{ role: "user", content: "claude later" }],
        stream: true,
      }),
    });
    expect(response.status).toBe(501);
  });
});
