## Parent
docs/prd/eport-v1.md

## What to build
Extend auth manager with Claude hybrid auth (Claude Code credential reuse when fresh, else `eport auth login claude`). Implement Claude translator: accept both `POST /v1/chat/completions` and `POST /v1/responses` edge shapes, normalize internally, call Anthropic Messages API, stream back in the same OpenAI shape the client used. Map effort to Anthropic-native parameters; never emit Codex `xhigh` upstream. Edge router dual-routes by model resolver provider. Invalid Claude-only suffixes rejected at resolver (already in slice 02) surface as clear HTTP errors.

## Acceptance criteria
- [ ] Claude hybrid auth: reuse fresh Claude Code credentials; OAuth fallback via `eport auth login claude`
- [ ] `eport auth login` authenticates all missing/stale providers (Codex + Claude); provider-specific login flags work
- [ ] `eport auth status` shows both providers independently (source, expiry, refresh need)
- [ ] Claude models route to Anthropic Messages API; Codex models unchanged
- [ ] Both edge protocols ingested on Claude routes; response stream matches client ingress shape (chat chunks vs response events)
- [ ] Model alias normalization on Claude routes (e.g. `opus-4.8max` → official upstream id + max effort)
- [ ] No fast mode on Claude routes (`-fast` suffix and global fast ignored)
- [ ] P0 Claude translator tests: Chat + Responses ingress → Anthropic request; stream back to both edge shapes; effort never emits `xhigh`
- [ ] P1 edge router tests: dual routing by model dispatches Codex vs Claude handlers

## Blocked by
- ISSUES/04-codex-edge-route-local-up.md
