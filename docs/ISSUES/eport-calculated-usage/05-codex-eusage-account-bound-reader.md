## Parent

docs/prd/eport-calculated-usage.md

## What to build

Teach the Codex eUsage plugin path to discover Codex ePort account partitions, query each partition separately, and emit account-bound child outputs. Native Codex CLI usage remains available as normal provider-level Codex data, while each ePort partition becomes a Provider Account-specific output with its own token lines and usage data identity.

## Acceptance criteria

- [x] Codex eUsage discovery finds multiple Codex ePort account partitions under the native Codex home
- [x] The Codex plugin queries ccusage once per discovered ePort account partition
- [x] Each Codex ePort partition emits one account-bound child output with exactly one Provider Account detection
- [x] Codex account-bound source facts include stable usage data identity per Provider Account and reporting day
- [x] Native Codex CLI usage continues to load without being attributed to any ePort queue account
- [x] A fixture with two Codex ePort partitions produces two different Codex account-bound token totals
- [x] Ambiguous or unreadable Codex partitions surface as fallback or explicit error state instead of merged totals
- [x] Codex plugin tests cover empty partitions, one partition, multiple partitions, and native-only usage

## Verification notes

- OpenUsage Codex plugin now discovers `eport-accounts/<providerAccountFingerprint>` directories under the native Codex home and queries each partition with `ccusage` using that partition as `CODEX_HOME`.
- Native Codex CLI usage remains provider-level, while each discovered ePort partition emits a `providerAccountOutputs` child with one high-confidence Codex Provider Account detection.
- Account-bound Codex source facts use `eport:codex:<providerAccountFingerprint>:daily:<YYYY-MM-DD>` as stable `dataIdentity`.
- Codex plugin fixtures cover native-only usage, empty ePort partitions, one partition, multiple partitions with distinct totals, `CODEX_HOME` discovery, and unreadable partitions surfaced as account-bound status output.

## Blocked by

- 01-lock-account-bound-eusage-contract.md
- 02-codex-calculated-usage-tracer.md
- 04-account-ownership-dedupe-and-partition-safety.md
