# Codex upstream client

## Purpose

Authenticated HTTP to the Codex subscription Responses API: direct HTTPS on the hot path, no subprocess per request.

## Will contain

`CodexUpstream` client; `session_id` / `prompt_cache_key` alignment; encrypted reasoning passthrough; effort and `service_tier` mapping; payload sanitize; SSE passthrough or translation to client edge shape; multimodal part translation; 429/401 retry delegation to auth manager.

## Blocked by / ISSUES slice

Auth wiring in [03 — Codex hybrid auth + login/status](../../docs/ISSUES/03-codex-hybrid-auth-login-status.md); first end-to-end route in [04 — Codex edge route](../../docs/ISSUES/04-codex-edge-route-local-up.md); Agent tools in [11](../../docs/ISSUES/11-codex-agent-tool-streams.md); multimodal images in [15](../../docs/ISSUES/15-multimodal-images-both-providers.md); polish in [17](../../docs/ISSUES/17-multimodal-status-cli-help-polish.md).

## Notes

One long-lived keep-alive HTTP client per upstream host; coalesced token refresh before dispatch.
