# Edge router

## Purpose

HTTP server facing the Cursor client on the public HTTPS endpoint: TLS terminates at the tunnel; validates proxy API key on public tunnels; routes by path and resolved model to Codex or Claude upstream.

## Will contain

`EdgeRouter` and ingress handlers for `GET /health`, `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/responses`; API key gate; concurrency cap before Codex dispatch; protocol-shape detection for Claude dual ingress.

## Blocked by / ISSUES slice

Codex local route in [04 — Codex edge route (local `--tunnel none`)](../../docs/ISSUES/04-codex-edge-route-local-up.md); Claude dual routing in [06](../../docs/ISSUES/06-claude-auth-translator-dual-routing.md); dynamic catalog in [07](../../docs/ISSUES/07-dynamic-models-catalog.md).

## Notes

`GET /health` bypasses upstream BYOK validation so Cursor Verify succeeds without provider API keys.
