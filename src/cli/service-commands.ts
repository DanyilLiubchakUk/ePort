import { AuthManager, formatAuthStatus } from "../auth/index.ts";
import type { ConfigStore } from "../config/index.ts";
import { loadLiveProxyRuntimeState } from "../runtime/state.ts";
import {
  readLogTail,
  ServiceError,
  ServiceInstaller,
  type ServiceStatus,
} from "../service/index.ts";
import { composeNamedPublicBaseUrl } from "../tunnel/index.ts";

const QUICK_TUNNEL_WARNING =
  "Warning: default tunnel mode is quick. Quick tunnels get a new URL on every restart; " +
  "a background service will break Cursor's Base URL silently. " +
  "Use a named tunnel (eport tunnel setup named) before eport service install.";

export function runServiceInstall(
  store: ConfigStore,
  home: string,
  verbose: boolean,
): number {
  try {
    const profile = store.load();
    if (profile.tunnelMode === "quick") {
      console.warn(QUICK_TUNNEL_WARNING);
    }

    const service = new ServiceInstaller(store, { home });
    const result = service.install();

    console.log("ePort service installed.");
    if (verbose && result.registrationPath) {
      console.log(`  registration: ${result.registrationPath}`);
    }
    console.log(`  logs: ${result.logPath}`);
    if (result.startError) {
      console.warn(`Service registered but failed to start now: ${result.startError}`);
      console.log("It will start on next logon. Run: eport service start");
    }
    return 0;
  } catch (error) {
    return handleServiceError(error);
  }
}

export function runServiceUninstall(
  store: ConfigStore,
  home: string,
  verbose: boolean,
): number {
  try {
    const service = new ServiceInstaller(store, { home });
    service.uninstall();
    console.log("ePort service uninstalled (config and auth preserved).");
    if (verbose) {
      console.log(`  config: ${store.configPath}`);
    }
    return 0;
  } catch (error) {
    return handleServiceError(error);
  }
}

export function runServiceStart(store: ConfigStore, home: string, verbose: boolean): number {
  try {
    const service = new ServiceInstaller(store, { home });
    service.start();
    console.log("ePort service started.");
    if (verbose) {
      console.log(`  logs: ${service.logPath}`);
    }
    return 0;
  } catch (error) {
    return handleServiceError(error);
  }
}

export function runServiceStop(store: ConfigStore, home: string): number {
  try {
    const service = new ServiceInstaller(store, { home });
    service.stop();
    console.log("ePort service stopped.");
    return 0;
  } catch (error) {
    return handleServiceError(error);
  }
}

export function runServiceRestart(store: ConfigStore, home: string, verbose: boolean): number {
  try {
    const service = new ServiceInstaller(store, { home });
    service.restart();
    console.log("ePort service restarted.");
    if (verbose) {
      console.log(`  logs: ${service.logPath}`);
    }
    return 0;
  } catch (error) {
    return handleServiceError(error);
  }
}

export function runServiceStatus(
  store: ConfigStore,
  home: string,
  options: { json?: boolean; verbose?: boolean },
): number {
  const installer = new ServiceInstaller(store, { home });
  const osStatus = installer.status();
  const profile = store.load();
  const proxy = loadLiveProxyRuntimeState(home) ?? undefined;
  const auth = new AuthManager(home);

  const tunnelUrl =
    profile.tunnelMode === "named" && profile.tunnel.hostname
      ? composeNamedPublicBaseUrl(profile.tunnel.hostname)
      : undefined;

  const summary = {
    service: osStatus,
    tunnelMode: profile.tunnelMode,
    tunnelUrl,
    proxy,
    auth: auth.status(),
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }

  console.log(formatServiceStatus(osStatus, profile.tunnelMode, tunnelUrl, proxy?.port));
  console.log("");
  console.log("Auth");
  console.log(formatAuthStatus(summary.auth, options).trimEnd());

  if (options.verbose) {
    const tail = readLogTail(installer.logPath);
    console.log("");
    console.log(`Log tail (${installer.logPath})`);
    if (!tail.exists || tail.lines.length === 0) {
      console.log("  (no log output yet)");
    } else {
      for (const line of tail.lines) {
        console.log(`  ${line}`);
      }
    }
  }

  return 0;
}

function formatServiceStatus(
  status: ServiceStatus,
  tunnelMode: string,
  tunnelUrl: string | undefined,
  proxyPort: number | undefined,
): string {
  const lines: string[] = ["Service"];
  lines.push(`  platform:   ${status.platform}`);
  lines.push(`  installed:  ${status.installed ? "yes" : "no"}`);
  lines.push(`  running:    ${status.running ? "yes" : "no"}`);
  lines.push(`  tunnel:     ${tunnelMode}`);
  if (tunnelUrl) {
    lines.push(`  public URL: ${tunnelUrl}`);
  }
  if (proxyPort) {
    lines.push(`  local port: ${proxyPort}`);
  }
  lines.push(`  logs:       ${status.logPath}`);
  return lines.join("\n");
}

function handleServiceError(error: unknown): number {
  console.error(error instanceof ServiceError ? error.message : String(error));
  return 1;
}
