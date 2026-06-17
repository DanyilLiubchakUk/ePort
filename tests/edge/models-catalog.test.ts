import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { AuthManager } from "../../src/auth/manager.ts";
import { ANTHROPIC_MODELS_URL } from "../../src/claude/models.ts";
import { CODEX_MODELS_BASE_URL } from "../../src/codex/models.ts";
import { emptyConfigProfile } from "../../src/config/types.ts";
import { startEdgeServer } from "../../src/edge/index.ts";
import { ModelCatalog, ModelResolver } from "../../src/resolver/index.ts";
import {
  makeClaudeAuthFile,
  makeCodexAuthFile,
  msFromNow,
  secondsFromNow,
  writeEportAuth,
  writeEportClaudeAuth,
} from "../auth/helpers.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GET /v1/models dynamic catalog", () => {
  let home: string;
  let server: ReturnType<typeof startEdgeServer> | undefined;

  afterEach(() => {
    server?.stop();
    server = undefined;
    if (home) rmSync(home, { recursive: true, force: true });
  });

  function startCatalogServer(options: {
    tunnelMode?: "none" | "named";
    proxyApiKey?: string;
    codexModels?: Array<{ slug: string }>;
    claudeModels?: Array<{ id: string }>;
    catalogTtlMs?: number;
  } = {}) {
    home = mkdtempSync(`${tmpdir()}/eport-models-`);
    writeEportAuth(home, makeCodexAuthFile(secondsFromNow(3600)));
    writeEportClaudeAuth(home, makeClaudeAuthFile(msFromNow(3_600_000)));

    const auth = new AuthManager(home);
    const catalog = new ModelCatalog({
      home,
      auth,
      ttlMs: options.catalogTtlMs ?? 60_000,
      fetchCodex: async (url) => {
        if (String(url).startsWith(`${CODEX_MODELS_BASE_URL}/codex/models`)) {
          return jsonResponse({
            models: options.codexModels ?? [
              { slug: "gpt-5.5" },
              { slug: "gpt-5.4" },
            ],
          });
        }
        return jsonResponse({ models: [] }, 404);
      },
      fetchClaude: async (url) => {
        if (url === ANTHROPIC_MODELS_URL) {
          return jsonResponse({
            data: options.claudeModels ?? [
              { id: "claude-opus-4-8" },
              { id: "claude-sonnet-4-6" },
            ],
          });
        }
        return jsonResponse({ data: [] }, 404);
      },
    });

    const profile = {
      ...emptyConfigProfile(),
      proxyApiKey: options.proxyApiKey ?? "eport_test_key",
    };

    server = startEdgeServer({
      home,
      port: 0,
      config: profile,
      session: {},
      tunnelMode: options.tunnelMode ?? "none",
      proxyApiKey: profile.proxyApiKey,
      auth,
      catalog,
      resolver: new ModelResolver(catalog),
    });

    return { baseUrl: `http://${server.host}:${server.port}` };
  }

  it("returns merged OpenAI-shaped catalog from mocked upstream providers", async () => {
    const { baseUrl } = startCatalogServer();
    const response = await fetch(`${baseUrl}/v1/models`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      object: string;
      data: Array<{ id: string; object: string; owned_by: string }>;
    };

    expect(body.object).toBe("list");
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((entry) => entry.object === "model")).toBe(true);

    const ids = body.data.map((entry) => entry.id);
    expect(ids).toContain("gpt-5.5");
    expect(ids).toContain("gpt-5.5xhigh");
    expect(ids).toContain("gpt-5.5xhigh-fast");
    expect(ids).toContain("opus-4.8");
    expect(ids).toContain("opus-4.8max");
    expect(ids).toContain("claude-sonnet-4-6");

    const codexEntry = body.data.find((entry) => entry.id === "gpt-5.5");
    const claudeEntry = body.data.find((entry) => entry.id === "opus-4.8");
    expect(codexEntry?.owned_by).toBe("codex");
    expect(claudeEntry?.owned_by).toBe("anthropic");
  });

  it("requires proxy API key for public tunnel modes", async () => {
    const { baseUrl } = startCatalogServer({ tunnelMode: "named" });
    const denied = await fetch(`${baseUrl}/v1/models`);
    expect(denied.status).toBe(401);

    const allowed = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: "Bearer eport_test_key" },
    });
    expect(allowed.status).toBe(200);
  });

  it("serves stale cached catalog when refresh fails", async () => {
    const { baseUrl } = startCatalogServer({ catalogTtlMs: 1 });
    const first = await fetch(`${baseUrl}/v1/models`);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { data: Array<{ id: string }> };
    expect(firstBody.data.some((entry) => entry.id === "gpt-5.5")).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 5));

    const auth = new AuthManager(home);
    const failingCatalog = new ModelCatalog({
      home,
      auth,
      ttlMs: 1,
      fetchCodex: async () => jsonResponse({ models: [] }, 500),
      fetchClaude: async () => jsonResponse({ data: [] }, 500),
    });
    server?.stop();
    server = startEdgeServer({
      home,
      port: 0,
      config: { ...emptyConfigProfile(), proxyApiKey: "eport_test_key" },
      session: {},
      tunnelMode: "none",
      proxyApiKey: "eport_test_key",
      auth,
      catalog: failingCatalog,
      resolver: new ModelResolver(failingCatalog),
    });

    const second = await fetch(`http://${server.host}:${server.port}/v1/models`);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { data: Array<{ id: string }> };
    expect(secondBody.data.some((entry) => entry.id === "gpt-5.5")).toBe(true);
  });
});
