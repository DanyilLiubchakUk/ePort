import {
  appendUniqueJsonLine,
  findJsonLine,
  forEachJsonLine,
  joinHomePath,
  normalizeRecordedAt,
  readJsonFile,
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

export interface CodexDailyUsageTotals {
  inputTokens: number;
  rawInputTokens: number;
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
  reportingTimeZone?: string;
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

export interface CodexDailyUsageSnapshot extends CodexDailyUsageTotals {
  dataIdentity: string;
  provider: "codex";
  providerAccountFingerprint: string;
  providerAccountIdentity?: CodexProviderAccountIdentity;
  date: string;
  costUSD: null;
  costSource: "unknown";
  updatedAt: string;
  models: Array<CodexDailyUsageTotals & { bareModelId: string }>;
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

  writeProviderAccountIdentity(input.home, input.providerAccountFingerprint, input.providerAccountIdentity);
  let canonicalEvent = findRawEvent(
    input.home,
    input.providerAccountFingerprint,
    event.id,
    recordedAt,
    input.reportingTimeZone,
  );
  let storedNewEvent = false;
  if (!canonicalEvent) {
    const shardedRawEventsPath = getCodexEportRawEventsPath(
      input.home,
      input.providerAccountFingerprint,
      recordedAt,
      input.reportingTimeZone,
    );
    storedNewEvent = appendUniqueJsonLine(shardedRawEventsPath, event, event.id, readEventId);
    canonicalEvent = storedNewEvent
      ? event
      : findRawEvent(
          input.home,
          input.providerAccountFingerprint,
          event.id,
          recordedAt,
          input.reportingTimeZone,
        ) ?? event;
  }
  upsertJsonLine(
    getCodexEportSessionFilePath(
      input.home,
      input.providerAccountFingerprint,
      canonicalEvent.recordedAt,
      input.reportingTimeZone,
    ),
    toCodexSessionRow(canonicalEvent),
    canonicalEvent.id,
    readCodexSessionEventId,
  );
  writeDailySnapshot(
    input.home,
    input.providerAccountFingerprint,
    canonicalEvent,
    storedNewEvent,
    input.reportingTimeZone,
  );

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
  recordedAt?: string,
  reportingTimeZone?: string,
): string {
  const partitionPath = getCodexEportAccountPartitionPath(home, providerAccountFingerprint);
  if (recordedAt) {
    return joinHomePath(
      partitionPath,
      "eport",
      "raw-events",
      `${reportingDay(recordedAt, reportingTimeZone)}.jsonl`,
    );
  }
  return joinHomePath(
    partitionPath,
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
  reportingTimeZone?: string,
): string {
  const day = reportingDay(recordedAt, reportingTimeZone);
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
  storedNewEvent: boolean,
  reportingTimeZone?: string,
): void {
  const day = reportingDay(event.recordedAt, reportingTimeZone);
  const path = getCodexEportDailySnapshotPath(home, providerAccountFingerprint, day);
  const existing = readDailySnapshot(path, providerAccountFingerprint, day);
  if (!storedNewEvent && existing) return;

  const snapshot =
    storedNewEvent && existing
      ? addEventToDailySnapshot(existing, event)
      : buildDailySnapshotFromRawEvents(
          home,
          providerAccountFingerprint,
          day,
          event.recordedAt,
          event.providerAccountIdentity,
          reportingTimeZone,
        );
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

function buildDailySnapshotFromRawEvents(
  home: string,
  providerAccountFingerprint: string,
  day: string,
  updatedAt: string,
  fallbackIdentity?: CodexProviderAccountIdentity,
  reportingTimeZone?: string,
): CodexDailyUsageSnapshot {
  const totals = emptyDailyTotals();
  const modelTotals = new Map<string, CodexDailyUsageTotals>();
  let providerAccountIdentity = fallbackIdentity;

  forEachRawEventForDay(home, providerAccountFingerprint, day, reportingTimeZone, (event) => {
    providerAccountIdentity = providerAccountIdentity ?? event.providerAccountIdentity;
    addUsageToDailyTotals(totals, event.normalizedUsage);
    const model = modelTotals.get(event.bareModelId) ?? emptyDailyTotals();
    addUsageToDailyTotals(model, event.normalizedUsage);
    modelTotals.set(event.bareModelId, model);
  });

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

function addEventToDailySnapshot(
  snapshot: CodexDailyUsageSnapshot,
  event: CodexCalculatedUsageRawEvent,
): CodexDailyUsageSnapshot {
  const models = snapshot.models.map((model) => ({ ...model }));
  let model = models.find((entry) => entry.bareModelId === event.bareModelId);
  if (!model) {
    model = { bareModelId: event.bareModelId, ...emptyDailyTotals() };
    models.push(model);
  }
  addUsageToDailyTotals(model, event.normalizedUsage);

  const totals = {
    inputTokens: snapshot.inputTokens,
    rawInputTokens: snapshot.rawInputTokens,
    cachedInputTokens: snapshot.cachedInputTokens,
    outputTokens: snapshot.outputTokens,
    reasoningOutputTokens: snapshot.reasoningOutputTokens,
    totalTokens: snapshot.totalTokens,
  };
  addUsageToDailyTotals(totals, event.normalizedUsage);

  return {
    ...snapshot,
    ...(snapshot.providerAccountIdentity || !event.providerAccountIdentity
      ? {}
      : { providerAccountIdentity: event.providerAccountIdentity }),
    ...totals,
    costUSD: null,
    costSource: "unknown",
    updatedAt: event.recordedAt,
    models,
  };
}

function readDailySnapshot(
  path: string,
  providerAccountFingerprint: string,
  day: string,
): CodexDailyUsageSnapshot | null {
  const record = readRecord(readJsonFile(path));
  if (!record || record.provider !== "codex") return null;
  if (record.providerAccountFingerprint !== providerAccountFingerprint) return null;
  if (record.date !== day) return null;

  const models = Array.isArray(record.models)
    ? record.models.flatMap((model) => {
        const item = readRecord(model);
        if (!item || typeof item.bareModelId !== "string") return [];
        const cachedInputTokens = readToken(item.cachedInputTokens) ?? 0;
        const rawInputTokens = readToken(item.rawInputTokens);
        const storedInputTokens = readToken(item.inputTokens) ?? 0;
        return [{
          bareModelId: item.bareModelId,
          inputTokens:
            rawInputTokens === null
              ? nonCachedInputTokens(storedInputTokens, cachedInputTokens)
              : storedInputTokens,
          rawInputTokens: rawInputTokens ?? storedInputTokens,
          cachedInputTokens,
          outputTokens: readToken(item.outputTokens) ?? 0,
          reasoningOutputTokens: readToken(item.reasoningOutputTokens) ?? 0,
          totalTokens: readToken(item.totalTokens) ?? 0,
        }];
      })
    : [];

  const providerAccountIdentity = readRecord(record.providerAccountIdentity) as
    | CodexProviderAccountIdentity
    | null;
  const cachedInputTokens = readToken(record.cachedInputTokens) ?? 0;
  const rawInputTokens = readToken(record.rawInputTokens);
  const storedInputTokens = readToken(record.inputTokens) ?? 0;
  return {
    dataIdentity:
      typeof record.dataIdentity === "string"
        ? record.dataIdentity
        : `eport:codex:${providerAccountFingerprint}:daily:${day}`,
    provider: "codex",
    providerAccountFingerprint,
    ...(providerAccountIdentity ? { providerAccountIdentity } : {}),
    date: day,
    inputTokens:
      rawInputTokens === null
        ? nonCachedInputTokens(storedInputTokens, cachedInputTokens)
        : storedInputTokens,
    rawInputTokens: rawInputTokens ?? storedInputTokens,
    cachedInputTokens,
    outputTokens: readToken(record.outputTokens) ?? 0,
    reasoningOutputTokens: readToken(record.reasoningOutputTokens) ?? 0,
    totalTokens: readToken(record.totalTokens) ?? 0,
    costUSD: null,
    costSource: "unknown",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : day,
    models,
  };
}

function findRawEvent(
  home: string,
  providerAccountFingerprint: string,
  eventId: string,
  recordedAt: string,
  reportingTimeZone?: string,
): CodexCalculatedUsageRawEvent | null {
  for (const path of getRawEventCandidatePaths(
    home,
    providerAccountFingerprint,
    recordedAt,
    reportingTimeZone,
  )) {
    const found = readCodexRawEvent(
      findJsonLine(path, (value) => readEventId(value) === eventId),
    );
    if (found) return found;
  }
  return null;
}

function forEachRawEventForDay(
  home: string,
  providerAccountFingerprint: string,
  day: string,
  reportingTimeZone: string | undefined,
  onEvent: (event: CodexCalculatedUsageRawEvent) => void,
): void {
  for (const path of getRawEventCandidatePaths(
    home,
    providerAccountFingerprint,
    day,
    reportingTimeZone,
  )) {
    forEachJsonLine(path, (value) => {
      const event = readCodexRawEvent(value);
      if (!event) return;
      if (event.providerAccountFingerprint !== providerAccountFingerprint) return;
      if (reportingDay(event.recordedAt, reportingTimeZone) !== day) return;
      onEvent(event);
    });
  }
}

function getRawEventCandidatePaths(
  home: string,
  providerAccountFingerprint: string,
  recordedAt: string,
  reportingTimeZone?: string,
): string[] {
  return [
    getCodexEportRawEventsPath(home, providerAccountFingerprint, recordedAt, reportingTimeZone),
    getCodexEportRawEventsPath(home, providerAccountFingerprint),
  ];
}

function readCodexRawEvent(value: unknown): CodexCalculatedUsageRawEvent | null {
  const parsed = readRecord(value) as CodexCalculatedUsageRawEvent | null;
  if (!parsed || parsed.provider !== "codex") return null;
  if (typeof parsed.id !== "string") return null;
  return parsed;
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

function emptyDailyTotals(): CodexDailyUsageTotals {
  return {
    inputTokens: 0,
    rawInputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function addUsageToDailyTotals(target: CodexDailyUsageTotals, next: CodexUsageTotals): void {
  target.inputTokens += nonCachedInputTokens(next.inputTokens, next.cachedInputTokens);
  target.rawInputTokens += next.inputTokens;
  target.cachedInputTokens += next.cachedInputTokens;
  target.outputTokens += next.outputTokens;
  target.reasoningOutputTokens += next.reasoningOutputTokens;
  target.totalTokens += next.totalTokens;
}

function nonCachedInputTokens(inputTokens: number, cachedInputTokens: number): number {
  return Math.max(0, inputTokens - cachedInputTokens);
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
