function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function extractBodyEffort(body: unknown): string | null {
  const record = readRecord(body);
  if (!record) {
    return null;
  }

  const reasoning = readRecord(record.reasoning);
  const reasoningEffort = reasoning ? readString(reasoning.effort) : null;
  if (reasoningEffort) {
    return reasoningEffort;
  }

  const topLevelEffort = readString(record.reasoning_effort);
  if (topLevelEffort) {
    return topLevelEffort;
  }

  const reasoningField = readString(record.reasoning);
  if (reasoningField) {
    return reasoningField;
  }

  const thinking = readRecord(record.thinking);
  if (thinking) {
    const thinkingType = readString(thinking.type);
    if (thinkingType) {
      return thinkingType;
    }
  }

  return null;
}

export function extractBodyFastTier(body: unknown): boolean | null {
  const record = readRecord(body);
  if (!record) {
    return null;
  }

  const serviceTier = readString(record.service_tier);
  if (!serviceTier) {
    return null;
  }

  if (serviceTier === "priority" || serviceTier === "fast") {
    return true;
  }

  return false;
}
