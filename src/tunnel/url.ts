const QUICK_TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

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

export function composeQuickPublicBaseUrl(tunnelUrl: string): string {
  const base = tunnelUrl.trim().replace(/\/$/, "");
  return `${base}/v1`;
}

export function parseQuickTunnelUrl(line: string): string | null {
  const match = line.match(QUICK_TUNNEL_URL_RE);
  return match ? match[0] : null;
}
