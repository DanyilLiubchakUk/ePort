## Parent

docs/prd/eport-calculated-usage.md

## What to build

Update local eUsage provider detail display so account-bound child outputs render under the correct visible Provider Account. When Codex or Claude returns account-bound ePort data, the UI shows each account's own token totals instead of repeating one merged provider total under every account. Existing provider-level display remains available for native-only usage or providers that do not emit account-bound outputs.

## Acceptance criteria

- [x] Two visible Codex Provider Accounts can show different ePort token totals in one Codex provider view
- [x] Two visible Claude Provider Accounts can show different ePort token totals in one Claude provider view
- [x] Hidden Provider Accounts do not render their account-bound ePort usage locally
- [x] Provider-level native usage remains visible when no account-bound output exists
- [x] Mixed native usage and ePort partition usage can coexist without duplicate rows
- [x] Provider Account labels apply to ePort account-bound usage rows
- [x] Empty account-bound outputs render an appropriate empty state instead of copying provider-level lines
- [x] UI tests cover visible accounts, hidden accounts, multiple accounts, and native-only fallback

## Verification notes

- OpenUsage Provider Detail now renders account-bound child output lines under the matching visible Provider Account instead of repeating provider-level lines.
- Provider-level native lines render once when account-bound child outputs exist, so native usage and ePort partition usage can coexist without duplicated rows.
- Account-bound child detections are synced into the local Provider Account registry and enriched with local account fingerprints for display matching.
- Hidden Provider Accounts are filtered out before account-bound rows render.
- Empty account-bound child rows show an account-bound empty state instead of copying provider-level lines.
- ePort Codex calculated usage now records the real Codex provider account id when available, and OpenUsage merges ePort Codex partition usage into native Codex totals when both sides report the same provider account id.
- Native-only or merged Codex usage stays provider-level even if a stale visible local Provider Account row exists from older ePort data.
- A one-time local migration was run for the current machine to rewrite the existing ePort Codex JSON partition to the real Codex account fingerprint and write `eport/provider-account.json`; the temporary migration script was deleted after use.

## Blocked by

- 05-codex-eusage-account-bound-reader.md
- 06-claude-eusage-account-bound-reader.md
