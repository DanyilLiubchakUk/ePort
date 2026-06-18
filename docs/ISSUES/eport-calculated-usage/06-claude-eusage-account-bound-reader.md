## Parent

docs/prd/eport-calculated-usage.md

## What to build

Teach the Claude eUsage plugin path to discover Claude ePort account partitions, query each partition as a Claude home, and emit account-bound child outputs. Native Claude Code usage remains available as normal provider-level Claude data, while each ePort partition becomes a Provider Account-specific output with its own token lines and usage data identity.

## Acceptance criteria

- [x] Claude eUsage discovery finds multiple Claude ePort account partitions under the native Claude home
- [x] The Claude plugin queries ccusage once per discovered ePort account partition
- [x] Each Claude ePort partition is queried through the stable synthetic ePort project folder
- [x] Each Claude ePort partition emits one account-bound child output with exactly one Provider Account detection
- [x] Claude account-bound source facts include stable usage data identity per Provider Account and reporting day
- [x] Native Claude Code usage continues to load without being attributed to any ePort queue account
- [x] A fixture with two Claude ePort partitions produces two different Claude account-bound token totals
- [x] Ambiguous or unreadable Claude partitions surface as fallback or explicit error state instead of merged totals
- [x] Claude plugin tests cover empty partitions, one partition, multiple partitions, and native-only usage

## Verification notes

- OpenUsage Claude plugin now discovers `eport-accounts/<providerAccountFingerprint>` directories under the native Claude home and queries each partition as a Claude home.
- Claude ePort partition fixtures use the stable synthetic project folder `projects/eport-cursor-proxy`.
- Native Claude Code usage remains provider-level, while each discovered ePort partition emits a `providerAccountOutputs` child with one high-confidence Claude Provider Account detection.
- Account-bound Claude source facts use `eport:claude:<providerAccountFingerprint>:daily:<YYYY-MM-DD>` as stable `dataIdentity`.
- Claude plugin fixtures cover native-only usage, one ePort partition, multiple partitions with distinct totals, empty partitions, unreadable partitions surfaced as account-bound status output, and `CLAUDE_CONFIG_DIR` partition discovery.

## Blocked by

- 01-lock-account-bound-eusage-contract.md
- 03-claude-calculated-usage-tracer.md
- 04-account-ownership-dedupe-and-partition-safety.md
