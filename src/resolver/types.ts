export type Provider = "codex" | "claude";

export interface ResolvedRoute {
  provider: Provider;
  canonicalModelId: string;
  bareModelId: string;
  effort: string | null;
  fastTier: boolean;
}

export type ModelRoutingErrorCode = "unknown_model" | "invalid_suffix";

export class ModelRoutingError extends Error {
  readonly code: ModelRoutingErrorCode;
  readonly model: string;
  readonly hint?: string;

  constructor(
    code: ModelRoutingErrorCode,
    message: string,
    model: string,
    hint?: string,
  ) {
    super(message);
    this.name = "ModelRoutingError";
    this.code = code;
    this.model = model;
    this.hint = hint;
  }
}
