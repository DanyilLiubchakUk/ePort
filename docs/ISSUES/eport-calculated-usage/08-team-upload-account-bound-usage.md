## Parent

docs/prd/eport-calculated-usage.md

## What to build

Extend eUsage Team upload so account-bound child outputs upload as separate Provider Account-owned snapshots. Each uploaded child output must attach the matching shared Provider Account metadata, preserve stable usage data identity, and honor visibility and sharing consent. A provider refresh with multiple account-bound outputs should no longer be skipped as ambiguous when each child output maps to exactly one shared Provider Account.

## Acceptance criteria

- [x] Shared visible Provider Accounts upload their matching Codex account-bound ePort usage
- [x] Shared visible Provider Accounts upload their matching Claude account-bound ePort usage
- [x] Hidden Provider Accounts suppress future account-bound ePort usage uploads
- [x] Unshared Provider Accounts remain local and do not upload account-bound ePort usage
- [x] Each Team upload payload carries a stable Provider Account-scoped data identity for upsert behavior
- [x] A provider refresh with two account-bound child outputs uploads them independently when both are shared
- [x] A provider refresh with ambiguous provider-level multi-account data still follows the existing skip behavior
- [x] Immediate share-on can upload current cached account-bound usage when available
- [x] Team upload tests cover shared, unshared, hidden, ambiguous, and repeated-upload cases

## Verification notes

- OpenUsage Team sync now enqueues account-bound child outputs as separate Provider Account-owned uploads while preserving provider-level upload behavior.
- Account-bound child uploads reuse existing Provider Account sharing gates: shared, visible, detected, and scoped to the current Team fingerprint.
- Hidden or unshared child accounts do not enqueue uploads, including pending uploads checked just before send.
- Child upload payloads use the child output's own source facts, raw payload, metric samples, and stable `sourceFacts.dataIdentity`, then namespace it with the team-scoped Provider Account fingerprint for backend upserts.
- Provider-level snapshots with multiple shared Provider Account detections still skip as ambiguous; account-bound child outputs from the same refresh can still upload independently.
- Immediate share-on now queues current cached account-bound child data when the cached provider snapshot contains a matching child output.
- Verified with `cargo test team_sync` in OpenUsage.

## Blocked by

- 05-codex-eusage-account-bound-reader.md
- 06-claude-eusage-account-bound-reader.md
- 07-eusage-local-account-display.md
