## Parent

docs/prd/eport-calculated-usage.md

## What to build

Harden calculated usage ownership across multiple accounts and repeated refreshes. The account queue entry that served a proxied request owns the raw event and Daily usage snapshot, even when the queue rotates because of 429 handling. Unknown account ownership is preserved under a provider-specific fallback account. Recalculation and interrupted writes are safe: raw events dedupe by event id, Daily usage snapshots replace the same usage data identity, and path construction works on macOS and Windows.

## Acceptance criteria

- [x] A simulated two-account Codex day produces separate Codex Daily usage snapshots for each Provider Account fingerprint
- [x] A simulated two-account Claude day produces separate Claude Daily usage snapshots for each Provider Account fingerprint
- [x] Account rotation after a 429 assigns usage to the account that actually served each request
- [x] Manual account switching assigns usage to the newly active account only for subsequent requests
- [x] Unknown account usage is retained under a provider-specific fallback account and is visible to later readers
- [x] Raw event replay does not double count already recorded completed responses
- [x] Daily snapshot writes replace the same usage data identity instead of appending duplicate totals
- [x] Storage writes are atomic enough that a reader never sees half-written JSONL
- [x] Account partition paths are built through cross-platform path helpers and pass macOS and Windows path tests
- [x] Native Codex CLI and Claude Code usage trees remain outside ePort account ownership tests

## Verification notes

- Shared calculated-usage storage helpers now use provider fallback fingerprints, deduped raw-event JSONL, idempotent ccusage row upserts, atomic temp-file replacement, and path helpers that cover macOS and Windows home shapes.
- Codex and Claude writers rebuild session/project rows from the canonical stored raw event, so replayed response ids do not double count or overwrite the first completed-response totals.
- Router coverage proves 429 retry usage is owned by the account that served the successful retry, and manual account switching only affects subsequent requests.
- Usage tests prove two-account Codex/Claude days, provider fallback accounts, replay dedupe, atomic JSONL replacement behavior, path construction, and native tree separation.

## Blocked by

- 02-codex-calculated-usage-tracer.md
- 03-claude-calculated-usage-tracer.md
