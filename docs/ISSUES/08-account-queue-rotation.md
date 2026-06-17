## Parent
docs/prd/eport-v1.md

## What to build
Multi-account queue for Codex and Claude: `eport accounts add|list|switch|reorder|status` per provider. Ordered account lists with active pointer persisted in config-adjacent store. Automatic rotation on upstream 429 (promote next, exhausted to back, retry once) and 401 (coalesced refresh first, rotate on failure, retry once). Manual switch/reorder updates active account for subsequent requests only. 5xx errors do not trigger rotation. `eport status` shows active accounts per provider when proxy running.

## Acceptance criteria
- [ ] `eport accounts add codex|claude` runs OAuth and appends to provider queue
- [ ] `eport accounts list` shows queue order and labels, active marker per provider
- [ ] `eport accounts switch codex 2` and `eport accounts reorder codex 2 1 3` update active/ order immediately
- [ ] `eport accounts status` shows active account, queue length, rotation policy; verbose shows last rotation reason
- [ ] 429 → rotate to next account, move exhausted to back, single retry
- [ ] 401 → refresh current account (coalesced); rotate only if refresh fails; single retry
- [ ] 5xx upstream errors surface without account rotation
- [ ] Auth manager P1 tests: 429 rotate order; 401 refresh-then-rotate; manual switch; coalesced refresh single-flight
- [ ] `eport status` includes active Codex and Claude accounts when proxy is running

## Blocked by
- ISSUES/03-codex-hybrid-auth-login-status.md
