const QUICK_TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const NGROK_URL_RE = /https:\/\/[a-z0-9.-]+\.ngrok(?:-free)?\.(?:app|dev)/i;

export function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
}

export function composeNamedPublicBaseUrl(hostname: string): string {
  const host = normalizeHostname(hostname);
  if (!host) {
    throw new Error("hostname is required for named tunnel");
  }
  return `https://${host}/v1`;
}

export function normalizeNgrokUrl(url: string): string {
  const host = normalizeHostname(url);
  if (!host) {
    return "";
  }
  return `https://${host}`;
}

export function composeNgrokPublicBaseUrl(url: string): string {
  const base = normalizeNgrokUrl(url);
  if (!base) {
    throw new Error("ngrok URL is required");
  }
  return `${base}/v1`;
}

export function composeQuickPublicBaseUrl(tunnelUrl: string): string {
  const base = tunnelUrl.trim().replace(/\/$/, "");
  return `${base}/v1`;
}

export function parseQuickTunnelUrl(line: string): string | null {
  const match = line.match(QUICK_TUNNEL_URL_RE);
  return match ? match[0] : null;
}

export function parseNgrokTunnelUrl(line: string): string | null {
  const match = line.match(NGROK_URL_RE);
  return match ? match[0] : null;
}
