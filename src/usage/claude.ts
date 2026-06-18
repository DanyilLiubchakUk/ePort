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

export { fallbackProviderAccountFingerprintFor } from "./common.ts";

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

  let canonicalEvent = findRawEvent(
    input.home,
    input.providerAccountFingerprint,
    event.id,
    recordedAt,
  );
  let storedNewEvent = false;
  if (!canonicalEvent) {
    const shardedRawEventsPath = getClaudeEportRawEventsPath(
      input.home,
      input.providerAccountFingerprint,
      recordedAt,
    );
    storedNewEvent = appendUniqueJsonLine(shardedRawEventsPath, event, event.id, readEventId);
    canonicalEvent = storedNewEvent
      ? event
      : findRawEvent(input.home, input.providerAccountFingerprint, event.id, recordedAt) ?? event;
  }
  upsertJsonLine(
    getClaudeEportSessionFilePath(
      input.home,
      input.providerAccountFingerprint,
      canonicalEvent.recordedAt,
    ),
    toClaudeSessionRow(canonicalEvent),
    canonicalEvent.id,
    readClaudeSessionEventId,
  );
  writeDailySnapshot(input.home, input.providerAccountFingerprint, canonicalEvent, storedNewEvent);

  return canonicalEvent;
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
  return joinHomePath(
    home,
    ".claude",
    "eport-accounts",
    safePathSegment(providerAccountFingerprint),
  );
}

export function getClaudeEportRawEventsPath(
  home: string,
  providerAccountFingerprint: string,
  recordedAt?: string,
): string {
  const partitionPath = getClaudeEportAccountPartitionPath(home, providerAccountFingerprint);
  if (recordedAt) {
    return joinHomePath(
      partitionPath,
      "eport",
      "raw-events",
      `${reportingDay(recordedAt)}.jsonl`,
    );
  }
  return joinHomePath(
    partitionPath,
    "eport",
    "raw-events.jsonl",
  );
}

