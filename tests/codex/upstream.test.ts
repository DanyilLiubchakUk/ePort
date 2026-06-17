import { describe, expect, it } from "bun:test";

import {
  CodexUpstreamClient,
  resolvePromptCacheKey,
  sanitizeCodexRequest,
  type FetchFn,
} from "../../src/codex/index.ts";
import { ConcurrencyGate } from "../../src/codex/concurrency.ts";
import { makeCodexAuthFile, secondsFromNow } from "../auth/helpers.ts";
import { credentialsFromAuthFile } from "../../src/auth/codex-file.ts";

describe("codex upstream — sanitize and session alignment", () => {
  const installationId = "install-123";

  it("sanitizes required fields and maps effort and fast tier", () => {
    const sanitized = sanitizeCodexRequest(
      {
        model: "gpt-5.5xhigh-fast",
        input: [{ role: "user", content: "hello" }],
        store: true,
        stream: false,
        prompt_cache_retention: "24h",
      },
      {
        installationId,
        canonicalModelId: "gpt-5.5",
        effort: "xhigh",
        fastTier: true,
      },
    );

    expect(sanitized.model).toBe("gpt-5.5");
    expect(sanitized.store).toBe(false);
    expect(sanitized.stream).toBe(true);
    expect(sanitized.prompt_cache_retention).toBeUndefined();
    expect(sanitized.reasoning).toEqual({ effort: "xhigh" });
    expect(sanitized.service_tier).toBe("priority");
    expect(sanitized.include).toEqual(["reasoning.encrypted_content"]);
    expect(sanitized.parallel_tool_calls).toBe(true);
  });

  it("lifts system/developer messages into instructions", () => {
    const sanitized = sanitizeCodexRequest(
      {
        model: "gpt-5.5",
        input: [
          { role: "developer", content: "be concise" },
          { role: "user", content: "hi" },
        ],
      },
      {
        installationId,
        canonicalModelId: "gpt-5.5",
        effort: null,
        fastTier: false,
      },
    );

    expect(sanitized.instructions).toBe("be concise");
    expect(sanitized.input).toEqual([{ role: "user", content: "hi" }]);
  });

  it("aligns session_id header with body prompt_cache_key", () => {
    const client = new CodexUpstreamClient({ installationId });
    const body = client.prepareRequest(
      {
        model: "gpt-5.5",
        input: [{ role: "user", content: "hello" }],
        prompt_cache_key: "cursor-session-42",
      },
      {
        provider: "codex",
        canonicalModelId: "gpt-5.5",
        bareModelId: "gpt-5.5",
        effort: "high",
        fastTier: false,
      },
    );

    const auth = makeCodexAuthFile(secondsFromNow(3600));
    const credentials = credentialsFromAuthFile(auth, "eport-oauth", "/tmp/auth.json");
    const headers = client.buildUpstreamHeaders(body, credentials);

    expect(resolvePromptCacheKey(body, installationId)).toBe("cursor-session-42");
    expect(headers.session_id).toBe("cursor-session-42");
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
  });

  it("forwards encrypted reasoning include unchanged when client supplies include", () => {
    const sanitized = sanitizeCodexRequest(
      {
        model: "gpt-5.5",
        input: [{ role: "user", content: "hello" }],
        include: ["reasoning.encrypted_content", "custom.trace"],
        reasoning: { effort: "medium" },
      },
      {
        installationId,
        canonicalModelId: "gpt-5.5",
        effort: "medium",
        fastTier: false,
      },
    );

    expect(sanitized.include).toEqual(["reasoning.encrypted_content", "custom.trace"]);
  });
});

describe("codex upstream — concurrency gate", () => {
  it("queues excess simultaneous upstream dispatches", async () => {
    const gate = new ConcurrencyGate(2);
    let inFlight = 0;
    let maxInFlight = 0;

    const run = async () => {
      const release = await gate.acquire();
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      release();
    };

    await Promise.all([run(), run(), run(), run()]);
    expect(maxInFlight).toBe(2);
    expect(gate.inFlight).toBe(0);
    expect(gate.waiting).toBe(0);
  });
});

describe("codex upstream — mocked dispatch", () => {
  it("posts sanitized body to Codex responses endpoint", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    let capturedBody: Record<string, unknown> | undefined;

    const client = new CodexUpstreamClient({
      installationId: "install-abc",
      concurrencyLimit: 1,
      fetchFn: (async (_url, init) => {
        capturedHeaders = Object.fromEntries(
          new Headers(init?.headers as HeadersInit).entries(),
        );
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
              ),
            );
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }) satisfies FetchFn,
    });

    const auth = makeCodexAuthFile(secondsFromNow(3600));
    const credentials = credentialsFromAuthFile(auth, "eport-oauth", "/tmp/auth.json");

    const response = await client.stream({
      rawBody: {
        model: "gpt-5.5",
        input: [{ role: "user", content: "ping" }],
        prompt_cache_key: "turn-1",
      },
      route: {
        provider: "codex",
        canonicalModelId: "gpt-5.5",
        bareModelId: "gpt-5.5",
        effort: "high",
        fastTier: true,
      },
      credentials,
    });

    expect(response.ok).toBe(true);
    expect(capturedHeaders?.session_id).toBe("turn-1");
    expect(capturedBody?.model).toBe("gpt-5.5");
    expect(capturedBody?.service_tier).toBe("priority");
    expect(capturedBody?.include).toContain("reasoning.encrypted_content");
  });
});
