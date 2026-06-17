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
import {
  expectedCodexMultimodalContent,
  multimodalImageChatBody,
} from "../edge/fixtures/multimodal-bodies.ts";

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

  it("converts image_url parts inside Responses input content to input_image", () => {
    const normalized = normalizeCodexEdgeBody({
      model: "gpt-5.5",
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
    });

    expect(normalized.input).toEqual([
      { role: "developer", content: "be helpful" },
      {
        role: "user",
        content: [
          { type: "input_text", text: "what on this image" },
          { type: "input_image", image_url: "https://example.com/screenshot.png" },
        ],
      },
    ]);
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

  it("maps URL and base64 image parts to Codex input content", () => {
    const normalized = normalizeCodexEdgeBody({ ...multimodalImageChatBody });

    expect(normalized.input).toEqual([
      { role: "user", content: expectedCodexMultimodalContent },
    ]);
  });

  it("throws a clear error for unmappable image parts", () => {
    expect(() =>
      normalizeCodexEdgeBody({
        model: "gpt-5.5",
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: {} }],
          },
        ],
      }),
    ).toThrow("unsupported image content part");
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
