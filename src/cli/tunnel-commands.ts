import { ConfigStore } from "../config/index.ts";
import { composeNamedPublicBaseUrl, normalizeHostname } from "../tunnel/index.ts";
import { promptChoice, promptLine } from "./prompt.ts";

const CLOUDFLARE_GUIDANCE = `Cloudflare tunnel features are free on the Zero Trust free tier.
A custom domain may cost money (registrar + optional Cloudflare plan).
For ad-hoc testing without a domain, use quick mode instead.`;

export async function runTunnelSetupNamed(
  store: ConfigStore,
  options: { token?: string; hostname?: string },
): Promise<number> {
  try {
    let token = options.token?.trim();
    let hostname = options.hostname?.trim();

    if (!token) {
      console.log("");
      console.log("Named tunnel token (from Cloudflare Zero Trust → Networks → Tunnels).");
      token = await promptLine("Tunnel token (eyJ…): ");
    }

    if (!hostname) {
      console.log("");
      console.log("Public hostname Cursor will call (e.g. eport.example.com).");
      hostname = await promptLine("Hostname: ");
    }

    if (!token) {
      console.error("Tunnel token is required.");
      return 1;
    }

    const normalizedHost = normalizeHostname(hostname ?? "");
    if (!normalizedHost) {
      console.error("Hostname is required.");
      return 1;
    }

    store.save({
      tunnelMode: "named",
      tunnel: { token, hostname: normalizedHost },
    });

    const publicBaseUrl = composeNamedPublicBaseUrl(normalizedHost);
    console.log("");
    console.log("Saved named tunnel config.");
    console.log(`  hostname: ${normalizedHost}`);
    console.log(`  public Base URL: ${publicBaseUrl}`);
    console.log("");
    console.log(CLOUDFLARE_GUIDANCE);
    console.log("");
    console.log("Next: eport up");
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function runTunnelSetupQuick(store: ConfigStore): Promise<number> {
  store.save({ tunnelMode: "quick" });
  console.log("");
  console.log("Default tunnel mode set to quick.");
  console.log("");
  console.log("Warning: each eport up run gets a random *.trycloudflare.com URL");
  console.log("that changes on restart. Update Cursor Base URL whenever it changes.");
  console.log("");
  console.log("For a stable URL: eport tunnel setup named");
  console.log("Next: eport up --tunnel quick");
  return 0;
}

export async function runTunnelSetupInteractive(
  store: ConfigStore,
  preset?: string,
): Promise<number> {
  try {
    let mode = preset?.trim().toLowerCase();
    if (!mode) {
      console.log("");
      console.log("Choose tunnel mode:");
      console.log("  named — stable hostname (recommended for Cursor)");
      console.log("  quick — random *.trycloudflare.com URL per run");
      mode = await promptChoice("Tunnel mode", ["named", "quick"]);
    }

    if (mode === "named") {
      return runTunnelSetupNamed(store, {});
    }
    if (mode === "quick") {
      return runTunnelSetupQuick(store);
    }

    console.error(`unknown tunnel setup mode: ${mode}`);
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function runTunnel(
  store: ConfigStore,
  subcommand: string | undefined,
  rest: string[],
  options: { token?: string; hostname?: string },
): Promise<number> {
  if (subcommand !== "setup") {
    console.error("usage: eport tunnel setup [named|quick]");
    return 1;
  }

  const preset = rest[0];
  if (preset === "named") {
    return runTunnelSetupNamed(store, options);
  }
  if (preset === "quick") {
    return runTunnelSetupQuick(store);
  }
  if (preset && preset !== "named" && preset !== "quick") {
    console.error(`unknown tunnel setup mode: ${preset}`);
    return 1;
  }

  return runTunnelSetupInteractive(store, preset);
}
