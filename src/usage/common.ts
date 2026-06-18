import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import {
  basename,
  dirname,
  join as platformJoin,
  posix,
  win32,
} from "node:path";
import { StringDecoder } from "node:string_decoder";

export type CalculatedUsageProvider = "codex" | "claude";

export function providerAccountFingerprintFor(
  provider: CalculatedUsageProvider,
  identityValue: string,
): string {
  const identity = identityValue.trim() || "unknown";
  const digest = createHash("sha256")
    .update(["eport-provider-account-fingerprint:v1", provider, identity].join("\0"))
    .digest("hex");
  return `fp_${digest}`;
}

export function fallbackProviderAccountFingerprintFor(
  provider: CalculatedUsageProvider,
): string {
  return providerAccountFingerprintFor(provider, `eport:${provider}:fallback-account`);
}

export function joinHomePath(home: string, ...segments: string[]): string {
  return pathApiFor(home).join(home, ...segments);
}

export function readJsonLines(path: string): unknown[] {
  const rows: unknown[] = [];
  forEachJsonLine(path, (value) => {
    rows.push(value);
  });
  return rows;
}

export function readJsonFile(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export function forEachJsonLine(
  path: string,
  onValue: (value: unknown) => boolean | void,
): void {
  if (!existsSync(path)) return;

  const fd = openSync(path, "r");
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let pending = "";
  let keepReading = true;

  const emitLine = (line: string): void => {
    if (!keepReading) return;
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const result = onValue(JSON.parse(trimmed) as unknown);
      if (result === false) keepReading = false;
    } catch {
      // Corrupt JSONL rows are ignored so one bad row cannot block usage writes.
    }
  };

  try {
    while (keepReading) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      pending += decoder.write(buffer.subarray(0, bytesRead));

      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex !== -1) {
        let line = pending.slice(0, newlineIndex);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        emitLine(line);
        pending = pending.slice(newlineIndex + 1);
        if (!keepReading) break;
        newlineIndex = pending.indexOf("\n");
      }
    }

    pending += decoder.end();
    if (keepReading && pending.length > 0) emitLine(pending);
  } finally {
    closeSync(fd);
  }
}

export function findJsonLine(
  path: string,
  predicate: (value: unknown) => boolean,
): unknown | null {
  let found = false;
  let result: unknown = null;
  forEachJsonLine(path, (value) => {
    if (!predicate(value)) return;
    found = true;
    result = value;
    return false;
  });
  return found ? result : null;
}

export function appendUniqueJsonLine(
  path: string,
  value: unknown,
  identity: string,
  readIdentity: (value: unknown) => string | null,
): boolean {
  if (findJsonLine(path, (row) => readIdentity(row) === identity)) return false;
  appendJsonLine(path, value);
  return true;
}

export function upsertJsonLine(
  path: string,
  value: unknown,
  identity: string,
  readIdentity: (value: unknown) => string | null,
): boolean {
  let replaced = false;
  rewriteJsonLinesAtomic(path, (row) => {
    if (readIdentity(row) !== identity) return row;
    replaced = true;
    return value;
  }, () => {
    if (!replaced) return value;
    return null;
  });
  return !replaced;
}

function appendJsonLine(path: string, value: unknown): void {
  const api = pathApiFor(path);
  mkdirSync(api.dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

function rewriteJsonLinesAtomic(
  path: string,
  mapValue: (value: unknown) => unknown | null,
  finalValue: () => unknown | null,
): void {
  const api = pathApiFor(path);
  const dir = api.dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = atomicTempPath(path);
  const fd = openSync(tmp, "w");
  let closed = false;

  const closeTmp = (): void => {
    if (closed) return;
    closeSync(fd);
    closed = true;
  };

  try {
    forEachJsonLine(path, (row) => {
      const next = mapValue(row);
      if (next !== null) writeSync(fd, `${JSON.stringify(next)}\n`);
    });
    const final = finalValue();
    if (final !== null) writeSync(fd, `${JSON.stringify(final)}\n`);
    closeTmp();
    renameSync(tmp, path);
  } catch (error) {
    closeTmp();
    try {
      unlinkSync(tmp);
    } catch {
      // Best effort cleanup; the original file is still intact.
    }
    throw error;
  }
}

export function writeJsonFileAtomic(path: string, value: unknown): void {
  writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

const reportingDayFormatters = new Map<string, Intl.DateTimeFormat>();

export function reportingDay(recordedAt: string, timeZone?: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(recordedAt)) {
    return recordedAt;
  }

  const parsed = Date.parse(recordedAt);
  if (!Number.isFinite(parsed)) {
    return recordedAt.slice(0, 10);
  }

  try {
    const formatter = getReportingDayFormatter(timeZone ?? localReportingTimeZone());
    const parts = formatter.formatToParts(new Date(parsed));
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // Fall back to the previous UTC behavior if Intl rejects a timezone.
  }

  return new Date(parsed).toISOString().slice(0, 10);
}

function localReportingTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function getReportingDayFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = reportingDayFormatters.get(timeZone);
  if (existing) return existing;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  reportingDayFormatters.set(timeZone, formatter);
  return formatter;
}

export function normalizeRecordedAt(value: string | number | null | undefined): string {
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

export function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function readToken(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

export function safePathSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "unknown";
}

function writeTextAtomic(path: string, value: string): void {
  const tmp = atomicTempPath(path);
  writeFileSync(tmp, value, "utf8");
  renameSync(tmp, path);
}

function atomicTempPath(path: string): string {
  const api = pathApiFor(path);
  const dir = api.dirname(path);
  mkdirSync(dir, { recursive: true });
  return api.join(
    dir,
    `.${api.basename(path)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
}

function pathApiFor(value: string): Pick<typeof win32, "basename" | "dirname" | "join"> {
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\")) {
    return win32;
  }
  if (value.startsWith("/")) {
    return posix;
  }
  return {
    basename,
    dirname,
    join: platformJoin,
  };
}
