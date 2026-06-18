import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";

import {
  fallbackProviderAccountFingerprintFor,
  getCodexEportAccountPartitionPath,
  getCodexEportDailySnapshotPath,
  getCodexEportProviderAccountIdentityPath,
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
    const providerAccountIdentity = {
      identityKind: "providerAccountId" as const,
      identityValue: "acct-test",
      identityConfidence: "high" as const,
    };

    try {
      recordCodexCalculatedUsage({
        home,
        providerAccountFingerprint: fingerprint,
        providerAccountIdentity,
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
        providerAccountIdentity,
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
        providerAccountIdentity,
        responseId: "resp_1",
        clientModel: "gpt-5.5xhigh-fast",
        bareModelId: "gpt-5.5",
        effort: "xhigh",
        fastTier: true,
        finish: "stop",
      });

      expect(readJsonFile(getCodexEportProviderAccountIdentityPath(home, fingerprint))).toMatchObject({
        version: 1,
        provider: "codex",
        providerAccountFingerprint: fingerprint,
        providerAccountIdentity,
      });

      const snapshot = JSON.parse(
        readFileSync(getCodexEportDailySnapshotPath(home, fingerprint, "2026-06-17"), "utf8"),
      ) as Record<string, unknown>;
      expect(snapshot).toMatchObject({
        dataIdentity: `eport:codex:${fingerprint}:daily:2026-06-17`,
        provider: "codex",
        providerAccountFingerprint: fingerprint,
        providerAccountIdentity,
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
            metadata: {
              providerAccountFingerprint: fingerprint,
              providerAccountIdentity,
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

  it("writes separate daily snapshots for two Provider Account fingerprints", () => {
    const home = mkdtempSync(join(tmpdir(), "eport-codex-two-accounts-"));
    const work = providerAccountFingerprintFor("codex", "acct-work");
    const personal = providerAccountFingerprintFor("codex", "acct-personal");

    try {
      recordCodexCalculatedUsage({
        home,
        providerAccountFingerprint: work,
        responseId: "resp_work",
        clientModel: "gpt-5.5",
        bareModelId: "gpt-5.5",
        effort: null,
        fastTier: false,
        finish: "stop",
        recordedAt: "2026-06-17T10:00:00.000Z",
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      });
      recordCodexCalculatedUsage({
        home,
        providerAccountFingerprint: personal,
        responseId: "resp_personal",
        clientModel: "gpt-5.5xhigh",
        bareModelId: "gpt-5.5",
        effort: "xhigh",
        fastTier: false,
        finish: "tool_calls",
        recordedAt: "2026-06-17T11:00:00.000Z",
        usage: { input_tokens: 30, output_tokens: 4, total_tokens: 34 },
      });

      const workSnapshot = readJsonFile(
        getCodexEportDailySnapshotPath(home, work, "2026-06-17"),
      );
      const personalSnapshot = readJsonFile(
        getCodexEportDailySnapshotPath(home, personal, "2026-06-17"),
      );
      expect(workSnapshot).toMatchObject({
        dataIdentity: `eport:codex:${work}:daily:2026-06-17`,
        providerAccountFingerprint: work,
        totalTokens: 12,
      });
      expect(personalSnapshot).toMatchObject({
        dataIdentity: `eport:codex:${personal}:daily:2026-06-17`,
        providerAccountFingerprint: personal,
        totalTokens: 34,
      });
      expect(existsSync(join(home, ".codex", "sessions"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps unknown Codex ownership under the provider fallback account", () => {
    const home = mkdtempSync(join(tmpdir(), "eport-codex-fallback-"));
    const fallback = fallbackProviderAccountFingerprintFor("codex");

    try {
      recordCodexCalculatedUsage({
        home,
        providerAccountFingerprint: fallback,
        responseId: "resp_unknown",
        clientModel: "gpt-5.5",
        bareModelId: "gpt-5.5",
        effort: null,
        fastTier: false,
        finish: "stop",
        recordedAt: "2026-06-17T12:00:00.000Z",
        usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
      });

      expect(existsSync(getCodexEportRawEventsPath(home, fallback))).toBe(true);
      expect(readJsonFile(getCodexEportDailySnapshotPath(home, fallback, "2026-06-17"))).toMatchObject({
        dataIdentity: `eport:codex:${fallback}:daily:2026-06-17`,
        providerAccountFingerprint: fallback,
        totalTokens: 6,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("dedupes replayed response ids across raw events, session rows, and daily totals", () => {
    const home = mkdtempSync(join(tmpdir(), "eport-codex-replay-"));
    const fingerprint = providerAccountFingerprintFor("codex", "acct-replay");

    try {
      const input = {
        home,
        providerAccountFingerprint: fingerprint,
        responseId: "resp_replay",
        clientModel: "gpt-5.5",
        bareModelId: "gpt-5.5",
        effort: null,
        fastTier: false,
        finish: "stop" as const,
        recordedAt: "2026-06-17T13:00:00.000Z",
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      };
      recordCodexCalculatedUsage(input);
      recordCodexCalculatedUsage({
        ...input,
        recordedAt: "2026-06-17T13:05:00.000Z",
        usage: { input_tokens: 1000, output_tokens: 2000, total_tokens: 3000 },
      });

      expect(readJsonLines(getCodexEportRawEventsPath(home, fingerprint))).toHaveLength(1);
      expect(
        readJsonLines(
          getCodexEportSessionFilePath(home, fingerprint, "2026-06-17T13:00:00.000Z"),
        ),
      ).toHaveLength(1);
      expect(readJsonFile(getCodexEportDailySnapshotPath(home, fingerprint, "2026-06-17"))).toMatchObject({
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("builds account partition paths for macOS and Windows homes", () => {
    expect(getCodexEportAccountPartitionPath("/Users/dev", "fp_account")).toBe(
      posix.join("/Users/dev", ".codex", "eport-accounts", "fp_account"),
    );
    expect(getCodexEportAccountPartitionPath("C:\\Users\\dev", "fp:bad/path")).toBe(
      win32.join("C:\\Users\\dev", ".codex", "eport-accounts", "fp_bad_path"),
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
