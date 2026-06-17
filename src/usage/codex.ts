import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type CodexUsageFinish = "stop" | "tool_calls";

export interface CodexUsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface RecordCodexCalculatedUsageInput {
  home: string;
  providerAccountFingerprint: string;
  responseId: string | null;
  clientModel: string;
  bareModelId: string;
  effort: string | null;
  fastTier: boolean;
  finish: CodexUsageFinish;
  usage: Record<string, unknown>;
  recordedAt?: string | number | null;
}

export interface CodexCalculatedUsageRawEvent {
  id: string;
  recordedAt: string;
  provider: "codex";
  providerAccountFingerprint: string;
  responseId: string | null;
  clientModel: string;
  bareModelId: string;
  effort: string | null;
  fastTier: boolean;
  finish: CodexUsageFinish;
  usage: Record<string, unknown>;
  normalizedUsage: CodexUsageTotals;
}

export interface CodexDailyUsageSnapshot extends CodexUsageTotals {
  dataIdentity: string;
  provider: "codex";
  providerAccountFingerprint: string;
  date: string;
  costUSD: null;
  costSource: "unknown";
  updatedAt: string;
  models: Array<CodexUsageTotals & { bareModelId: string }>;
}

export type CodexUsageRecorder = (input: RecordCodexCalculatedUsageInput) => void;

export function providerAccountFingerprintFor(
  provider: "codex" | "claude",
  identityValue: string,
): string {
  const identity = identityValue.trim() || "unknown";
  const digest = createHash("sha256")
    .update(["eport-provider-account-fingerprint:v1", provider, identity].join("\0"))
    .digest("hex");
  return `fp_${digest}`;
}

export function recordCodexCalculatedUsage(
  input: RecordCodexCalculatedUsageInput,
): CodexCalculatedUsageRawEvent {
  const recordedAt = normalizeRecordedAt(input.recordedAt);
  const normalizedUsage = normalizeCodexUsage(input.usage);
  const event: CodexCalculatedUsageRawEvent = {
    id: codexRawEventId(input.providerAccountFingerprint, input.responseId, recordedAt),
    recordedAt,
    provider: "codex",
    providerAccountFingerprint: input.providerAccountFingerprint,
    responseId: input.responseId,
    clientModel: input.clientModel,
    bareModelId: input.bareModelId,
    effort: input.effort,
    fastTier: input.fastTier,
    finish: input.finish,
    usage: input.usage,
    normalizedUsage,
  };

  appendJsonLine(getCodexEportRawEventsPath(input.home, input.providerAccountFingerprint), event);
  appendJsonLine(
    getCodexEportSessionFilePath(input.home, input.providerAccountFingerprint, recordedAt),
    {
      timestamp: recordedAt,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          model: input.bareModelId,
          last_token_usage: toCodexCcusageTokens(normalizedUsage),
          total_token_usage: toCodexCcusageTokens(normalizedUsage),
          metadata: {
            source: "eport",
            providerAccountFingerprint: input.providerAccountFingerprint,
            responseId: input.responseId,
            clientModel: input.clientModel,
            effort: input.effort,
            fastTier: input.fastTier,
            finish: input.finish,
          },
        },
      },
    },
  );
  writeDailySnapshot(input.home, input.providerAccountFingerprint, event);

  return event;
}

