import type { ConfigProfile, SessionFlags } from "../config/types.ts";
import { normalizeAlias, isKnownBareModel } from "./aliases.ts";
import { extractBodyEffort, extractBodyFastTier } from "./body.ts";
import { parseFullModelSuffix, parseRemainderSuffix } from "./suffix.ts";
import {
  ModelRoutingError,
  type ResolvedRoute,
} from "./types.ts";

export interface ResolveOptions {
  session?: SessionFlags;
}

function resolveEffort(
  body: unknown,
  suffixEffort: string | null,
  aliasEffort: string | null | undefined,
  bareModelId: string,
  config: ConfigProfile,
): string | null {
  const bodyEffort = extractBodyEffort(body);
  if (bodyEffort) {
    return bodyEffort;
  }

  if (suffixEffort) {
    return suffixEffort;
  }

  if (aliasEffort) {
    return aliasEffort;
  }

  const modelDefault = config.modelDefaults[bareModelId]?.effort;
  if (modelDefault) {
    return modelDefault;
  }

  return config.globalDefaultEffort ?? null;
}

function resolveFastTier(
  provider: ResolvedRoute["provider"],
  body: unknown,
  suffixFast: boolean,
  bareModelId: string,
  config: ConfigProfile,
  session?: SessionFlags,
): boolean {
  if (provider !== "codex") {
    return false;
  }

  const bodyFast = extractBodyFastTier(body);
  if (bodyFast === true) {
    return true;
  }
  if (bodyFast === false) {
    return false;
  }

  if (suffixFast) {
    return true;
  }

  if (config.modelDefaults[bareModelId]?.fast) {
    return true;
  }

  if (config.globalFastOverride) {
    return true;
  }

  if (session?.fast) {
    return true;
  }

  return false;
}

export function resolveModel(
  model: string,
  body: unknown,
  config: ConfigProfile,
  options: ResolveOptions = {},
): ResolvedRoute {
  const clientModel = model.trim();
  if (!clientModel) {
    throw new ModelRoutingError(
      "unknown_model",
      "Model id is required",
      model,
      "Add a custom model from GET /v1/models",
    );
  }

  const alias = normalizeAlias(clientModel);
  let provider: ResolvedRoute["provider"];
  let bareModelId: string;
  let canonicalModelId: string;
  let suffixEffort: string | null = null;
  let suffixFast = false;
  let aliasEffort: string | null | undefined;

  if (alias) {
    provider = alias.provider;
    bareModelId = alias.bareModelId;
    canonicalModelId = alias.canonicalModelId;
    aliasEffort = alias.aliasEffort;

    if (alias.remainder) {
      const remainder = parseRemainderSuffix(alias.remainder, provider, clientModel);
      suffixEffort = remainder.effort;
      suffixFast = remainder.fastTier;
    }
  } else {
    const parsed = parseFullModelSuffix(clientModel);
    provider = parsed.provider;
    bareModelId = parsed.bareModelId;
    canonicalModelId = parsed.canonicalModelId;
    suffixEffort = parsed.effort;
    suffixFast = parsed.fastTier;
  }

  if (!isKnownBareModel(provider, bareModelId)) {
    throw new ModelRoutingError(
      "unknown_model",
      `Unknown model: ${clientModel}`,
      clientModel,
      "Add a custom model from GET /v1/models",
    );
  }

  const effort = resolveEffort(
    body,
    suffixEffort,
    aliasEffort,
    bareModelId,
    config,
  );
  const fastTier = resolveFastTier(
    provider,
    body,
    suffixFast,
    bareModelId,
    config,
    options.session,
  );

  return {
    provider,
    canonicalModelId,
    bareModelId,
    effort,
    fastTier,
  };
}

export class ModelResolver {
  resolve(
    model: string,
    body: unknown,
    config: ConfigProfile,
    options: ResolveOptions = {},
  ): ResolvedRoute {
    return resolveModel(model, body, config, options);
  }
}
