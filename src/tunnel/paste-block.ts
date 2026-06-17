import type { TunnelMode } from "../config/types.ts";

export const SUGGESTED_CURSOR_MODELS = [
  "gpt-5.5",
  "gpt-5.5xhigh-fast",
  "opus-4.8max",
] as const;

export function formatCursorPasteBlock(options: {
  baseUrl: string;
  proxyApiKey: string;
  tunnelMode: TunnelMode;
}): string {
  const lines = [
    "────────────────────────────────────────",
    "Cursor setup — paste into Settings → Models → OpenAI",
    "",
    `Base URL:  ${options.baseUrl}`,
    `API Key:   ${options.proxyApiKey}`,
    "",
    "Suggested custom models:",
    ...SUGGESTED_CURSOR_MODELS.map((model) => `  ${model}`),
    "",
    'Enable "Override OpenAI Base URL", paste Base URL (must end with /v1),',
    "enter API key, click Verify.",
  ];

  if (options.tunnelMode === "quick") {
    lines.push(
      "",
      "Warning: quick tunnel URLs change on every restart. Update Cursor",
      "Base URL whenever you restart eport up.",
    );
  } else if (options.tunnelMode === "ngrok") {
    lines.push(
      "",
      "ngrok mode uses your saved static domain, so this Base URL should",
      "stay the same across eport restarts.",
    );
  }

  lines.push("────────────────────────────────────────");
  return lines.join("\n");
}

export function printCursorPasteBlock(options: {
  baseUrl: string;
  proxyApiKey: string;
  tunnelMode: TunnelMode;
}): void {
  console.log("");
  console.log(formatCursorPasteBlock(options));
  console.log("");
}
