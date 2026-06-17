## Parent
docs/prd/eport-v1.md

## What to build
Implement the model resolver as a standalone module wired to the config store: alias normalization (longest-match table stub with representative Cursor-facing names), Codex and Claude suffix grammar parsing, effort precedence (body → suffix → per-model default → global default), and Codex-only fast mode stack (body `service_tier` → `-fast` suffix → per-model config → global/session fast override). Reject invalid Claude tokens (`xhigh`, `-fast`). Emit `ResolvedRoute` with provider, canonical upstream id, effort, fast tier, and bare model name for downstream routing. No HTTP server yet — resolver is callable from tests and future edge router.

## Acceptance criteria
- [ ] Alias normalize maps representative Cursor names (e.g. `claude-4.6-opus-high`, `cc/claude-opus-4-6`, `opus-4.8`) to provider + bare upstream id
- [ ] Codex suffix `[bare-model-id][effort-token][-fast]` parses correctly (e.g. `gpt-5.5xhigh-fast`)
- [ ] Claude suffix `[bare-model-id][effort-token]` only; rejects `opus-4.8xhigh` and `opus-4.8xhigh-fast` with clear errors
- [ ] Effort precedence: body effort beats suffix beats per-model config default beats global default (table-driven cases)
- [ ] Fast mode stack applies on Codex routes only; Claude routes ignore fast suffix and global fast override
- [ ] P0 table-driven unit tests cover alias, suffix, effort precedence, fast stack, and invalid Claude token rejection
- [ ] Unknown model after alias resolve surfaces actionable routing error shape for later edge router use

## Blocked by
- ISSUES/01-cli-skeleton-config-init-api-key.md
