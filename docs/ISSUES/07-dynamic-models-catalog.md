## Parent
docs/prd/eport-v1.md

## What to build
Implement `GET /v1/models` on the edge router: aggregate models from all logged-in Codex and Anthropic accounts (active credentials), merge/tag by provider, optionally include suffixed ids for picker convenience. TTL cache with refresh on auth login, account switch (when slice 08 lands), and periodic poll; stale catalog degrades gracefully with warning surfaced in `eport status`. Wire model resolver alias table to catalog data where applicable. curl with `Authorization: Bearer $(eport api-key show)` returns OpenAI-shaped model list.

## Acceptance criteria
- [ ] `GET /v1/models` returns dynamic catalog reflecting accessible subscription models from logged-in accounts
- [ ] Models tagged/merged by provider; optional suffixed ids included for Cursor custom model picker
- [ ] Catalog TTL cache refreshes on auth login; stale state reported via status when applicable
- [ ] Unknown model routing errors point users to catalog for correct custom model ids
- [ ] API key gate consistent with other edge routes on public tunnels
- [ ] Integration test with mocked upstream catalog responses returns expected OpenAI model list shape
- [ ] `eport status` shows catalog age and model count per provider when stale (minimal stub ok until slice 17 polish)

## Blocked by
- ISSUES/03-codex-hybrid-auth-login-status.md
- ISSUES/06-claude-auth-translator-dual-routing.md
