import { randomBytes } from "node:crypto";

export function generateProxyApiKey(): string {
  return `eport_${randomBytes(32).toString("base64url")}`;
}
