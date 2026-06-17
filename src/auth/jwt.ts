export function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const padded = payload + "==".slice(0, (4 - (payload.length % 4)) % 4);
    const json = Buffer.from(
      padded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function jwtExpiryMs(jwt: string): number | null {
  const claims = decodeJwtClaims(jwt);
  if (!claims) return null;
  const exp = claims.exp;
  if (typeof exp !== "number") return null;
  return exp * 1000;
}

export function extractAccountId(jwt: string | undefined): string | null {
  if (!jwt) return null;
  const claims = decodeJwtClaims(jwt);
  if (!claims) return null;
  const auth = claims["https://api.openai.com/auth"] as
    | Record<string, unknown>
    | undefined;
  const id = auth?.chatgpt_account_id;
  return typeof id === "string" ? id : null;
}
