import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  appendJsonLine,
  normalizeRecordedAt,
  readRecord,
  readToken,
  reportingDay,
  safePathSegment,
} from "./common.ts";

export type ClaudeUsageFinish = string;

export interface ClaudeUsageTotals {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  serverToolUse: Record<string, number>;
}

export interface RecordClaudeCalculatedUsageInput {
  home: string;
  providerAccountFingerprint: string;
  responseId: string | null;
  clientModel: string;
  bareModelId: string;
  effort: string | null;
  finish: ClaudeUsageFinish;
  usage: Record<string, unknown>;
  recordedAt?: string | number | null;
}

export interface ClaudeCalculatedUsageRawEvent {
  id: string;
  recordedAt: string;
  provider: "claude";
  providerAccountFingerprint: string;
  responseId: string | null;
  clientModel: string;
  bareModelId: string;
  effort: string | null;
  finish: ClaudeUsageFinish;
  usage: Record<string, unknown>;
  normalizedUsage: ClaudeUsageTotals;
}

export interface ClaudeDailyUsageSnapshot extends ClaudeUsageTotals {
  dataIdentity: string;
  provider: "claude";
  providerAccountFingerprint: string;
  date: string;
  costUSD: null;
  costSource: "unknown";
  updatedAt: string;
  models: Array<ClaudeUsageTotals & { bareModelId: string }>;
}

export type ClaudeUsageRecorder = (input: RecordClaudeCalculatedUsageInput) => void;

export function recordClaudeCalculatedUsage(
  input: RecordClaudeCalculatedUsageInput,
): ClaudeCalculatedUsageRawEvent {
  const recordedAt = normalizeRecordedAt(input.recordedAt);
  const normalizedUsage = normalizeClaudeUsage(input.usage);
  const event: ClaudeCalculatedUsageRawEvent = {
    id: claudeRawEventId(input.providerAccountFingerprint, input.responseId, recordedAt),
    recordedAt,
    provider: "claude",
    providerAccountFingerprint: input.providerAccountFingerprint,
    responseId: input.responseId,
    clientModel: input.clientModel,
    bareModelId: input.bareModelId,
    effort: input.effort,
    finish: input.finish,
    usage: input.usage,
    normalizedUsage,
  };

  appendJsonLine(getClaudeEportRawEventsPath(input.home, input.providerAccountFingerprint), event);
  appendJsonLine(
    getClaudeEportSessionFilePath(input.home, input.providerAccountFingerprint, recordedAt),
    {
      sessionId: "eport-cursor-proxy",
      timestamp: recordedAt,
      version: "1.0.0",
      requestId: event.id,
      message: {
        id: input.responseId ?? event.id,
        model: input.bareModelId,
        usage: toClaudeCodeUsage(normalizedUsage),
      },
      eport: {
        providerAccountFingerprint: input.providerAccountFingerprint,
        responseId: input.responseId,
        clientModel: input.clientModel,
        effort: input.effort,
        finish: input.finish,
      },
    },
  );
  writeDailySnapshot(input.home, input.providerAccountFingerprint, event);

  return event;
}

export function normalizeClaudeUsage(usage: Record<string, unknown>): ClaudeUsageTotals {
  const inputTokens = readToken(usage.input_tokens) ?? 0;
  const cacheCreation = readRecord(usage.cache_creation);
  const cacheCreationInputTokens =
    readToken(usage.cache_creation_input_tokens) ??
    (readToken(cacheCreation?.ephemeral_5m_input_tokens) ?? 0) +
      (readToken(cacheCreation?.ephemeral_1h_input_tokens) ?? 0);
  const cacheReadInputTokens = readToken(usage.cache_read_input_tokens) ?? 0;
  const outputTokens = readToken(usage.output_tokens) ?? 0;
  const serverToolUse = readTokenMap(readRecord(usage.server_tool_use));
  const totalTokens =
    inputTokens +
    cacheCreationInputTokens +
    cacheReadInputTokens +
    outputTokens;

  return {
    inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    outputTokens,
    totalTokens,
    serverToolUse,
  };
}

export function getClaudeEportAccountPartitionPath(
  home: string,
  providerAccountFingerprint: string,
): string {
  return join(
    home,
    ".claude",
    "eport-accounts",
    safePathSegment(providerAccountFingerprint),
  );
}

