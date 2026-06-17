## Parent

docs/prd/eport-calculated-usage.md

## What to build

Update local eUsage provider detail display so account-bound child outputs render under the correct visible Provider Account. When Codex or Claude returns account-bound ePort data, the UI shows each account's own token totals instead of repeating one merged provider total under every account. Existing provider-level display remains available for native-only usage or providers that do not emit account-bound outputs.

## Acceptance criteria

- [ ] Two visible Codex Provider Accounts can show different ePort token totals in one Codex provider view
- [ ] Two visible Claude Provider Accounts can show different ePort token totals in one Claude provider view
- [ ] Hidden Provider Accounts do not render their account-bound ePort usage locally
- [ ] Provider-level native usage remains visible when no account-bound output exists
- [ ] Mixed native usage and ePort partition usage can coexist without duplicate rows
- [ ] Provider Account labels apply to ePort account-bound usage rows
- [ ] Empty account-bound outputs render an appropriate empty state instead of copying provider-level lines
- [ ] UI tests cover visible accounts, hidden accounts, multiple accounts, and native-only fallback

## Blocked by

- 05-codex-eusage-account-bound-reader.md
- 06-claude-eusage-account-bound-reader.md
