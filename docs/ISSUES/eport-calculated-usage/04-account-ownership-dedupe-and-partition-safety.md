## Parent

docs/prd/eport-calculated-usage.md

## What to build

Harden calculated usage ownership across multiple accounts and repeated refreshes. The account queue entry that served a proxied request owns the raw event and Daily usage snapshot, even when the queue rotates because of 429 handling. Unknown account ownership is preserved under a provider-specific fallback account. Recalculation and interrupted writes are safe: raw events dedupe by event id, Daily usage snapshots replace the same usage data identity, and path construction works on macOS and Windows.

## Acceptance criteria

- [ ] A simulated two-account Codex day produces separate Codex Daily usage snapshots for each Provider Account fingerprint
- [ ] A simulated two-account Claude day produces separate Claude Daily usage snapshots for each Provider Account fingerprint
- [ ] Account rotation after a 429 assigns usage to the account that actually served each request
- [ ] Manual account switching assigns usage to the newly active account only for subsequent requests
- [ ] Unknown account usage is retained under a provider-specific fallback account and is visible to later readers
- [ ] Raw event replay does not double count already recorded completed responses
- [ ] Daily snapshot writes replace the same usage data identity instead of appending duplicate totals
- [ ] Storage writes are atomic enough that a reader never sees half-written JSONL
- [ ] Account partition paths are built through cross-platform path helpers and pass macOS and Windows path tests
- [ ] Native Codex CLI and Claude Code usage trees remain outside ePort account ownership tests

## Blocked by

- 02-codex-calculated-usage-tracer.md
- 03-claude-calculated-usage-tracer.md
