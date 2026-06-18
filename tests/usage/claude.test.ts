import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { providerAccountFingerprintFor } from "../../src/usage/common.ts";
import {
  getClaudeEportAccountPartitionPath,
  getClaudeEportDailySnapshotPath,
  getClaudeEportProjectPath,
  getClaudeEportRawEventsPath,
  getClaudeEportSessionFilePath,
  normalizeClaudeUsage,
  recordClaudeCalculatedUsage,
} from "../../src/usage/claude.ts";

describe("Claude calculated usage", () => {
  it("normalizes Anthropic streaming usage token fields", () => {
    expect(
      normalizeClaudeUsage({
        input_tokens: 100,
        cache_creation_input_tokens: 40,
        cache_read_input_tokens: 60,
        output_tokens: 25,
        server_tool_use: { web_search_requests: 2 },
      }),
    ).toEqual({
      inputTokens: 100,
      cacheCreationInputTokens: 40,
      cacheReadInputTokens: 60,
      outputTokens: 25,
      totalTokens: 225,
      serverToolUse: { web_search_requests: 2 },
    });
  });

  it("writes raw events, daily snapshots, and Claude project rows inside the account partition", () => {
    const home = mkdtempSync(join(tmpdir(), "eport-claude-usage-"));
    const fingerprint = providerAccountFingerprintFor("claude", "claude-account-test");

    try {
      recordClaudeCalculatedUsage({
        home,
        providerAccountFingerprint: fingerprint,
        responseId: "msg_1",
        clientModel: "opus-4.8max",
        bareModelId: "opus-4.8",
        effort: "max",
        finish: "stop",
        recordedAt: "2026-06-17T16:00:00.000Z",
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 40,
          cache_read_input_tokens: 60,
          output_tokens: 25,
          server_tool_use: { web_search_requests: 2 },
        },
      });
      recordClaudeCalculatedUsage({
        home,
        providerAccountFingerprint: fingerprint,
        responseId: "msg_2",
        clientModel: "opus-4.8high",
        bareModelId: "opus-4.8",
        effort: "high",
        finish: "tool_calls",
        recordedAt: "2026-06-17T16:05:00.000Z",
        usage: {
          input_tokens: 200,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 20,
          output_tokens: 30,
          server_tool_use: { web_search_requests: 1 },
        },
      });

      const rawEvents = readFileSync(getClaudeEportRawEventsPath(home, fingerprint), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(rawEvents).toHaveLength(2);
      expect(rawEvents[0]).toMatchObject({
        provider: "claude",
        providerAccountFingerprint: fingerprint,
        responseId: "msg_1",
        clientModel: "opus-4.8max",
        bareModelId: "opus-4.8",
        effort: "max",
        finish: "stop",
        usage: {
          server_tool_use: { web_search_requests: 2 },
        },
        normalizedUsage: {
          inputTokens: 100,
          cacheCreationInputTokens: 40,
          cacheReadInputTokens: 60,
          outputTokens: 25,
          totalTokens: 225,
          serverToolUse: { web_search_requests: 2 },
        },
      });

      const snapshot = JSON.parse(
        readFileSync(getClaudeEportDailySnapshotPath(home, fingerprint, "2026-06-17"), "utf8"),
      ) as Record<string, unknown>;
      expect(snapshot).toMatchObject({
        dataIdentity: `eport:claude:${fingerprint}:daily:2026-06-17`,
        provider: "claude",
        providerAccountFingerprint: fingerprint,
        date: "2026-06-17",
        inputTokens: 300,
        cacheCreationInputTokens: 50,
        cacheReadInputTokens: 80,
        outputTokens: 55,
        totalTokens: 485,
        serverToolUse: { web_search_requests: 3 },
        costUSD: null,
        costSource: "unknown",
      });

      const sessionRows = readFileSync(
        getClaudeEportSessionFilePath(home, fingerprint, "2026-06-17T16:00:00.000Z"),
        "utf8",
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(sessionRows).toHaveLength(2);
      expect(sessionRows[0]).toMatchObject({
        sessionId: "eport-cursor-proxy",
        timestamp: "2026-06-17T16:00:00.000Z",
        version: "1.0.0",
        requestId: `eport:claude:${fingerprint}:msg_1`,
        message: {
          id: "msg_1",
          model: "opus-4.8",
          usage: {
            input_tokens: 100,
            output_tokens: 25,
            cache_creation_input_tokens: 40,
            cache_read_input_tokens: 60,
          },
        },
      });
      expect(getClaudeEportProjectPath(home, fingerprint)).toBe(
        join(
          getClaudeEportAccountPartitionPath(home, fingerprint),
          "projects",
          "eport-cursor-proxy",
        ),
      );
      expect(existsSync(getClaudeEportAccountPartitionPath(home, fingerprint))).toBe(true);
      expect(existsSync(join(home, ".claude", "projects"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
