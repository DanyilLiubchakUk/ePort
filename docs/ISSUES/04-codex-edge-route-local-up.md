## Parent
docs/prd/eport-v1.md

## What to build
Codex-only edge router on local HTTP (`eport up --tunnel none`): `GET /health` BYOK bypass, proxy API key gate (optional for none mode), `POST /v1/chat/completions` and `POST /v1/responses` routed through model resolver to Codex upstream client. Codex upstream: subscription Responses API with session continuity (`session_id` aligned with `prompt_cache_key`), encrypted reasoning passthrough, effort → `reasoning.effort`, fast tier → `service_tier: priority`, concurrency cap before upstream dispatch, sanitize required fields, SSE passthrough when shape matches. Default: `Authorization: Bearer $(eport api-key show)` curl examples work for `/v1/models` stub or health. No Cloudflare tunnel yet — local port only.

## Acceptance criteria
- [ ] `eport up --tunnel none` starts local HTTP server; prints listen URL (no public paste block yet)
- [ ] `GET /health` returns success without upstream OpenAI validation (Cursor Verify path)
- [ ] Proxy API key required on requests when configured; skippable/optional for `--tunnel none` per PRD
- [ ] Codex models (e.g. `gpt-5.5`, suffixed variants) route to Codex subscription Responses API (mocked upstream in tests)
- [ ] Chat Completions and Responses edge shapes both handled; prefer Responses-native passthrough when wire format matches
- [ ] Session continuity: `session_id` header aligned with body `prompt_cache_key`
- [ ] `reasoning.encrypted_content` forwarded unchanged through stream
- [ ] Concurrency cap queues excess simultaneous Codex upstream requests
- [ ] P1 edge router tests: route by model, API key gate, `/health`, protocol dispatch
- [ ] P1 Codex upstream tests: session alignment, encrypted reasoning passthrough, sanitize required fields
- [ ] One-line structured request log per request; verbose gated via global flag

## Blocked by
- ISSUES/01-cli-skeleton-config-init-api-key.md
- ISSUES/02-model-resolver-unit-tests.md
- ISSUES/03-codex-hybrid-auth-login-status.md
