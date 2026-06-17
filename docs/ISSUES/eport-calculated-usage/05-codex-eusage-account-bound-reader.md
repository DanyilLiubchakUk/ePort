## Parent

docs/prd/eport-calculated-usage.md

## What to build

Teach the Codex eUsage plugin path to discover Codex ePort account partitions, query each partition separately, and emit account-bound child outputs. Native Codex CLI usage remains available as normal provider-level Codex data, while each ePort partition becomes a Provider Account-specific output with its own token lines and usage data identity.

## Acceptance criteria

- [ ] Codex eUsage discovery finds multiple Codex ePort account partitions under the native Codex home
- [ ] The Codex plugin queries ccusage once per discovered ePort account partition
- [ ] Each Codex ePort partition emits one account-bound child output with exactly one Provider Account detection
- [ ] Codex account-bound source facts include stable usage data identity per Provider Account and reporting day
- [ ] Native Codex CLI usage continues to load without being attributed to any ePort queue account
- [ ] A fixture with two Codex ePort partitions produces two different Codex account-bound token totals
- [ ] Ambiguous or unreadable Codex partitions surface as fallback or explicit error state instead of merged totals
- [ ] Codex plugin tests cover empty partitions, one partition, multiple partitions, and native-only usage

## Blocked by

- 01-lock-account-bound-eusage-contract.md
- 02-codex-calculated-usage-tracer.md
- 04-account-ownership-dedupe-and-partition-safety.md
