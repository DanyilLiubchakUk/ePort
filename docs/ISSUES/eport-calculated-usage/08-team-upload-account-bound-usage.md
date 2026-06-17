## Parent

docs/prd/eport-calculated-usage.md

## What to build

Extend eUsage Team upload so account-bound child outputs upload as separate Provider Account-owned snapshots. Each uploaded child output must attach the matching shared Provider Account metadata, preserve stable usage data identity, and honor visibility and sharing consent. A provider refresh with multiple account-bound outputs should no longer be skipped as ambiguous when each child output maps to exactly one shared Provider Account.

## Acceptance criteria

- [ ] Shared visible Provider Accounts upload their matching Codex account-bound ePort usage
- [ ] Shared visible Provider Accounts upload their matching Claude account-bound ePort usage
- [ ] Hidden Provider Accounts suppress future account-bound ePort usage uploads
- [ ] Unshared Provider Accounts remain local and do not upload account-bound ePort usage
- [ ] Each Team upload payload carries a stable Provider Account-scoped data identity for upsert behavior
- [ ] A provider refresh with two account-bound child outputs uploads them independently when both are shared
- [ ] A provider refresh with ambiguous provider-level multi-account data still follows the existing skip behavior
- [ ] Immediate share-on can upload current cached account-bound usage when available
- [ ] Team upload tests cover shared, unshared, hidden, ambiguous, and repeated-upload cases

## Blocked by

- 05-codex-eusage-account-bound-reader.md
- 06-claude-eusage-account-bound-reader.md
- 07-eusage-local-account-display.md
