import {
  appendUniqueJsonLine,
  joinHomePath,
  normalizeRecordedAt,
  readJsonLines,
  readRecord,
  readToken,
  reportingDay,
  safePathSegment,
  upsertJsonLine,
  writeJsonFileAtomic,
} from "./common.ts";

export {
  fallbackProviderAccountFingerprintFor,
  providerAccountFingerprintFor,
  reportingDay,
} from "./common.ts";

export type CodexUsageFinish = "stop" | "tool_calls";

export interface CodexUsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface CodexProviderAccountIdentity {
  identityKind: "providerAccountId";
  identityValue: string;
  identityConfidence: "high";
}

export interface RecordCodexCalculatedUsageInput {
  home: string;
  providerAccountFingerprint: string;
  providerAccountIdentity?: CodexProviderAccountIdentity | null;
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
  providerAccountIdentity?: CodexProviderAccountIdentity;
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
  providerAccountIdentity?: CodexProviderAccountIdentity;
  date: string;
  costUSD: null;
  costSource: "unknown";
  updatedAt: string;
  models: Array<CodexUsageTotals & { bareModelId: string }>;
}

export type CodexUsageRecorder = (input: RecordCodexCalculatedUsageInput) => void;

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
    ...(input.providerAccountIdentity
      ? { providerAccountIdentity: input.providerAccountIdentity }
      : {}),
    responseId: input.responseId,
    clientModel: input.clientModel,
    bareModelId: input.bareModelId,
    effort: input.effort,
    fastTier: input.fastTier,
    finish: input.finish,
    usage: input.usage,
    normalizedUsage,
  };

  const rawEventsPath = getCodexEportRawEventsPath(input.home, input.providerAccountFingerprint);
  writeProviderAccountIdentity(input.home, input.providerAccountFingerprint, input.providerAccountIdentity);
  appendUniqueJsonLine(rawEventsPath, event, event.id, readEventId);
  const canonicalEvent = readRawEvents(rawEventsPath).find((row) => row.id === event.id) ?? event;
  upsertJsonLine(
    getCodexEportSessionFilePath(
      input.home,
      input.providerAccountFingerprint,
      canonicalEvent.recordedAt,
    ),
    toCodexSessionRow(canonicalEvent),
    canonicalEvent.id,
    readCodexSessionEventId,
  );
  writeDailySnapshot(input.home, input.providerAccountFingerprint, canonicalEvent);

  return canonicalEvent;
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
  return joinHomePath(
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
  return joinHomePath(
    getCodexEportAccountPartitionPath(home, providerAccountFingerprint),
    "eport",
    "raw-events.jsonl",
  );
}

export function getCodexEportProviderAccountIdentityPath(
  home: string,
  providerAccountFingerprint: string,
): string {
  return joinHomePath(
    getCodexEportAccountPartitionPath(home, providerAccountFingerprint),
    "eport",
    "provider-account.json",
  );
}

export function getCodexEportDailySnapshotPath(
  home: string,
  providerAccountFingerprint: string,
  day: string,
): string {
  return joinHomePath(
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
  return joinHomePath(
    getCodexEportAccountPartitionPath(home, providerAccountFingerprint),
    "sessions",
    "eport-cursor-proxy",
    `${day}.jsonl`,
  );
}

function writeDailySnapshot(
  home: string,
  providerAccountFingerprint: string,
  event: CodexCalculatedUsageRawEvent,
): void {
  const day = reportingDay(event.recordedAt);
  const rawEvents = readRawEvents(getCodexEportRawEventsPath(home, providerAccountFingerprint));
  const snapshot = buildDailySnapshot(
    rawEvents,
    providerAccountFingerprint,
    day,
    event.recordedAt,
    event.providerAccountIdentity,
  );
  const path = getCodexEportDailySnapshotPath(home, providerAccountFingerprint, day);
  writeJsonFileAtomic(path, snapshot);
}

function writeProviderAccountIdentity(
  home: string,
  providerAccountFingerprint: string,
  identity?: CodexProviderAccountIdentity | null,
): void {
  if (!identity) return;
  writeJsonFileAtomic(
    getCodexEportProviderAccountIdentityPath(home, providerAccountFingerprint),
    {
      version: 1,
      provider: "codex",
      providerAccountFingerprint,
      providerAccountIdentity: identity,
      updatedAt: new Date().toISOString(),
    },
  );
}

function buildDailySnapshot(
  events: CodexCalculatedUsageRawEvent[],
  providerAccountFingerprint: string,
  day: string,
  updatedAt: string,
  fallbackIdentity?: CodexProviderAccountIdentity,
): CodexDailyUsageSnapshot {
  const totals = emptyTotals();
  const modelTotals = new Map<string, CodexUsageTotals>();
  let providerAccountIdentity = fallbackIdentity;

  for (const event of events) {
    if (event.provider !== "codex") continue;
    if (event.providerAccountFingerprint !== providerAccountFingerprint) continue;
    if (reportingDay(event.recordedAt) !== day) continue;
    providerAccountIdentity = providerAccountIdentity ?? event.providerAccountIdentity;
    addTotals(totals, event.normalizedUsage);
    const model = modelTotals.get(event.bareModelId) ?? emptyTotals();
    addTotals(model, event.normalizedUsage);
    modelTotals.set(event.bareModelId, model);
  }

  return {
    dataIdentity: `eport:codex:${providerAccountFingerprint}:daily:${day}`,
    provider: "codex",
    providerAccountFingerprint,
    ...(providerAccountIdentity ? { providerAccountIdentity } : {}),
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
  const events = new Map<string, CodexCalculatedUsageRawEvent>();
  for (const value of readJsonLines(path)) {
    const parsed = readRecord(value) as CodexCalculatedUsageRawEvent | null;
    if (!parsed || parsed.provider !== "codex") continue;
    if (typeof parsed.id !== "string" || events.has(parsed.id)) continue;
    events.set(parsed.id, parsed);
  }
  return [...events.values()];
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

function toCodexSessionRow(event: CodexCalculatedUsageRawEvent): Record<string, unknown> {
  return {
    timestamp: event.recordedAt,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        model: event.bareModelId,
        last_token_usage: toCodexCcusageTokens(event.normalizedUsage),
        total_token_usage: toCodexCcusageTokens(event.normalizedUsage),
        metadata: {
          source: "eport",
          providerAccountFingerprint: event.providerAccountFingerprint,
          ...(event.providerAccountIdentity
            ? { providerAccountIdentity: event.providerAccountIdentity }
            : {}),
          responseId: event.responseId,
          eventId: event.id,
          clientModel: event.clientModel,
          effort: event.effort,
          fastTier: event.fastTier,
          finish: event.finish,
        },
      },
    },
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

function readEventId(value: unknown): string | null {
  const record = readRecord(value);
  return typeof record?.id === "string" ? record.id : null;
}

function readCodexSessionEventId(value: unknown): string | null {
  const record = readRecord(value);
  const payload = readRecord(record?.payload);
  const info = readRecord(payload?.info);
  const metadata = readRecord(info?.metadata);
  return typeof metadata?.eventId === "string" ? metadata.eventId : null;
}
