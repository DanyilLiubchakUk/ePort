# Config store

## Purpose

Persist and load the **config profile** at `~/.eport/config`: proxy API key, per-model default effort, global fast override, tunnel mode and named-tunnel credentials, and related metadata.

## Will contain

`ConfigStore` interface (`load`, `save`, `getModelDefault`); API key generation; session vs persisted override rules; flag one-liner and wizard write paths that produce equivalent profiles.

## Blocked by / ISSUES slice

[01 — CLI skeleton, config store, init, api-key](../../docs/ISSUES/01-cli-skeleton-config-init-api-key.md); interactive wizard in [09 — config wizard + flag equivalents](../../docs/ISSUES/09-config-wizard-flag-equivalents.md).

## Notes

Account queue metadata may live here or in an adjacent store if separation keeps auth concerns isolated.
