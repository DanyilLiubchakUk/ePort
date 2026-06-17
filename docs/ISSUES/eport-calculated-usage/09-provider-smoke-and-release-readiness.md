## Parent

docs/prd/eport-calculated-usage.md

## What to build

Run the final real-provider verification pass for ePort Calculated Usage. Use live Cursor through ePort flows to confirm Codex and Claude usage shapes, account ownership, per-account eUsage display, and Team upload behavior. Treat fixture coverage as necessary but not sufficient: this slice proves the implementation matches provider reality on macOS and Windows before release.

## Acceptance criteria

- [ ] Real Codex text-only `stop` turn records usage from `response.completed.response.usage`
- [ ] Real Codex tool-call turn records usage once with the expected finish classification
- [ ] Real Codex fast-tier turn preserves fast-tier context while allowing cost to remain unknown
- [ ] Real Claude stream confirms cumulative `message_delta.usage` is captured when present
- [ ] Real Claude stream confirms `message_start.message.usage` fallback remains safe when no later usage appears
- [ ] A two-account Codex queue day appears in eUsage as two separate Provider Account totals
- [ ] A two-account Claude queue day appears in eUsage as two separate Provider Account totals
- [ ] Native Codex CLI and Claude Code usage remain separate from ePort account partitions
- [ ] Hidden or unshared Provider Accounts do not upload account-bound ePort usage to Team
- [ ] macOS smoke confirms native usage tree and ePort account partition paths
- [ ] Windows smoke confirms native usage tree and ePort account partition paths
- [ ] Release notes or verification notes call out cost-known versus cost-unknown behavior

## Blocked by

- 07-eusage-local-account-display.md
- 08-team-upload-account-bound-usage.md