export function getClaudeEportDailySnapshotPath(
  home: string,
  providerAccountFingerprint: string,
  day: string,
): string {
  return joinHomePath(
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
  return joinHomePath(
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
  return joinHomePath(getClaudeEportProjectPath(home, providerAccountFingerprint), `${day}.jsonl`);
}

function writeDailySnapshot(
  home: string,
  providerAccountFingerprint: string,
  event: ClaudeCalculatedUsageRawEvent,
  storedNewEvent: boolean,
): void {
  const day = reportingDay(event.recordedAt);
  const path = getClaudeEportDailySnapshotPath(home, providerAccountFingerprint, day);
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
        );
  writeJsonFileAtomic(path, snapshot);
}

function buildDailySnapshotFromRawEvents(
  home: string,
  providerAccountFingerprint: string,
  day: string,
  updatedAt: string,
): ClaudeDailyUsageSnapshot {
  const totals = emptyTotals();
  const modelTotals = new Map<string, ClaudeUsageTotals>();

  forEachRawEventForDay(home, providerAccountFingerprint, day, (event) => {
    addTotals(totals, event.normalizedUsage);
    const model = modelTotals.get(event.bareModelId) ?? emptyTotals();
    addTotals(model, event.normalizedUsage);
    modelTotals.set(event.bareModelId, model);
  });

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

function addEventToDailySnapshot(
  snapshot: ClaudeDailyUsageSnapshot,
  event: ClaudeCalculatedUsageRawEvent,
): ClaudeDailyUsageSnapshot {
  const models = snapshot.models.map((model) => ({
    ...model,
    serverToolUse: { ...model.serverToolUse },
  }));
  let model = models.find((entry) => entry.bareModelId === event.bareModelId);
  if (!model) {
    model = { bareModelId: event.bareModelId, ...emptyTotals() };
    models.push(model);
  }
  addTotals(model, event.normalizedUsage);

  const serverToolUse = { ...snapshot.serverToolUse };
  for (const [key, value] of Object.entries(event.normalizedUsage.serverToolUse)) {
    serverToolUse[key] = (serverToolUse[key] ?? 0) + value;
  }

  return {
    ...snapshot,
    inputTokens: snapshot.inputTokens + event.normalizedUsage.inputTokens,
    cacheCreationInputTokens:
      snapshot.cacheCreationInputTokens + event.normalizedUsage.cacheCreationInputTokens,
    cacheReadInputTokens:
      snapshot.cacheReadInputTokens + event.normalizedUsage.cacheReadInputTokens,
    outputTokens: snapshot.outputTokens + event.normalizedUsage.outputTokens,
    totalTokens: snapshot.totalTokens + event.normalizedUsage.totalTokens,
    serverToolUse,
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
): ClaudeDailyUsageSnapshot | null {
  const record = readRecord(readJsonFile(path));
  if (!record || record.provider !== "claude") return null;
  if (record.providerAccountFingerprint !== providerAccountFingerprint) return null;
  if (record.date !== day) return null;

  const models = Array.isArray(record.models)
    ? record.models.flatMap((model) => {
        const item = readRecord(model);
        if (!item || typeof item.bareModelId !== "string") return [];
        return [{
          bareModelId: item.bareModelId,
          inputTokens: readToken(item.inputTokens) ?? 0,
          cacheCreationInputTokens: readToken(item.cacheCreationInputTokens) ?? 0,
          cacheReadInputTokens: readToken(item.cacheReadInputTokens) ?? 0,
          outputTokens: readToken(item.outputTokens) ?? 0,
          totalTokens: readToken(item.totalTokens) ?? 0,
          serverToolUse: readTokenMap(readRecord(item.serverToolUse)),
        }];
      })
    : [];

  return {
    dataIdentity:
      typeof record.dataIdentity === "string"
        ? record.dataIdentity
        : `eport:claude:${providerAccountFingerprint}:daily:${day}`,
    provider: "claude",
    providerAccountFingerprint,
    date: day,
    inputTokens: readToken(record.inputTokens) ?? 0,
    cacheCreationInputTokens: readToken(record.cacheCreationInputTokens) ?? 0,
    cacheReadInputTokens: readToken(record.cacheReadInputTokens) ?? 0,
    outputTokens: readToken(record.outputTokens) ?? 0,
    totalTokens: readToken(record.totalTokens) ?? 0,
    serverToolUse: readTokenMap(readRecord(record.serverToolUse)),
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
): ClaudeCalculatedUsageRawEvent | null {
  for (const path of getRawEventCandidatePaths(home, providerAccountFingerprint, recordedAt)) {
    const found = readClaudeRawEvent(
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
  onEvent: (event: ClaudeCalculatedUsageRawEvent) => void,
): void {
  for (const path of getRawEventCandidatePaths(home, providerAccountFingerprint, day)) {
    forEachJsonLine(path, (value) => {
      const event = readClaudeRawEvent(value);
      if (!event) return;
      if (event.providerAccountFingerprint !== providerAccountFingerprint) return;
      if (reportingDay(event.recordedAt) !== day) return;
      onEvent(event);
    });
  }
}

function getRawEventCandidatePaths(
  home: string,
  providerAccountFingerprint: string,
  recordedAt: string,
): string[] {
  return [
    getClaudeEportRawEventsPath(home, providerAccountFingerprint, recordedAt),
    getClaudeEportRawEventsPath(home, providerAccountFingerprint),
  ];
}

function readClaudeRawEvent(value: unknown): ClaudeCalculatedUsageRawEvent | null {
  const parsed = readRecord(value) as ClaudeCalculatedUsageRawEvent | null;
  if (!parsed || parsed.provider !== "claude") return null;
  if (typeof parsed.id !== "string") return null;
  return parsed;
}

function toClaudeCodeUsage(totals: ClaudeUsageTotals): Record<string, unknown> {
  return {
    input_tokens: totals.inputTokens,
    output_tokens: totals.outputTokens,
    cache_creation_input_tokens: totals.cacheCreationInputTokens,
    cache_read_input_tokens: totals.cacheReadInputTokens,
  };
}

function toClaudeSessionRow(event: ClaudeCalculatedUsageRawEvent): Record<string, unknown> {
  return {
    sessionId: "eport-cursor-proxy",
    timestamp: event.recordedAt,
    version: "1.0.0",
    requestId: event.id,
    message: {
      id: event.responseId ?? event.id,
      model: event.bareModelId,
      usage: toClaudeCodeUsage(event.normalizedUsage),
    },
    eport: {
      providerAccountFingerprint: event.providerAccountFingerprint,
      responseId: event.responseId,
      clientModel: event.clientModel,
      effort: event.effort,
      finish: event.finish,
    },
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

function readEventId(value: unknown): string | null {
  const record = readRecord(value);
  return typeof record?.id === "string" ? record.id : null;
}

function readClaudeSessionEventId(value: unknown): string | null {
  const record = readRecord(value);
  return typeof record?.requestId === "string" ? record.requestId : null;
}
