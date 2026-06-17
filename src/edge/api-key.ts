import type { TunnelMode } from "../config/types.ts";

export function isProxyApiKeyRequired(
  tunnelMode: TunnelMode,
  proxyApiKey: string | undefined,
): boolean {
  if (tunnelMode === "none") {
    return false;
  }
  return Boolean(proxyApiKey);
}

export function authorizeProxyRequest(
  req: Request,
  proxyApiKey: string | undefined,
  tunnelMode: TunnelMode,
): boolean {
  if (!isProxyApiKeyRequired(tunnelMode, proxyApiKey)) {
    return true;
  }

  if (!proxyApiKey) {
    return false;
  }

  const header = req.headers.get("authorization");
  if (!header) {
    return false;
  }

  const [scheme, value] = header.split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && value === proxyApiKey;
}

export function unauthorizedResponse(): Response {
  return withCors(
    Response.json(
      {
        error: {
          message: "missing or invalid proxy API key",
          type: "authentication_error",
          code: null,
        },
      },
      { status: 401 },
    ),
  );
}

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-headers", "*");
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  return new Response(response.body, { status: response.status, headers });
}
