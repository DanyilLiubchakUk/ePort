## Parent
docs/prd/cursor-agent-parity.md

## What to build
**Agent observability** and optional **session hardening**: extend structured one-line request logs with turn outcome (`stop` vs `tool_calls`) and edge shape (`chat` vs `responses`); in `--verbose`, log unhandled upstream SSE event types instead of silently dropping. Confirm client `prompt_cache_key` always wins over installation id on Codex (regression test). Optional: lightweight session resume when Cursor omits explicit keys — only if slice 11–13 integration tests prove key loss; otherwise document deferral.

## Acceptance criteria
- [ ] One-line log includes `finish=` or equivalent for tool vs stop outcomes on inference routes
- [ ] `--verbose` logs unhandled SSE event type names when translator returns null for an event
- [ ] P1 test: upstream request uses client `prompt_cache_key` as `session_id` when provided
- [ ] README troubleshooting mentions Agent “stops after one message” and points to slices 11–13 + verbose logging
- [ ] Session fingerprint resume implemented only if accompanied by failing test fixture; otherwise noted as deferred in slice doc commit message

## Blocked by
- ISSUES/11-codex-agent-tool-streams.md
- ISSUES/13-claude-agent-tool-loop.md