export function normalizeCodexUsage(usage: Record<string, unknown>): CodexUsageTotals {
  const inputTokens = readToken(usage.input_tokens) ?? 0;
  const inputDetails = readRecord(usage.input_tokens_details);
  const cachedInputTokens =
    readToken(inputDetails?.cached_tokens) ??
    readToken(usage.cached_input_tokens) ??
    readToken(usage.cache_read_input_tokens) ??
    0;
  const outputTokens = readToken(usage.output_tokens) ?? 0;
  const outputDetails = readRecord(usage.output_tokens_details);
  const reasoningOutputTokens =
    readToken(outputDetails?.reasoning_tokens) ??
    readToken(usage.reasoning_output_tokens) ??
    readToken(usage.reasoning_tokens) ??
    0;
  const totalTokens = readToken(usage.total_tokens) ?? inputTokens + outputTokens;

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

export function getCodexEportAccountPartitionPath(
  home: string,
  providerAccountFingerprint: string,
): string {
  return join(
    home,
    ".codex",
    "eport-accounts",
    safePathSegment(providerAccountFingerprint),
  );
}

export function getCodexEportRawEventsPath(
  home: string,
  providerAccountFingerprint: string,
): string {
  return join(
    getCodexEportAccountPartitionPath(home, providerAccountFingerprint),
    "eport",
    "raw-events.jsonl",
  );
}

export function getCodexEportDailySnapshotPath(
  home: string,
  providerAccountFingerprint: string,
  day: string,
): string {
  return join(
    getCodexEportAccountPartitionPath(home, providerAccountFingerprint),
    "eport",
    "daily",
    `${day}.json`,
  );
}

export function getCodexEportSessionFilePath(
  home: string,
  providerAccountFingerprint: string,
  recordedAt: string,
): string {
  const day = reportingDay(recordedAt);
  return join(
    getCodexEportAccountPartitionPath(home, providerAccountFingerprint),
    "sessions",
    "eport-cursor-proxy",
    `${day}.jsonl`,
  );
}

export function reportingDay(recordedAt: string): string {
  return recordedAt.slice(0, 10);
}

function writeDailySnapshot(
  home: string,
  providerAccountFingerprint: string,
  event: CodexCalculatedUsageRawEvent,
): void {
  const day = reportingDay(event.recordedAt);
  const rawEvents = readRawEvents(getCodexEportRawEventsPath(home, providerAccountFingerprint));
  const snapshot = buildDailySnapshot(rawEvents, providerAccountFingerprint, day, event.recordedAt);
  const path = getCodexEportDailySnapshotPath(home, providerAccountFingerprint, day);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function buildDailySnapshot(
  events: CodexCalculatedUsageRawEvent[],
  providerAccountFingerprint: string,
  day: string,
  updatedAt: string,
): CodexDailyUsageSnapshot {
  const totals = emptyTotals();
  const modelTotals = new Map<string, CodexUsageTotals>();

  for (const event of events) {
    if (event.provider !== "codex") continue;
    if (event.providerAccountFingerprint !== providerAccountFingerprint) continue;
    if (reportingDay(event.recordedAt) !== day) continue;
    addTotals(totals, event.normalizedUsage);
    const model = modelTotals.get(event.bareModelId) ?? emptyTotals();
    addTotals(model, event.normalizedUsage);
    modelTotals.set(event.bareModelId, model);
  }

  return {
    dataIdentity: `eport:codex:${providerAccountFingerprint}:daily:${day}`,
    provider: "codex",
    providerAccountFingerprint,
    date: day,
    ...totals,
    costUSD: null,
    costSource: "unknown",
    updatedAt,
    models: [...modelTotals.entries()].map(([bareModelId, model]) => ({
      bareModelId,
      ...model,
    })),
  };
}

function readRawEvents(path: string): CodexCalculatedUsageRawEvent[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as CodexCalculatedUsageRawEvent;
        if (!parsed || parsed.provider !== "codex") return [];
        return [parsed];
      } catch {
        return [];
      }
    });
}

function appendJsonLine(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

function toCodexCcusageTokens(totals: CodexUsageTotals): Record<string, number> {
  return {
    input_tokens: totals.inputTokens,
    cached_input_tokens: totals.cachedInputTokens,
    output_tokens: totals.outputTokens,
    reasoning_output_tokens: totals.reasoningOutputTokens,
    total_tokens: totals.totalTokens,
  };
}

function emptyTotals(): CodexUsageTotals {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function addTotals(target: CodexUsageTotals, next: CodexUsageTotals): void {
  target.inputTokens += next.inputTokens;
  target.cachedInputTokens += next.cachedInputTokens;
  target.outputTokens += next.outputTokens;
  target.reasoningOutputTokens += next.reasoningOutputTokens;
  target.totalTokens += next.totalTokens;
}

function codexRawEventId(
  providerAccountFingerprint: string,
  responseId: string | null,
  recordedAt: string,
): string {
  if (responseId) {
    return `eport:codex:${providerAccountFingerprint}:${responseId}`;
  }
  return `eport:codex:${providerAccountFingerprint}:${recordedAt}:${crypto.randomUUID()}`;
}

function normalizeRecordedAt(value: string | number | null | undefined): string {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  return new Date().toISOString();
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readToken(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function safePathSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "unknown";
}
