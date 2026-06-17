import { ConfigStore } from "../config/index.ts";
import type { SessionFlags } from "../config/types.ts";
import { AuthManager, formatAuthStatus } from "../auth/index.ts";
import type { Provider } from "../auth/index.ts";

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

function parseAuthProvider(value: string | undefined): Provider | undefined {
  if (!value) return undefined;
  if (value === "codex" || value === "claude") return value;
  throw new Error(`unknown auth provider: ${value}`);
}

export async function runAuthLogin(
  home: string,
  providerArg: string | undefined,
  session: SessionFlags,
): Promise<number> {
  try {
    const provider = parseAuthProvider(providerArg);
    const auth = new AuthManager(home);
    await auth.login(provider);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function runAuthStatus(
  home: string,
  options: { json?: boolean; verbose?: boolean },
): number {
  const auth = new AuthManager(home);
  const summary = auth.status();
  process.stdout.write(formatAuthStatus(summary, options));
  return 0;
}
