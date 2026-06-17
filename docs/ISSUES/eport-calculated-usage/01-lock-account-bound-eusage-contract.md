## Parent

docs/prd/eport-calculated-usage.md

## What to build

Lock the account-bound eUsage plugin output contract that lets one Codex or Claude provider refresh return multiple Provider Account-specific child outputs. Each child output must represent exactly one Provider Account detection and carry its own metric lines, source facts, data identity, and optional raw payload, so local display and Team upload never have to guess which account owns a merged total.

## Outcome

Accepted as-is with two explicit additions:

- `PluginOutput` may also carry provider-level `sourceFacts?: ProviderSourceFacts` and `rawPayload?: unknown`, matching existing eUsage output behavior.
- Account-bound child outputs require non-empty `sourceFacts.dataIdentity`; ePort calculated usage uses `eport:<provider>:<providerAccountFingerprint>:daily:<YYYY-MM-DD>`.

The PRD recommends this decision shape:

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

## Acceptance criteria

- [x] The account-bound plugin output shape is accepted as-is or amended explicitly before implementation starts
- [x] The contract supports multiple account-bound child outputs from one provider plugin refresh
- [x] Each child output maps to exactly one Provider Account detection
- [x] Each child output carries its own metric lines and source facts, including a stable usage data identity
- [x] Ambiguous partition mapping is specified as fallback account or explicit error state, never as a silent merge
- [x] Local display and Team upload behavior are both covered by the contract
- [x] Test fixtures can express two Provider Accounts with different token totals in one provider refresh

## Verification notes

- OpenUsage Decision 0130 accepts the contract.
- OpenUsage runtime/types now parse and expose `providerAccountOutputs`.
- Runtime fixture coverage proves two Provider Accounts with different token totals can be returned in one provider refresh.

## Blocked by

None - can start immediately
