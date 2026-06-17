import { ConfigStore } from "../config/index.ts";
import type { SessionFlags } from "../config/types.ts";

export function runInit(store: ConfigStore, session: SessionFlags): number {
  const profile = store.ensureApiKey();
  store.save(profile);

  if (session.verbose) {
    console.log(`Created config directory: ${store.eportHome}`);
    console.log(`Wrote config: ${store.configPath}`);
  }

  return 0;
}

export function runApiKeyShow(store: ConfigStore): number {
  const profile = store.ensureApiKey();
  if (!profile.proxyApiKey) {
    console.error("No proxy API key found. Run: eport init");
    return 1;
  }
  console.log(profile.proxyApiKey);
  return 0;
}

export function runApiKeyRotate(store: ConfigStore): number {
  const profile = store.rotateApiKey();
  console.log(profile.proxyApiKey);
  console.log("");
  console.log("Proxy API key rotated. Old key is invalid immediately.");
  console.log("Update Cursor → Settings → Models → OpenAI → API key, then Verify.");
  console.log("(Full Base URL paste block ships in a later release.)");
  return 0;
}

export function runNotImplemented(command: string): number {
  console.error(`${command}: not implemented yet`);
  return 1;
}
