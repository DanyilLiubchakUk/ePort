import type { Provider } from "./types.ts";

export interface OpenAIModelEntry {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface OpenAIModelList {
  object: "list";
  data: OpenAIModelEntry[];
}

export interface CatalogBareModel {
  provider: Provider;
  bareModelId: string;
  canonicalModelId: string;
}

export interface CatalogProviderSnapshot {
  provider: Provider;
  modelCount: number;
  fetchedAt: number | null;
  error?: string;
}

export interface CatalogStatus {
  fetchedAt: number | null;
  stale: boolean;
  totalModels: number;
  providers: CatalogProviderSnapshot[];
  warning?: string;
}

export interface CatalogCacheFile {
  fetchedAt: number;
  bareModels: CatalogBareModel[];
  providers: CatalogProviderSnapshot[];
}
