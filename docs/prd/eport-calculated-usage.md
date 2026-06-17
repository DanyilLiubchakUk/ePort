# ePort Calculated Usage - Product Requirements Document

**Status:** Draft for implementation
**Date:** 2026-06-17
**Sources:** Current repo glossary, ePort v1 PRD, calculated-usage grill notes, and OpenUsage/eUsage Provider Account implementation review.

---

## Problem Statement

Developers can route Cursor traffic through ePort using Codex and Claude subscription accounts, including multiple accounts in an account queue. ePort knows which queue entry serves each request, but eUsage does not automatically know which subscription account consumed the tokens.

Without explicit ePort Calculated Usage, Cursor traffic routed through ePort is either invisible in eUsage or collapses into one merged provider total. That is acceptable for a single account, but it fails the multi-account case: when a user rotates between two Codex or Claude accounts in one day, they need eUsage to show separate token and estimated-cost totals per Provider Account while keeping native CLI usage separate and avoiding double counting.

The user also needs this to fit the current eUsage Provider Account model. eUsage already has Provider Account identity, local labels, visibility, and Team sharing, but current provider snapshots are provider-level. A single provider snapshot with multiple Provider Accounts cannot safely upload to Team because the existing sync path requires one snapshot to map to at most one shared Provider Account.

## Solution

ePort records ePort Calculated Usage for Cursor traffic that it proxies to Codex and Claude subscriptions. Each completed upstream response produces an immutable raw event, tagged with the Provider Account fingerprint from the queue entry that served the request. ePort then produces cumulative Daily usage snapshots per provider, Provider Account fingerprint, and reporting day.

For v1, ePort writes ccusage-compatible local data under the native provider homes so eUsage can continue presenting usage inside the existing Codex and Claude provider views. Native CLI usage remains in the normal native tree, while ePort Cursor usage is partitioned per account:

- Codex native CLI usage stays in the normal Codex sessions tree.
- Codex ePort-proxied usage is written under a per-account ePort account partition.
- Claude native CLI usage stays in the normal Claude projects tree.
- Claude ePort-proxied usage is written under a per-account ePort account partition with a stable synthetic project folder.

eUsage gets a small Provider Account-aware plugin/source-facts change. Codex and Claude plugins discover ePort account partitions, query each partition separately, and emit account-bound output so local display and Team upload can map usage to exactly one Provider Account.

The result: eUsage shows normal native Codex/Claude usage plus ePort Cursor usage, split per subscription account when ePort account rotation is used, without creating an "ePort" provider and without merging accounts that served different requests.

## User Stories

