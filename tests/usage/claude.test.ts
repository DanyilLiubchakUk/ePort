import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";

import {
  fallbackProviderAccountFingerprintFor,
  providerAccountFingerprintFor,
} from "../../src/usage/common.ts";
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

      const rawEvents = readFileSync(getClaudeEportRawEventsPath(home, fingerprint, "2026-06-17"), "utf8")
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

  it("writes separate daily snapshots for two Provider Account fingerprints", () => {
    const home = mkdtempSync(join(tmpdir(), "eport-claude-two-accounts-"));
    const work = providerAccountFingerprintFor("claude", "claude-work");
    const personal = providerAccountFingerprintFor("claude", "claude-personal");

    try {
      recordClaudeCalculatedUsage({
        home,
        providerAccountFingerprint: work,
        responseId: "msg_work",
        clientModel: "opus-4.8max",
        bareModelId: "opus-4.8",
        effort: "max",
        finish: "stop",
        recordedAt: "2026-06-17T17:00:00.000Z",
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 3,
          output_tokens: 4,
        },
      });
      recordClaudeCalculatedUsage({
        home,
        providerAccountFingerprint: personal,
        responseId: "msg_personal",
        clientModel: "opus-4.8high",
        bareModelId: "opus-4.8",
        effort: "high",
        finish: "tool_calls",
        recordedAt: "2026-06-17T17:05:00.000Z",
        usage: {
          input_tokens: 30,
          cache_creation_input_tokens: 4,
          cache_read_input_tokens: 5,
          output_tokens: 6,
        },
      });

      const workSnapshot = readJsonFile(
        getClaudeEportDailySnapshotPath(home, work, "2026-06-17"),
      );
      const personalSnapshot = readJsonFile(
        getClaudeEportDailySnapshotPath(home, personal, "2026-06-17"),
      );
      expect(workSnapshot).toMatchObject({
        dataIdentity: `eport:claude:${work}:daily:2026-06-17`,
        providerAccountFingerprint: work,
        totalTokens: 19,
      });
      expect(personalSnapshot).toMatchObject({
        dataIdentity: `eport:claude:${personal}:daily:2026-06-17`,
        providerAccountFingerprint: personal,
        totalTokens: 45,
      });
      expect(existsSync(join(home, ".claude", "projects"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps unknown Claude ownership under the provider fallback account", () => {
    const home = mkdtempSync(join(tmpdir(), "eport-claude-fallback-"));
    const fallback = fallbackProviderAccountFingerprintFor("claude");

    try {
      recordClaudeCalculatedUsage({
        home,
        providerAccountFingerprint: fallback,
        responseId: "msg_unknown",
        clientModel: "opus-4.8",
        bareModelId: "opus-4.8",
        effort: null,
        finish: "stop",
        recordedAt: "2026-06-17T18:00:00.000Z",
        usage: { input_tokens: 5, output_tokens: 1 },
      });

      expect(existsSync(getClaudeEportRawEventsPath(home, fallback, "2026-06-17"))).toBe(true);
      expect(readJsonFile(getClaudeEportDailySnapshotPath(home, fallback, "2026-06-17"))).toMatchObject({
        dataIdentity: `eport:claude:${fallback}:daily:2026-06-17`,
        providerAccountFingerprint: fallback,
        totalTokens: 6,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("dedupes replayed message ids across raw events, project rows, and daily totals", () => {
    const home = mkdtempSync(join(tmpdir(), "eport-claude-replay-"));
    const fingerprint = providerAccountFingerprintFor("claude", "claude-replay");

    try {
      const input = {
        home,
        providerAccountFingerprint: fingerprint,
        responseId: "msg_replay",
        clientModel: "opus-4.8",
        bareModelId: "opus-4.8",
        effort: null,
        finish: "stop",
        recordedAt: "2026-06-17T19:00:00.000Z",
        usage: { input_tokens: 10, output_tokens: 2 },
      };
      recordClaudeCalculatedUsage(input);
      recordClaudeCalculatedUsage({
        ...input,
        recordedAt: "2026-06-17T19:05:00.000Z",
        usage: { input_tokens: 1000, output_tokens: 2000 },
      });

      expect(readJsonLines(getClaudeEportRawEventsPath(home, fingerprint, "2026-06-17"))).toHaveLength(1);
      expect(
        readJsonLines(
          getClaudeEportSessionFilePath(home, fingerprint, "2026-06-17T19:00:00.000Z"),
        ),
      ).toHaveLength(1);
      expect(readJsonFile(getClaudeEportDailySnapshotPath(home, fingerprint, "2026-06-17"))).toMatchObject({
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("uses legacy raw events as canonical data during shard migration", () => {
    const home = mkdtempSync(join(tmpdir(), "eport-claude-legacy-raw-"));
    const fingerprint = providerAccountFingerprintFor("claude", "claude-legacy");
    const legacyRawEventsPath = getClaudeEportRawEventsPath(home, fingerprint);
    const legacyEvent = {
      id: `eport:claude:${fingerprint}:msg_legacy`,
      recordedAt: "2026-06-17T20:00:00.000Z",
      provider: "claude",
      providerAccountFingerprint: fingerprint,
      responseId: "msg_legacy",
      clientModel: "opus-4.8",
      bareModelId: "opus-4.8",
      effort: null,
      finish: "stop",
      usage: { input_tokens: 10, output_tokens: 2 },
      normalizedUsage: {
        inputTokens: 10,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 2,
        totalTokens: 12,
        serverToolUse: {},
      },
    };

    try {
      mkdirSync(dirname(legacyRawEventsPath), { recursive: true });
      writeFileSync(legacyRawEventsPath, `${JSON.stringify(legacyEvent)}\n`, "utf8");

      recordClaudeCalculatedUsage({
        home,
        providerAccountFingerprint: fingerprint,
        responseId: "msg_legacy",
        clientModel: "opus-4.8",
        bareModelId: "opus-4.8",
        effort: null,
        finish: "stop",
        recordedAt: "2026-06-17T20:05:00.000Z",
        usage: { input_tokens: 1000, output_tokens: 2000 },
      });

      expect(existsSync(getClaudeEportRawEventsPath(home, fingerprint, "2026-06-17"))).toBe(false);
      expect(readJsonFile(getClaudeEportDailySnapshotPath(home, fingerprint, "2026-06-17"))).toMatchObject({
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
      });
      expect(
        readJsonLines(
          getClaudeEportSessionFilePath(home, fingerprint, "2026-06-17T20:00:00.000Z"),
        ),
      ).toHaveLength(1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("builds account partition paths for macOS and Windows homes", () => {
    expect(getClaudeEportAccountPartitionPath("/Users/dev", "fp_account")).toBe(
      posix.join("/Users/dev", ".claude", "eport-accounts", "fp_account"),
    );
    expect(getClaudeEportAccountPartitionPath("C:\\Users\\dev", "fp:bad/path")).toBe(
      win32.join("C:\\Users\\dev", ".claude", "eport-accounts", "fp_bad_path"),
    );
  });
});

function readJsonLines(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function readJsonFile(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}
