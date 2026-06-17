## Parent
docs/prd/eport-v1.md

## What to build
Implement auth manager for Codex only (single account): hybrid credential resolution reusing fresh `~/.codex/auth.json` when available (Windows + macOS paths), otherwise ePort OAuth via `eport auth login codex`. Background proactive token refresh with coalesced in-flight refresh (not blocking every request). CLI: `eport auth login` (all missing — Codex only until Claude slice), `eport auth login codex`, `eport auth status` showing source (CLI reuse vs ePort OAuth), expiry, and refresh need. Clear guidance on `refresh_token_expired` and post-`codex logout` recovery.

## Acceptance criteria
- [ ] Fresh Codex CLI credentials at `~/.codex/auth.json` are reused without redundant OAuth (macOS and Windows)
- [ ] Missing/stale Codex credentials trigger ePort OAuth on `eport auth login` / `eport auth login codex` (mock token exchange in tests)
- [ ] `eport auth status` reports Codex credential source, expiry, and whether refresh is needed
- [ ] Proactive background refresh runs with single-flight coalescing; hot path does not synchronously refresh every request
- [ ] Codex and Claude credential stores remain independent in design (Claude stub/unauthenticated until slice 06)
- [ ] Auth manager P1 tests: CLI reuse when fresh; OAuth fallback when stale; coalesced refresh single-flight
- [ ] CLI integration test: `eport auth status` after mocked login shows expected Codex row

## Blocked by
- ISSUES/01-cli-skeleton-config-init-api-key.md
