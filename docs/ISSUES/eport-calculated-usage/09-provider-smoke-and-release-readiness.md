## Parent

docs/prd/eport-calculated-usage.md

## What to build

Run the final real-provider verification pass for ePort Calculated Usage. Use live Cursor through ePort flows to confirm Codex and Claude usage shapes, account ownership, per-account eUsage display, and Team upload behavior. Treat fixture coverage as necessary but not sufficient: this slice proves the implementation matches provider reality on macOS and Windows before release.

## Acceptance criteria

- [x] Real Codex text-only `stop` turn records usage from `response.completed.response.usage`
- [x] Real Codex tool-call turn records usage once with the expected finish classification
- [x] Real Codex fast-tier turn preserves fast-tier context while allowing cost to remain unknown
- [ ] Real Claude stream confirms cumulative `message_delta.usage` is captured when present
- [ ] Real Claude stream confirms `message_start.message.usage` fallback remains safe when no later usage appears
- [x] A two-account Codex queue day appears in eUsage as two separate Provider Account totals
- [x] A two-account Claude queue day appears in eUsage as two separate Provider Account totals
- [x] Native Codex CLI and Claude Code usage remain separate from ePort account partitions
- [x] Hidden or unshared Provider Accounts do not upload account-bound ePort usage to Team
- [x] macOS smoke confirms native usage tree and ePort account partition paths
- [ ] Windows smoke confirms native usage tree and ePort account partition paths
- [x] Release notes or verification notes call out cost-known versus cost-unknown behavior

## Verification notes

Release readiness status on June 18, 2026 UTC: **not ready for final release** until the remaining live-provider and Windows checks are run. Fixture and unit coverage is green for the implemented paths, and live Codex provider behavior matches the usage capture contract. Live Claude provider behavior could not be checked in this environment because `eport auth status --json` reports Claude as unauthenticated with guidance to run `eport auth login claude` or Claude Code login. Windows live smoke could not be checked from this macOS-only thread.

Live Codex smoke used a temp home copied from the existing Codex CLI auth, started ePort with `--tunnel none`, and sent real `/v1/responses` requests through ePort to the Codex backend. The selected live model was `gpt-5.3-codex-spark`.

- Text-only stop turn: status `200`, `response.completed` present, one raw event recorded with `finish: "stop"`, usage keys `input_tokens`, `input_tokens_details`, `output_tokens`, `output_tokens_details`, and `total_tokens`.
- Fast-tier stop turn: status `200`, upstream request carried `service_tier: "priority"`, raw event recorded with client model `gpt-5.3-codex-spark-fast`, `fastTier: true`, and `finish: "stop"`.
- Tool-call turn: status `200`, forced function tool request recorded one raw event with `finish: "tool_calls"`.
- The resulting temp daily snapshot used `dataIdentity: "eport:codex:<Provider Account fingerprint>:daily:2026-06-18"`, `costSource: "unknown"`, `costUSD: null`, and cumulative `totalTokens: 476`.

OpenUsage/eUsage targeted verification:

- `cargo test team_sync` passed in `/Users/danyil_liubchak/dev/openusage/src-tauri`: 28 passed, 0 failed. This covers independent account-bound child uploads, hidden/unshared suppression, ambiguous provider-level skip behavior, repeated upload replacement, and immediate current-data queueing.
- `TZ=UTC bun run test --run src/pages/provider-detail.test.tsx src/hooks/app/use-probe-state.test.ts plugins/codex/plugin.test.js plugins/claude/plugin.test.js` passed in `/Users/danyil_liubchak/dev/openusage`: 198 passed, 0 failed. This covers Codex and Claude ePort partition discovery, two-account account-bound outputs, local Provider Account display, hidden account filtering, and Provider Account detection sync.
- Running the same OpenUsage Vitest target without `TZ=UTC` failed 8 Claude plugin assertions around "Today" token lines because test fixtures built dates from the machine-local day while the plugin/test context used UTC reporting days. The UTC run is the relevant release gate for the current reporting-day contract, but the tests should be made timezone-stable before broad CI release if CI is not pinned to UTC.

ePort verification:

- `bun test tests/` passed: 192 passed, 0 failed.
- `bunx tsc --noEmit` passed.
- The initial sandboxed `bun test tests/usage/codex.test.ts tests/usage/claude.test.ts tests/edge/router.test.ts tests/claude/translator.test.ts` failed only because the sandbox blocked `Bun.serve({ port: 0 })`; rerunning the edge router tests unsandboxed passed.

Known release blockers:

- Live Claude provider smoke is still pending. Required checks: cumulative `message_delta.usage` capture and `message_start.message.usage` fallback with real Claude streams through ePort.
- Windows smoke is still pending. Required checks: native usage tree separation and ePort account partition discovery on a Windows host.
- Optional before wider CI: make OpenUsage Claude plugin date fixtures use the configured reporting day helper or pin the test timezone so they do not fail near a local/UTC day boundary.

## Blocked by

- 07-eusage-local-account-display.md
- 08-team-upload-account-bound-usage.md