1. As a Cursor user routing through ePort, I want Cursor token usage to appear in eUsage, so that eUsage reflects my actual subscription consumption.
2. As a Codex subscriber, I want ePort-routed Codex usage to appear inside the Codex provider view, so that ePort feels like a collection source rather than a separate provider.
3. As a Claude Max subscriber, I want ePort-routed Claude usage to appear inside the Claude provider view, so that my dashboard stays provider-oriented.
4. As a user with one subscription account, I want daily ePort token totals to be included in eUsage, so that I do not need to inspect raw proxy logs.
5. As a user with multiple Codex accounts, I want eUsage to split ePort Codex usage by subscription account, so that I can see which account burned the tokens.
6. As a user with multiple Claude accounts, I want eUsage to split ePort Claude usage by subscription account, so that Claude rotation remains visible.
7. As a power user using account queue rotation, I want the active queue entry to own the tokens for the request it served, so that 429 rotation does not blur account ownership.
8. As a user, I want native Codex CLI usage to stay separate from ePort Cursor traffic, so that command-line work is not misattributed to an ePort queue account.
9. As a user, I want native Claude Code usage to stay separate from ePort Cursor traffic, so that Claude Code sessions are not misattributed to ePort.
10. As a user, I want ePort account partitions to live under native provider homes, so that eUsage can discover them alongside existing provider usage.
11. As a user, I want ePort to write cumulative Daily usage snapshots, so that repeated eUsage refreshes update the same row instead of appending duplicates.
12. As a user, I want usage identity to include provider, Provider Account fingerprint, and reporting day, so that deduplication is stable across refreshes.
13. As a user, I want unknown account usage preserved under a provider-specific fallback account, so that no completed usage disappears.
14. As a user, I want ePort to keep raw request events, so that detailed investigation is possible when daily totals look wrong.
15. As a user, I want eUsage to read calculated daily rows rather than raw request logs, so that dashboard refresh remains fast and stable.
16. As a user, I want eUsage local labels to apply to ePort accounts, so that "Work", "Personal", or similar labels carry through to usage display.
17. As a Team user, I want shared Provider Account metadata to attach to ePort usage rows, so that Team dashboards can show account labels without exposing raw credentials.
18. As a Team user, I want ePort account usage to upload only when that Provider Account is shared, visible, and detected, so that sharing consent remains respected.
19. As a Team user, I want a hidden Provider Account to stop future ePort usage uploads, so that local visibility and Team sharing controls stay meaningful.
20. As a Team admin, I want account-bound ePort usage to have stable data identity, so that repeated uploads upsert instead of duplicating rows.
21. As a local eUsage user, I want per-account usage lines to render under the correct Provider Account, so that visible accounts do not repeat one merged provider total.
22. As a local eUsage user, I want multiple ePort account partitions shown together, so that I can compare account usage in one provider view.
23. As a user, I want standard native usage and ePort partition usage to coexist, so that eUsage can show the whole machine's Codex/Claude activity.
24. As a user, I want ePort usage to avoid requiring a ccusage fork on PATH, so that eUsage remains robust across package runner changes.
25. As a maintainer, I want eUsage plugins to query each ePort partition explicitly, so that per-account totals are produced intentionally.
26. As a maintainer, I want account-bound plugin output to map to exactly one Provider Account detection, so that Team upload never hits an ambiguous multi-account snapshot.
27. As a maintainer, I want the account-bound output contract to be small and explicit, so that eUsage core does not need a broad rewrite.
28. As a maintainer, I want a deep ePort usage writer module, so that stream translators can record usage through one stable interface.
29. As a maintainer, I want provider-specific usage adapters, so that Codex and Claude token shapes stay isolated behind a common internal model.
30. As a maintainer, I want daily aggregation tested separately from stream parsing, so that token math is reliable.
31. As a maintainer, I want ccusage-shaped output tested separately from upstream capture, so that eUsage compatibility does not depend on live provider calls.
32. As a maintainer, I want account partition discovery tested separately in eUsage, so that local display and Team upload share the same account identity rules.
33. As a Codex user, I want ePort to capture usage from the final Codex `response.completed` event, so that the totals match upstream completion accounting.
34. As a Codex user, I want cached input tokens and reasoning output tokens preserved when upstream provides them, so that eUsage can show meaningful token breakdowns.
35. As a Codex fast-tier user, I want fast-tier requests recorded with their fast-tier context, so that future cost calculation can treat them correctly.
36. As a Codex user, I want text-only completions and tool-call completions both recorded, so that usage does not depend on finish type.
37. As a Codex user, I want plain `stop` turns recorded even before a live sample is captured, so that the implementation does not artificially skip common chat turns.
38. As a Claude user, I want ePort to capture the latest cumulative Anthropic streaming usage, so that the final output token count is not undercounted.
39. As a Claude user, I want `message_start` usage used as a fallback when no later usage arrives, so that partial provider behavior still records best-known usage.
40. As a Claude user, I want cache creation and cache read tokens preserved when Anthropic provides them, so that local estimates can reflect Claude caching.
41. As a Claude user, I want server tool usage fields preserved when Anthropic provides them, so that future display can expose tool consumption.
42. As a Claude user, I want ePort Cursor traffic placed under a stable synthetic project folder, so that eUsage can query each partition without leaking workspace paths.
43. As a privacy-conscious user, I do not want Cursor workspace paths encoded into ePort Claude usage folders, so that local usage files reveal less project context.
44. As a user, I want raw ePort event logs to carry request/session detail instead of ccusage project folders carrying that detail, so that aggregation files stay simple.
45. As a maintainer, I want eUsage's Team upload path to handle account-bound child snapshots, so that shared Provider Accounts can upload current data immediately.
46. As a maintainer, I want provider account detections for ePort partitions to reuse the existing Provider Account fingerprint model, so that labels, visibility, and sharing continue to work.
47. As a maintainer, I want Codex partition identity to use high-confidence account identity when available, so that account ownership is stable.
48. As a maintainer, I want Claude partition identity to use a deterministic ePort account identity rather than a vague credential source, so that multiple Claude accounts do not collapse.
49. As a maintainer, I want ePort's account queue metadata to expose the fingerprint needed by the usage writer, so that the stream handler does not infer identity from storage paths.
50. As a user, I want eUsage refresh to remain quick even with several ePort accounts, so that per-account visibility does not make the tray app sluggish.
51. As a user, I want failed ePort usage writes to be logged clearly, so that missing usage can be diagnosed.
52. As a user, I want retries or recalculation to be safe, so that interrupted writes do not corrupt daily totals.
53. As a maintainer, I want raw event IDs to deduplicate completed responses, so that retrying aggregation does not double count events.
54. As a maintainer, I want daily snapshot writes to be atomic enough for desktop refresh, so that eUsage never reads half-written JSONL.
55. As a maintainer, I want cost marked as unknown when it cannot be calculated confidently, so that eUsage does not show fake precision.
56. As a user, I want token totals always recorded even when estimated cost is unknown, so that the core value of usage tracking remains.
57. As a user, I want ePort usage to work on macOS and Windows, so that eUsage integration is not platform-specific.
58. As a maintainer, I want path construction to be cross-platform, so that account partitions work under the user's home directory on both OSes.
59. As a maintainer, I want tests to use temporary provider homes, so that no test mutates real Codex, Claude, or eUsage data.
60. As a release verifier, I want manual smoke checks for real Codex and Claude streams, so that fixture-based tests are backed by provider reality.

