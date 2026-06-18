import { ConfigStore } from "../config/index.ts";
import {
  composeNamedPublicBaseUrl,
  composeNgrokPublicBaseUrl,
  normalizeHostname,
  normalizeNgrokUrl,
} from "../tunnel/index.ts";
import { promptChoice, promptLine } from "./prompt.ts";

const CLOUDFLARE_GUIDANCE = `Cloudflare tunnel features are free on the Zero Trust free tier.
A custom domain may cost money (registrar + optional Cloudflare plan).
For ad-hoc testing without a domain, use quick mode instead.`;

const NGROK_GUIDANCE = `ngrok free static domains require a free ngrok account.
Reserve a static domain in the ngrok dashboard, then save that URL here.
ePort stores the authtoken locally and passes it to ngrok at runtime.`;

export async function runTunnelSetupNgrok(
  store: ConfigStore,
  options: { token?: string; hostname?: string; url?: string },
): Promise<number> {
  try {
    let authtoken = options.token?.trim();
    let url = options.url?.trim() || options.hostname?.trim();

    if (!authtoken) {
      console.log("");
      console.log("ngrok authtoken (from ngrok dashboard → Your Authtoken).");
      authtoken = await promptLine("Authtoken: ");
    }

    if (!url) {
      console.log("");
      console.log("Static ngrok domain URL (e.g. https://your-name.ngrok-free.app).");
      url = await promptLine("ngrok URL: ");
    }

    if (!authtoken) {
      console.error("ngrok authtoken is required.");
      return 1;
    }

    const normalizedUrl = normalizeNgrokUrl(url ?? "");
    if (!normalizedUrl) {
      console.error("ngrok URL is required.");
      return 1;
    }

    store.save({
      tunnelMode: "ngrok",
      ngrok: { authtoken, url: normalizedUrl },
    });

    const publicBaseUrl = composeNgrokPublicBaseUrl(normalizedUrl);
    console.log("");
    console.log("Saved ngrok tunnel config.");
    console.log(`  url: ${normalizedUrl}`);
    console.log(`  public Base URL: ${publicBaseUrl}`);
    console.log("");
    console.log(NGROK_GUIDANCE);
    console.log("");
    console.log("Next: eport up");
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

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
      console.log("  ngrok — stable free ngrok static domain (default)");
      console.log("  named — stable hostname (recommended for Cursor)");
      console.log("  quick — random *.trycloudflare.com URL per run");
      mode = await promptChoice("Tunnel mode", ["ngrok", "named", "quick"]);
    }

    if (mode === "ngrok") {
      return runTunnelSetupNgrok(store, {});
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
  options: { token?: string; hostname?: string; url?: string },
): Promise<number> {
  if (subcommand !== "setup") {
    console.error("usage: eport tunnel setup [ngrok|named|quick]");
    return 1;
  }

  const preset = rest[0];
  if (preset === "ngrok") {
    return runTunnelSetupNgrok(store, options);
  }
  if (preset === "named") {
    return runTunnelSetupNamed(store, options);
  }
  if (preset === "quick") {
    return runTunnelSetupQuick(store);
  }
  if (preset && preset !== "ngrok" && preset !== "named" && preset !== "quick") {
    console.error(`unknown tunnel setup mode: ${preset}`);
    return 1;
  }

  return runTunnelSetupInteractive(store, preset);
}
