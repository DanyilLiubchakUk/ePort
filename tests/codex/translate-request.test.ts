import { describe, expect, it } from "bun:test";

import {
  CodexUpstreamClient,
  normalizeCodexEdgeBody,
  sanitizeCodexRequest,
} from "../../src/codex/index.ts";
import {
  chatToolFollowUpBody,
  expectedSanitizedToolInput,
  responsesToolHistoryBody,
} from "./fixtures/ingress-bodies.ts";

const sanitizeOpts = {
  installationId: "test-install",
  canonicalModelId: "gpt-5.5",
  effort: null,
  fastTier: false,
} as const;

describe("normalizeCodexEdgeBody — Responses input passthrough", () => {
  it("leaves Responses-shaped input with function_call and reasoning intact", () => {
    const normalized = normalizeCodexEdgeBody({ ...responsesToolHistoryBody });
    expect(normalized.input).toEqual(responsesToolHistoryBody.input);
    expect(normalized.tools).toEqual(responsesToolHistoryBody.tools);
    expect(normalized.tool_choice).toBe("auto");
  });

  it("forwards tool history through sanitize unchanged", () => {
    const normalized = normalizeCodexEdgeBody({ ...responsesToolHistoryBody });
    const sanitized = sanitizeCodexRequest(normalized, sanitizeOpts);

    expect(sanitized.input).toEqual(responsesToolHistoryBody.input);
    expect(sanitized.tools).toEqual(responsesToolHistoryBody.tools);
    expect(sanitized.tool_choice).toBe("auto");
    const reasoningItem = (sanitized.input as Record<string, unknown>[]).find(
      (item) => item.type === "reasoning",
    );
    expect(reasoningItem).toMatchObject({
      type: "reasoning",
      encrypted_content: "encrypted-reasoning-blob",
    });
  });
});

describe("normalizeCodexEdgeBody — chat messages conversion", () => {
  it("converts assistant tool_calls and tool role into Responses input items", () => {
    const normalized = normalizeCodexEdgeBody({ ...chatToolFollowUpBody });

    expect(normalized.messages).toBeUndefined();
    expect(normalized.input).toEqual(expectedSanitizedToolInput);
    expect(normalized.tools).toEqual(chatToolFollowUpBody.tools);
    expect(normalized.tool_choice).toBe("auto");
  });

  it("converts assistant text plus tool_calls into separate input items", () => {
    const normalized = normalizeCodexEdgeBody({
      model: "gpt-5.5",
      messages: [
        { role: "user", content: "search and explain" },
        {
          role: "assistant",
          content: "I'll search for that.",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "search", arguments: '{"q":"test"}' },
            },
          ],
        },
      ],
    });

    const input = normalized.input as Record<string, unknown>[];
    expect(input).toContainEqual({ role: "assistant", content: "I'll search for that." });
    expect(input).toContainEqual({
      type: "function_call",
      call_id: "call_1",
      name: "search",
      arguments: '{"q":"test"}',
    });
  });

  it("lifts system messages into input for sanitize to promote to instructions", () => {
    const normalized = normalizeCodexEdgeBody({
      model: "gpt-5.5",
      messages: [
        { role: "system", content: "be concise" },
        { role: "user", content: "hi" },
      ],
    });

    const sanitized = sanitizeCodexRequest(normalized, sanitizeOpts);
    expect(sanitized.instructions).toBe("be concise");
    expect(sanitized.input).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("normalizeCodexEdgeBody — upstream prepareRequest integration", () => {
  it("places tools and tool_choice on prepared upstream body from chat ingress", () => {
    const client = new CodexUpstreamClient({ installationId: "edge-install" });
    const prepared = client.prepareRequest({ ...chatToolFollowUpBody }, {
      provider: "codex",
      canonicalModelId: "gpt-5.5",
      bareModelId: "gpt-5.5",
      effort: null,
      fastTier: false,
    });

    expect(prepared.tools).toEqual(chatToolFollowUpBody.tools);
    expect(prepared.tool_choice).toBe("auto");
    expect(prepared.input).toEqual(expectedSanitizedToolInput);
  });
});
