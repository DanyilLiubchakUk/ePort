import type { ConfigProfile } from "./types.ts";

export function formatFlagEquivalent(profile: ConfigProfile): string {
  const parts: string[] = [];

  for (const bareModelId of Object.keys(profile.modelDefaults).sort()) {
    const defaults = profile.modelDefaults[bareModelId];
    if (!defaults?.effort) {
      continue;
    }

    let cmd = `eport config model ${bareModelId} --effort ${defaults.effort}`;
    if (defaults.fast) {
      cmd += " --fast";
    }
    parts.push(cmd);
  }

  parts.push(`eport config --fast ${profile.globalFastOverride ? "on" : "off"}`);

  if (profile.tunnelMode !== "named") {
    parts.push(`eport config --tunnel ${profile.tunnelMode}`);
  }

  return parts.join(" && ");
}

export function printFlagEquivalent(profile: ConfigProfile): void {
  console.log("");
  console.log("Flag equivalent:");
  console.log(`  ${formatFlagEquivalent(profile)}`);
}
