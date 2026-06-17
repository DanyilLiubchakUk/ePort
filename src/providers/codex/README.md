# Codex upstream client

## Purpose

Authenticated HTTP to the Codex subscription Responses API: direct HTTPS on the hot path, no subprocess per request.

## Will contain

`CodexUpstream` client; `session_id` / `prompt_cache_key` alignment; encrypted reasoning passthrough; effort and `service_tier` mapping; payload sanitize; SSE passthrough or translation to client edge shape; multimodal part translation; 429/401 retry delegation to auth manager.

## Blocked by / ISSUES slice

Auth wiring in [03 — Codex hybrid auth + login/status](../../docs/ISSUES/03-codex-hybrid-auth-login-status.md); first end-to-end route in [04 — Codex edge route](../../docs/ISSUES/04-codex-edge-route-local-up.md); multimodal in [11](../../docs/ISSUES/11-multimodal-status-cli-help-polish.md).

## Notes

One long-lived keep-alive HTTP client per upstream host; coalesced token refresh before dispatch.
