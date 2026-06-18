import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  join as platformJoin,
  posix,
  win32,
} from "node:path";

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
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

export function appendUniqueJsonLine(
  path: string,
  value: unknown,
  identity: string,
  readIdentity: (value: unknown) => string | null,
): boolean {
  const rows = readJsonLines(path);
  if (rows.some((row) => readIdentity(row) === identity)) return false;
  writeJsonLinesAtomic(path, [...rows, value]);
  return true;
}

export function upsertJsonLine(
  path: string,
  value: unknown,
  identity: string,
  readIdentity: (value: unknown) => string | null,
): boolean {
  const rows = readJsonLines(path);
  let replaced = false;
  const nextRows = rows.map((row) => {
    if (readIdentity(row) !== identity) return row;
    replaced = true;
    return value;
  });
  if (!replaced) nextRows.push(value);
  writeJsonLinesAtomic(path, nextRows);
  return !replaced;
}

function writeJsonLinesAtomic(path: string, values: unknown[]): void {
  const body = values.map((value) => JSON.stringify(value)).join("\n");
  writeTextAtomic(path, values.length > 0 ? `${body}\n` : "");
}

export function writeJsonFileAtomic(path: string, value: unknown): void {
  writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function reportingDay(recordedAt: string): string {
  return recordedAt.slice(0, 10);
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
  const api = pathApiFor(path);
  const dir = api.dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = api.join(
    dir,
    `.${api.basename(path)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  writeFileSync(tmp, value, "utf8");
  renameSync(tmp, path);
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