## Implementation Decisions

- ePort Calculated Usage is not a separate AI provider. It rolls into existing Codex and Claude provider views in eUsage.
- The account that serves a request is independent of the path where usage is written. Routing continues to use the active account queue entry and its auth path; usage ownership uses the same queue entry's Provider Account fingerprint.
- ePort writes raw completed-response events and cumulative Daily usage snapshots. eUsage reads calculated daily rows, not raw request events.
- Usage identity is grouped by provider, Provider Account fingerprint, and reporting day.
- Unknown account usage is preserved under a provider-specific fallback account instead of being dropped.
- Native Codex CLI usage remains in the normal native sessions tree. ePort-proxied Codex Cursor traffic is written under per-account ePort account partitions below the native Codex home.
- Native Claude Code usage remains in the normal native projects tree. ePort-proxied Claude Cursor traffic is written under per-account ePort account partitions below the native Claude home.
- Claude ePort usage uses a stable synthetic project folder inside each account partition. Workspace paths are not mirrored into partition paths.
- eUsage delivery uses the locked B2 approach: Codex and Claude eUsage plugin logic discovers ePort account partitions, queries each partition separately, and emits account-bound local and Team usage data.
- eUsage must not rely on a ccusage fork being first on PATH. eUsage invokes pinned package runners through its host API, so PATH replacement is too brittle.
- The current eUsage Provider Account model is reused. Provider Account labels, visibility, sharing, and Team fingerprints remain the identity and consent foundation.
- The account-bound eUsage contract exposes multiple per-account child outputs from one provider plugin refresh, instead of one provider snapshot matching several accounts. This shape is accepted for implementation in OpenUsage/eUsage as Decision 0130.
- Accepted account-bound plugin output shape:

```ts
type ProviderAccountOutput = {
  providerAccountDetections: [ProviderAccountDetection];
  lines: MetricLine[];
  sourceFacts: ProviderSourceFacts;
  rawPayload?: unknown;
};

type PluginOutput = {
  providerId: string;
  displayName: string;
  plan?: string;
  lines: MetricLine[];
  providerAccountDetections?: ProviderAccountDetection[];
  providerAccountOutputs?: ProviderAccountOutput[];
  sourceFacts?: ProviderSourceFacts;
  rawPayload?: unknown;
};
```

