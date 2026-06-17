import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AuthManager } from "../../src/auth/manager.ts";
import { CODEX_MODELS_BASE_URL } from "../../src/codex/models.ts";
import {
  clearCatalogBareModels,
  isKnownBareModel,
  registerCatalogBareModels,
} from "../../src/resolver/aliases.ts";
import {
  DEFAULT_CATALOG_TTL_MS,
  ModelCatalog,
  loadCatalogStatusFromDisk,
} from "../../src/resolver/catalog.ts";
import {
  makeCodexAuthFile,
  secondsFromNow,
  writeEportAuth,
} from "../auth/helpers.ts";

describe("ModelCatalog", () => {
  it("registers bare models for resolver validation", async () => {
    clearCatalogBareModels();
    const home = mkdtempSync(`${tmpdir()}/eport-catalog-`);
    try {
      writeEportAuth(home, makeCodexAuthFile(secondsFromNow(3600)));
      const auth = new AuthManager(home);
      const catalog = new ModelCatalog({
        home,
        auth,
        fetchCodex: async () =>
          new Response(JSON.stringify({ models: [{ slug: "catalog-only-model" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        fetchClaude: async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
      });

      await catalog.refresh();
      expect(isKnownBareModel("codex", "catalog-only-model")).toBe(true);
      expect(isKnownBareModel("codex", "totally-unknown-model")).toBe(false);
    } finally {
      clearCatalogBareModels();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("invalidates and refreshes after auth login hook", async () => {
    const home = mkdtempSync(`${tmpdir()}/eport-catalog-login-`);
    try {
      writeEportAuth(home, makeCodexAuthFile(secondsFromNow(3600)));
      const auth = new AuthManager(home);
      let fetchCount = 0;
      const catalog = new ModelCatalog({
        home,
        auth,
        fetchCodex: async (url) => {
          fetchCount += 1;
          if (String(url).startsWith(`${CODEX_MODELS_BASE_URL}/codex/models`)) {
            return new Response(
              JSON.stringify({ models: [{ slug: fetchCount === 1 ? "gpt-5.5" : "gpt-5.6" }] }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(JSON.stringify({ models: [] }), { status: 404 });
        },
        fetchClaude: async () =>
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });
      auth.setCatalog(catalog);

      await catalog.refresh();
      expect((await catalog.listModels()).data.some((entry) => entry.id === "gpt-5.5")).toBe(true);

      catalog.invalidate();
      await catalog.refresh();
      expect((await catalog.listModels()).data.some((entry) => entry.id === "gpt-5.6")).toBe(true);
      expect(fetchCount).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("reports stale catalog status from disk cache", () => {
    const home = mkdtempSync(`${tmpdir()}/eport-catalog-status-`);
    try {
      const cacheDir = join(home, ".eport");
      mkdirSync(cacheDir, { recursive: true });
      const staleAt = Date.now() - DEFAULT_CATALOG_TTL_MS - 1_000;
      writeFileSync(
        join(cacheDir, "catalog-cache.json"),
        `${JSON.stringify({
          fetchedAt: staleAt,
          bareModels: [{ provider: "codex", bareModelId: "gpt-5.5", canonicalModelId: "gpt-5.5" }],
          providers: [{ provider: "codex", modelCount: 1, fetchedAt: staleAt }],
        })}\n`,
      );

      const status = loadCatalogStatusFromDisk(home);
      expect(status.stale).toBe(true);
      expect(status.totalModels).toBe(1);
      expect(status.providers[0]?.provider).toBe("codex");
      expect(status.providers[0]?.modelCount).toBe(1);
      expect(status.warning).toContain("stale");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("clears catalog registration helper", () => {
    registerCatalogBareModels([{ provider: "codex", bareModelId: "catalog-only-model" }]);
    expect(isKnownBareModel("codex", "catalog-only-model")).toBe(true);
    clearCatalogBareModels();
    expect(isKnownBareModel("codex", "catalog-only-model")).toBe(false);
  });
});
