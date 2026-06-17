import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getCodexEportAccountPartitionPath,
  getCodexEportDailySnapshotPath,
  getCodexEportRawEventsPath,
  getCodexEportSessionFilePath,
  normalizeCodexUsage,
  providerAccountFingerprintFor,
  recordCodexCalculatedUsage,
} from "../../src/usage/codex.ts";

describe("Codex calculated usage", () => {
  it("normalizes upstream response usage token fields", () => {
    expect(
      normalizeCodexUsage({
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 40 },
        output_tokens: 25,
        output_tokens_details: { reasoning_tokens: 10 },
        total_tokens: 125,
      }),
    ).toEqual({
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 25,
      reasoningOutputTokens: 10,
      totalTokens: 125,
    });
  });

  it("writes raw events, daily snapshots, and Codex session rows inside the account partition", () => {
    const home = mkdtempSync(join(tmpdir(), "eport-codex-usage-"));
    const fingerprint = providerAccountFingerprintFor("codex", "acct-test");

    try {
      recordCodexCalculatedUsage({
        home,
        providerAccountFingerprint: fingerprint,
        responseId: "resp_1",
        clientModel: "gpt-5.5xhigh-fast",
        bareModelId: "gpt-5.5",
        effort: "xhigh",
        fastTier: true,
        finish: "stop",
        recordedAt: "2026-06-17T15:00:00.000Z",
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 40 },
          output_tokens: 25,
          output_tokens_details: { reasoning_tokens: 10 },
          total_tokens: 125,
        },
      });
      recordCodexCalculatedUsage({
        home,
        providerAccountFingerprint: fingerprint,
        responseId: "resp_2",
        clientModel: "gpt-5.5",
        bareModelId: "gpt-5.5",
        effort: null,
        fastTier: false,
        finish: "tool_calls",
        recordedAt: "2026-06-17T15:05:00.000Z",
        usage: {
          input_tokens: 200,
          input_tokens_details: { cached_tokens: 50 },
          output_tokens: 30,
          output_tokens_details: { reasoning_tokens: 15 },
          total_tokens: 230,
        },
      });

      const rawEvents = readFileSync(getCodexEportRawEventsPath(home, fingerprint), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(rawEvents).toHaveLength(2);
      expect(rawEvents[0]).toMatchObject({
        provider: "codex",
        providerAccountFingerprint: fingerprint,
        responseId: "resp_1",
        clientModel: "gpt-5.5xhigh-fast",
        bareModelId: "gpt-5.5",
        effort: "xhigh",
        fastTier: true,
        finish: "stop",
      });

      const snapshot = JSON.parse(
        readFileSync(getCodexEportDailySnapshotPath(home, fingerprint, "2026-06-17"), "utf8"),
      ) as Record<string, unknown>;
      expect(snapshot).toMatchObject({
        dataIdentity: `eport:codex:${fingerprint}:daily:2026-06-17`,
        provider: "codex",
        providerAccountFingerprint: fingerprint,
        date: "2026-06-17",
        inputTokens: 300,
        cachedInputTokens: 90,
        outputTokens: 55,
        reasoningOutputTokens: 25,
        totalTokens: 355,
        costUSD: null,
        costSource: "unknown",
      });

      const sessionRows = readFileSync(
        getCodexEportSessionFilePath(home, fingerprint, "2026-06-17T15:00:00.000Z"),
        "utf8",
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(sessionRows).toHaveLength(2);
      expect(sessionRows[0]).toMatchObject({
        timestamp: "2026-06-17T15:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            model: "gpt-5.5",
            last_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 40,
              output_tokens: 25,
              reasoning_output_tokens: 10,
              total_tokens: 125,
            },
          },
        },
      });
      expect(existsSync(getCodexEportAccountPartitionPath(home, fingerprint))).toBe(true);
      expect(existsSync(join(home, ".codex", "sessions"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