- Each `providerAccountOutput` must map to exactly one Provider Account detection. If a partition cannot map to one account, it must use a fallback account or be surfaced as an explicit error state rather than merged silently.
- Each `providerAccountOutput` carries its own `lines`, `sourceFacts`, stable `sourceFacts.dataIdentity`, and optional `rawPayload`.
- Local provider detail UI should render account-specific lines under each visible Provider Account when account-bound output exists.
- Team upload should upload account-bound child outputs separately, preserving the existing rule that each upload maps to one shared Provider Account.
- Codex usage capture happens on `response.completed` when the event contains `response.usage`.
- Codex usage should flush independent of finish reason. Finish is inferred as `tool_calls` when a function or custom tool item appeared before completion; otherwise `stop`.
- Codex token fields preserve input tokens, cached input tokens, output tokens, reasoning output tokens, total tokens, and fast-tier/request context when available.
- Claude usage capture happens in both Claude stream translators. The implementation remembers the latest usage object from `message_delta.usage`, falls back to `message_start.message.usage`, and flushes one raw event on `message_stop`.
- Claude token fields preserve input tokens, cache creation input tokens, cache read input tokens, output tokens, and server tool usage when present.
- Daily snapshots are cumulative for the reporting day and replace/upsert by stable usage identity.
- Raw event logs are append-only and dedupe by event ID.
- Cost is optional. Tokens are always recorded; cost is recorded only when exact or confidently calculated. Fast-tier cost may remain unknown.
- Major modules to build or modify:
  - Usage capture hook shared by Codex and Claude stream paths.
  - Provider-specific usage normalizers for Codex and Claude upstream usage shapes.
  - Account identity resolver that reads the active queue entry and returns a Provider Account fingerprint.
  - Raw usage event store.
  - Daily aggregation module.
  - ccusage-shaped writer for Codex and Claude account partitions.
  - eUsage partition discovery and account-bound plugin output.
  - eUsage local account-specific display.
  - eUsage Team upload support for account-bound child outputs.

## Testing Decisions

- Tests should assert external behavior and data contracts, not private implementation details.
- The usage normalizers should be tested as deep modules: given upstream Codex or Claude usage payloads, they should return stable normalized token records.
- The daily aggregation module should be tested as a deep module: given raw events for multiple accounts and days, it should produce cumulative daily snapshots without double counting.
- The storage writer should be tested against temporary provider homes: Codex partitions and Claude partitions should create ccusage-compatible files in the expected account-specific homes.
- Account ownership should be tested by simulating account queue entries: the account that served the request owns the raw event and daily snapshot.
- Codex stream tests should cover tool-call completion, text-only `stop` completion, cached token fields, reasoning token fields, and response IDs.
- Claude stream tests should cover `message_start` usage fallback, cumulative `message_delta.usage`, text stop, tool use, cache token fields, and missing usage.
- eUsage plugin tests should cover discovery of multiple ePort partitions, one ccusage query per partition, and account-bound output with exactly one Provider Account detection per child output.
- eUsage local UI tests should cover two visible Provider Accounts showing different token totals, hidden accounts not displaying, and provider-level lines remaining available when no account-bound output exists.
- eUsage Team upload tests should cover account-bound child output upload, stable data identity, hidden or unshared account suppression, and no ambiguous multi-account snapshot upload.
- Regression tests should verify that native CLI usage remains separate from ePort partition usage.
- Manual smoke should verify a real Codex text-only turn carries the expected usage shape, because the available live samples were all tool-call turns.
- Manual smoke should verify a real Claude stream carries cumulative `message_delta.usage`, because docs and fixtures support it but live ePort samples are still needed.

## Out of Scope

- Building a standalone eUsage replacement or a separate ePort provider in eUsage.
- Changing account queue routing or auth semantics beyond exposing the Provider Account fingerprint needed for usage ownership.
- Attributing native Codex CLI usage or native Claude Code usage to specific ePort queue accounts.
- Backfilling historical ePort usage from before this feature exists.
- Publishing GitHub issues or project-tracker items from this PRD.
- Replacing eUsage's ccusage host API with a PATH-level ccusage fork.
- Exposing raw auth tokens, provider emails, or unredacted credential details in usage rows.
- Accurate pricing for every provider/tier when cost is unknown or fast-tier pricing cannot be calculated confidently.
- Encoding real Cursor workspace paths into Claude ePort partition project folders.

## Further Notes

- The account-bound eUsage output contract is accepted as `providerAccountOutputs`, where each child output maps to exactly one Provider Account detection and carries its own lines, source facts, stable data identity, and optional raw payload.
- The current grill note still marks Codex plain-stop live usage as unverified. This should not block implementation; it should be a manual smoke item.
- The safest implementation order is: ePort capture and storage primitives, daily aggregation, partition writing, eUsage partition discovery, eUsage account-bound output/display, Team upload integration, then manual provider smoke.
- The PRD intentionally keeps local visibility and Team sharing separate: local display can show visible account usage, while Team upload remains gated by sharing consent and provider account visibility.
