import { describe, expect, it } from "bun:test";

import { translateResponsesSseToChat } from "../../src/edge/stream.ts";
import {
  codexSseBody,
  customToolCallStream,
  functionCallDoneFallbackStream,
  functionCallStream,
  textOnlyStream,
} from "./fixtures/codex-tool-sse.ts";

function parseDataChunks(sse: string): Record<string, unknown>[] {
  return sse
    .split("\n\n")
    .filter((line) => line.startsWith("data: {") || line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

async function collectChatChunks(events: Record<string, unknown>[]): Promise<string> {
  const upstream = new Response(codexSseBody(events), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  const translated = await translateResponsesSseToChat(upstream, { model: "gpt-5.5" });
  return translated.text();
}

describe("translateResponsesSseToChat — Codex tool egress", () => {
  it("text-only stream ends with finish_reason stop (regression)", async () => {
    const sse = await collectChatChunks(textOnlyStream());
    const chunks = parseDataChunks(sse);

    const textChunks = chunks.filter((c) => {
      const choices = c.choices as Array<{ delta?: { content?: string } }>;
      return typeof choices?.[0]?.delta?.content === "string";
    });
    expect(textChunks.length).toBeGreaterThanOrEqual(2);

    const finishChunk = chunks.find((c) => {
      const choices = c.choices as Array<{ finish_reason?: string | null }>;
      return choices?.[0]?.finish_reason === "stop";
    });
    expect(finishChunk).toBeDefined();
    expect(sse.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("function_call emits tool_calls with streaming arguments and finish_reason tool_calls", async () => {
    const sse = await collectChatChunks(functionCallStream());
    const chunks = parseDataChunks(sse);

    const toolChunks = chunks.filter((c) => {
      const choices = c.choices as Array<{ delta?: { tool_calls?: unknown[] } }>;
      return Array.isArray(choices?.[0]?.delta?.tool_calls);
    });
    expect(toolChunks.length).toBeGreaterThanOrEqual(3);

    const start = toolChunks[0].choices as Array<{
      delta: { tool_calls: Array<{ id: string; function: { name: string; arguments: string } }> };
    }>;
    expect(start[0].delta.tool_calls[0].id).toBe("call_weather");
    expect(start[0].delta.tool_calls[0].function.name).toBe("get_weather");
    expect(start[0].delta.tool_calls[0].function.arguments).toBe("");

    const argDeltas = toolChunks
      .slice(1)
      .map((c) => {
        const choices = c.choices as Array<{
          delta: { tool_calls: Array<{ function: { arguments: string } }> };
        }>;
        return choices[0].delta.tool_calls[0].function.arguments;
      })
      .join("");
    expect(argDeltas).toBe('{"city":"London"}');

    const finishChunk = chunks.find((c) => {
      const choices = c.choices as Array<{ finish_reason?: string | null }>;
      return choices?.[0]?.finish_reason === "tool_calls";
    });
    expect(finishChunk).toBeDefined();
  });

  it("custom_tool_call and custom_tool_call_input.delta translate like function_call", async () => {
    const sse = await collectChatChunks(customToolCallStream());
    const chunks = parseDataChunks(sse);

    const toolChunks = chunks.filter((c) => {
      const choices = c.choices as Array<{ delta?: { tool_calls?: unknown[] } }>;
      return Array.isArray(choices?.[0]?.delta?.tool_calls);
    });
    expect(toolChunks.length).toBeGreaterThanOrEqual(3);

    const start = toolChunks[0].choices as Array<{
      delta: { tool_calls: Array<{ id: string; function: { name: string } }> };
    }>;
    expect(start[0].delta.tool_calls[0].id).toBe("call_patch");
    expect(start[0].delta.tool_calls[0].function.name).toBe("ApplyPatch");

    const argDeltas = toolChunks
      .slice(1)
      .map((c) => {
        const choices = c.choices as Array<{
          delta: { tool_calls: Array<{ function: { arguments: string } }> };
        }>;
        return choices[0].delta.tool_calls[0].function.arguments;
      })
      .join("");
    expect(argDeltas).toBe("*** Begin Patch\n*** End Patch");

    const finishChunk = chunks.find((c) => {
      const choices = c.choices as Array<{ finish_reason?: string | null }>;
      return choices?.[0]?.finish_reason === "tool_calls";
    });
    expect(finishChunk).toBeDefined();
  });

  it("output_item.done emits full arguments when no deltas were streamed", async () => {
    const sse = await collectChatChunks(functionCallDoneFallbackStream());
    const chunks = parseDataChunks(sse);

    const toolChunks = chunks.filter((c) => {
      const choices = c.choices as Array<{ delta?: { tool_calls?: unknown[] } }>;
      return Array.isArray(choices?.[0]?.delta?.tool_calls);
    });
    expect(toolChunks.length).toBe(2);

    const done = toolChunks[1].choices as Array<{
      delta: { tool_calls: Array<{ function: { arguments: string } }> };
    }>;
    expect(done[0].delta.tool_calls[0].function.arguments).toBe('{"q":"test"}');
  });
});
