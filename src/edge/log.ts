export interface RequestLogSummary {
  method: string;
  path: string;
  edgeShape?: string;
  model: string;
  effort: string | null;
  fast: boolean;
  provider: string;
  finish?: string;
  status: number;
  latencyMs: number;
  error?: string;
}

export function formatRequestLogLine(summary: RequestLogSummary): string {
  const parts = [
    summary.method,
    summary.path,
    summary.edgeShape ? `edge=${summary.edgeShape}` : null,
    `model=${summary.model}`,
    `effort=${summary.effort ?? "-"}`,
    `fast=${summary.fast ? "1" : "0"}`,
    `provider=${summary.provider}`,
    summary.finish ? `finish=${summary.finish}` : null,
    `status=${summary.status}`,
    `latency_ms=${summary.latencyMs}`,
  ].filter((part): part is string => part !== null);
  if (summary.error) {
    parts.push(`error=${JSON.stringify(summary.error)}`);
  }
  return parts.join(" ");
}

export function logRequestSummary(
  summary: RequestLogSummary,
  verbose: boolean,
  verboseDetail?: string,
): void {
  console.log(formatRequestLogLine(summary));
  if (verbose && verboseDetail) {
    console.log(verboseDetail);
  }
}
