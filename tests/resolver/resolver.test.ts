import { describe, expect, it } from "bun:test";

import { emptyConfigProfile, type ConfigProfile } from "../../src/config/types.ts";
import { ModelRoutingError, resolveModel } from "../../src/resolver/index.ts";

function config(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return { ...emptyConfigProfile(), ...overrides };
}

describe("model resolver — alias normalize", () => {
  const cases = [
    {
      model: "claude-4.6-opus-high",
      provider: "claude",
      canonicalModelId: "claude-opus-4-6",
      bareModelId: "claude-opus-4-6",
      effort: "high",
    },
    {
      model: "cc/claude-opus-4-6",
      provider: "claude",
      canonicalModelId: "claude-opus-4-6",
      bareModelId: "claude-opus-4-6",
      effort: null,
    },
    {
      model: "opus-4.8",
      provider: "claude",
      canonicalModelId: "claude-opus-4-8",
      bareModelId: "opus-4.8",
      effort: null,
    },
  ] as const;

  for (const testCase of cases) {
    it(`maps ${testCase.model}`, () => {
      const route = resolveModel(testCase.model, {}, config());
      expect(route.provider).toBe(testCase.provider);
      expect(route.canonicalModelId).toBe(testCase.canonicalModelId);
      expect(route.bareModelId).toBe(testCase.bareModelId);
      expect(route.effort).toBe(testCase.effort);
      expect(route.fastTier).toBe(false);
    });
  }
});

describe("model resolver — suffix parse", () => {
  it("parses Codex suffix gpt-5.5xhigh-fast", () => {
    const route = resolveModel("gpt-5.5xhigh-fast", {}, config());
    expect(route.provider).toBe("codex");
    expect(route.bareModelId).toBe("gpt-5.5");
    expect(route.canonicalModelId).toBe("gpt-5.5");
    expect(route.effort).toBe("xhigh");
    expect(route.fastTier).toBe(true);
  });

  it("parses Claude suffix opus-4.8max", () => {
    const route = resolveModel("opus-4.8max", {}, config());
    expect(route.provider).toBe("claude");
    expect(route.bareModelId).toBe("opus-4.8");
    expect(route.canonicalModelId).toBe("claude-opus-4-8");
    expect(route.effort).toBe("max");
    expect(route.fastTier).toBe(false);
  });

  it("rejects opus-4.8xhigh", () => {
    expect(() => resolveModel("opus-4.8xhigh", {}, config())).toThrow(ModelRoutingError);
    try {
      resolveModel("opus-4.8xhigh", {}, config());
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRoutingError);
      const routingError = error as ModelRoutingError;
      expect(routingError.code).toBe("invalid_suffix");
      expect(routingError.message).toContain("xhigh");
    }
  });

  it("rejects opus-4.8xhigh-fast", () => {
    expect(() => resolveModel("opus-4.8xhigh-fast", {}, config())).toThrow(ModelRoutingError);
    try {
      resolveModel("opus-4.8xhigh-fast", {}, config());
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRoutingError);
      const routingError = error as ModelRoutingError;
      expect(routingError.code).toBe("invalid_suffix");
    }
  });
});

describe("model resolver — effort precedence", () => {
  const baseConfig = config({
    modelDefaults: {
      "gpt-5.5": { effort: "high" },
    },
    globalDefaultEffort: "low",
  });

  const cases = [
    {
      name: "suffix beats body",
      model: "gpt-5.5xhigh",
      body: { reasoning: { effort: "medium" } },
      expected: "xhigh",
    },
    {
      name: "suffix beats per-model default",
      model: "gpt-5.5xhigh",
      body: {},
      expected: "xhigh",
    },
    {
      name: "body used when suffix is absent",
      model: "gpt-5.5",
      body: { reasoning: { effort: "medium" } },
      expected: "medium",
    },
    {
      name: "per-model default beats global default",
      model: "gpt-5.5",
      body: {},
      expected: "high",
    },
    {
      name: "global default when nothing else set",
      model: "gpt-5.4",
      body: {},
      expected: "low",
    },
  ] as const;

  for (const testCase of cases) {
    it(testCase.name, () => {
      const route = resolveModel(testCase.model, testCase.body, baseConfig);
      expect(route.effort).toBe(testCase.expected);
    });
  }
});

describe("model resolver — fast mode stack", () => {
  const baseConfig = config({
    modelDefaults: {
      "gpt-5.5": { fast: true },
    },
    globalFastOverride: false,
  });

  const cases = [
    {
      name: "suffix -fast beats body service_tier",
      model: "gpt-5.5-high-fast",
      body: { service_tier: "auto" },
      session: undefined,
      config: config({ modelDefaults: { "gpt-5.5": { fast: true } } }),
      expected: true,
    },
    {
      name: "suffix -fast beats per-model config",
      model: "gpt-5.4-high-fast",
      body: {},
      session: undefined,
      config: config(),
      expected: true,
    },
    {
      name: "body service_tier used when suffix is absent",
      model: "gpt-5.5",
      body: { service_tier: "auto" },
      session: undefined,
      config: config({ modelDefaults: { "gpt-5.5": { fast: true } } }),
      expected: false,
    },
    {
      name: "per-model config fast",
      model: "gpt-5.5",
      body: {},
      session: undefined,
      config: baseConfig,
      expected: true,
    },
    {
      name: "global fast override",
      model: "gpt-5.4",
      body: {},
      session: undefined,
      config: config({ globalFastOverride: true }),
      expected: true,
    },
    {
      name: "session fast override",
      model: "gpt-5.4",
      body: {},
      session: { fast: true },
      config: config(),
      expected: true,
    },
    {
      name: "Claude ignores fast suffix and overrides",
      model: "opus-4.8max",
      body: { service_tier: "priority" },
      session: { fast: true },
      config: config({ globalFastOverride: true }),
      expected: false,
    },
  ] as const;

  for (const testCase of cases) {
    it(testCase.name, () => {
      const route = resolveModel(testCase.model, testCase.body, testCase.config, {
        session: testCase.session,
      });
      expect(route.fastTier).toBe(testCase.expected);
    });
  }
});

describe("model resolver — unknown model", () => {
  it("surfaces actionable routing error", () => {
    try {
      resolveModel("totally-unknown-model", {}, config());
      throw new Error("expected resolveModel to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRoutingError);
      const routingError = error as ModelRoutingError;
      expect(routingError.code).toBe("unknown_model");
      expect(routingError.model).toBe("totally-unknown-model");
      expect(routingError.hint).toContain("GET /v1/models");
    }
  });
});