export function getClaudeEportRawEventsPath(
  home: string,
  providerAccountFingerprint: string,
): string {
  return join(
    getClaudeEportAccountPartitionPath(home, providerAccountFingerprint),
    "eport",
    "raw-events.jsonl",
  );
}

export function getClaudeEportDailySnapshotPath(
  home: string,
  providerAccountFingerprint: string,
  day: string,
): string {
  return join(
    getClaudeEportAccountPartitionPath(home, providerAccountFingerprint),
    "eport",
    "daily",
    `${day}.json`,
  );
}

export function getClaudeEportProjectPath(
  home: string,
  providerAccountFingerprint: string,
): string {
  return join(
    getClaudeEportAccountPartitionPath(home, providerAccountFingerprint),
    "projects",
    "eport-cursor-proxy",
  );
}

export function getClaudeEportSessionFilePath(
  home: string,
  providerAccountFingerprint: string,
  recordedAt: string,
): string {
  const day = reportingDay(recordedAt);
  return join(getClaudeEportProjectPath(home, providerAccountFingerprint), `${day}.jsonl`);
}

function writeDailySnapshot(
  home: string,
  providerAccountFingerprint: string,
  event: ClaudeCalculatedUsageRawEvent,
): void {
  const day = reportingDay(event.recordedAt);
  const rawEvents = readRawEvents(getClaudeEportRawEventsPath(home, providerAccountFingerprint));
  const snapshot = buildDailySnapshot(rawEvents, providerAccountFingerprint, day, event.recordedAt);
  const path = getClaudeEportDailySnapshotPath(home, providerAccountFingerprint, day);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function buildDailySnapshot(
  events: ClaudeCalculatedUsageRawEvent[],
  providerAccountFingerprint: string,
  day: string,
  updatedAt: string,
): ClaudeDailyUsageSnapshot {
  const totals = emptyTotals();
  const modelTotals = new Map<string, ClaudeUsageTotals>();

  for (const event of events) {
    if (event.provider !== "claude") continue;
    if (event.providerAccountFingerprint !== providerAccountFingerprint) continue;
    if (reportingDay(event.recordedAt) !== day) continue;
    addTotals(totals, event.normalizedUsage);
    const model = modelTotals.get(event.bareModelId) ?? emptyTotals();
    addTotals(model, event.normalizedUsage);
    modelTotals.set(event.bareModelId, model);
  }

  return {
    dataIdentity: `eport:claude:${providerAccountFingerprint}:daily:${day}`,
    provider: "claude",
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

function readRawEvents(path: string): ClaudeCalculatedUsageRawEvent[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as ClaudeCalculatedUsageRawEvent;
        if (!parsed || parsed.provider !== "claude") return [];
        return [parsed];
      } catch {
        return [];
      }
    });
}

function toClaudeCodeUsage(totals: ClaudeUsageTotals): Record<string, unknown> {
  return {
    input_tokens: totals.inputTokens,
    output_tokens: totals.outputTokens,
    cache_creation_input_tokens: totals.cacheCreationInputTokens,
    cache_read_input_tokens: totals.cacheReadInputTokens,
  };
}

function emptyTotals(): ClaudeUsageTotals {
  return {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    serverToolUse: {},
  };
}

function addTotals(target: ClaudeUsageTotals, next: ClaudeUsageTotals): void {
  target.inputTokens += next.inputTokens;
  target.cacheCreationInputTokens += next.cacheCreationInputTokens;
  target.cacheReadInputTokens += next.cacheReadInputTokens;
  target.outputTokens += next.outputTokens;
  target.totalTokens += next.totalTokens;
  for (const [key, value] of Object.entries(next.serverToolUse)) {
    target.serverToolUse[key] = (target.serverToolUse[key] ?? 0) + value;
  }
}

function readTokenMap(value: Record<string, unknown> | null): Record<string, number> {
  if (!value) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const token = readToken(raw);
    if (token !== null) result[key] = token;
  }
  return result;
}

function claudeRawEventId(
  providerAccountFingerprint: string,
  responseId: string | null,
  recordedAt: string,
): string {
  if (responseId) {
    return `eport:claude:${providerAccountFingerprint}:${responseId}`;
  }
  return `eport:claude:${providerAccountFingerprint}:${recordedAt}:${crypto.randomUUID()}`;
}
