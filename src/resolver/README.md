# Model resolver

## Purpose

Turn client model string, request body, and config profile into a `ResolvedRoute`: provider (`codex` | `claude`), canonical model id, effort, fast tier, and edge shape — single sanitize pass per request.

## Will contain

`ModelResolver` (`resolve`, `listModels`); alias normalize (longest-match table); suffix grammar parse; effort precedence (body over suffix over config); Codex-only fast stack; dynamic catalog aggregation with TTL cache.

## Blocked by / ISSUES slice

[02 — model resolver + unit tests](../../docs/ISSUES/02-model-resolver-unit-tests.md); catalog listing in [07 — dynamic GET /v1/models catalog](../../docs/ISSUES/07-dynamic-models-catalog.md).

## Notes

Reject Codex-only tokens (`xhigh`, `-fast`) on Claude routes; body effort always beats suffix.
