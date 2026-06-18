# ePort Calculated Usage Grill

## Goal

Make eUsage desktop and dashboard show tokens burned and estimated cost for
Cursor traffic routed through ePort, without double-counting normal Codex or
Claude local usage.

## Locked Decisions

- ePort Calculated Usage rolls into the existing Codex and Claude provider
  views in eUsage. ePort is a source/collector, not a separate AI provider.
- ePort usage identity is grouped by provider, provider account fingerprint,
  and reporting day.
- Unknown account usage is preserved under a provider-specific fallback account
  instead of being dropped.
- Daily calculated rows are cumulative snapshots for the whole day. eUsage must
  upsert/replace by stable identity, not append each sync as a new total.
- ePort keeps raw request events and calculated daily rows. eUsage reads only
  calculated daily rows.
- eUsage remains the reader/presenter for Codex and Claude usage. **Q4 locked:
  B2** — eUsage gets a small Provider Account-aware plugin/source-facts change
  so each ePort account partition can become account-bound local and Team usage
  data instead of a merged provider snapshot.
- **Storage integration (locked):** ePort writes ccusage-compatible session JSONL
  into the **same native trees** ccusage already scans — no separate
  `~/.eport/usage/` path and no `CODEX_HOME` / `CLAUDE_CONFIG_DIR` changes for
  eUsage.
  - **Codex:** native CLI → `~/.codex/sessions/…`; ePort-proxied →
    `~/.codex/eport-accounts/<fingerprint>/`.
  - **Claude:** native CLI → `~/.claude/projects/…`; ePort-proxied →
    `~/.claude/eport-accounts/<fingerprint>/`.
- **Auth vs write path (locked):** Which account serves a request is independent
  of where sessions are written. ePort **account queue** still picks credentials
  from the active entry's `authPath` for upstream auth and rotation.

## Native write roots (Option A + per-account split — locked)

| Provider | Native CLI (unchanged) | ePort-proxied (per account) | Auth / routing |
|----------|------------------------|-------------------------------|----------------|
| Codex | `~/.codex/sessions/…` | `~/.codex/eport-accounts/<fingerprint>/` | Active queue entry → `authPath` |
| Claude | `~/.claude/projects/…` | `~/.claude/eport-accounts/<fingerprint>/` | Active queue entry → `authPath` |

- **Per-account usage split (Q3 — locked):** separate token/cost totals per
  subscription account in eUsage, not one merged line when the queue rotates.
- Every ePort JSONL event includes **`providerAccountFingerprint`** from the
  queue entry that served the request.
- **eUsage delivery (Q4 — locked): B2.** Codex/Claude eUsage plugin logic must
  discover ePort account partitions, query each partition separately, and emit
  account-bound source facts/lines so local display and Team upload can map
  usage to exactly one Provider Account.
- Do **not** rely on a ccusage fork being first on `PATH`; eUsage invokes
  pinned package runners and treats ccusage as a host API.
- Native CLI usage in `sessions/` / `projects/…` is **not** attributed to a
  specific ePort queue account.

## eUsage implementation notes (verified 2026-06-17)

OpenUsage/eUsage already has a Provider Account model, but it is account
metadata around one provider snapshot, not per-account token aggregation inside
one snapshot.

- Plugins return `providerAccountDetections`; the app stores them in
  `providerAccountRegistry` after hashing with `providerAccountLocalSalt`.
- Codex detects account identity from `auth.tokens.account_id` with high
  confidence. Claude detects less directly from `CLAUDE_CONFIG_DIR`,
  credential source, or env token.
- The Codex and Claude plugins each call `ctx.host.ccusage.query(...)` once per
  probe and build one `sourceFacts.dataIdentity` per provider/day:
  `codex:daily:<YYYY-MM-DD>` or `claude:daily:<YYYY-MM-DD>`.
- The host runner invokes pinned ccusage package runners (`ccusage@20.0.2`,
  with legacy fallback) and passes `CODEX_HOME` / `CLAUDE_CONFIG_DIR` when a
  plugin supplies `homePath`. This makes replacing `ccusage` by putting a fork
  first on `PATH` unreliable.
- Provider detail UI can list multiple Provider Accounts, but today it repeats
  the same provider `lines` under each visible account. It does not bind metric
  lines to account-specific data.
- Team upload can attach one shared Provider Account to one cached provider
  snapshot. If multiple shared accounts match one snapshot, the sync path skips
  that snapshot to avoid ambiguous attribution.

Implication for Q4: ePort cannot get simultaneous per-account local and team
visibility merely by writing multiple partitions and hoping standard eUsage
will split them. Either eUsage needs a real per-account usage path, or ePort
must expose each partition as a separately queryable snapshot that eUsage can
map to exactly one Provider Account.

## Codex upstream usage (verified 2026-06-17)

Source: final SSE event `response.completed` → `response.usage`.

```json
{
  "input_tokens": 173715,
  "input_tokens_details": { "cached_tokens": 0 },
  "output_tokens": 564,
  "output_tokens_details": { "reasoning_tokens": 396 },
  "total_tokens": 174279
}
```

Verified on 9 real Cursor → ePort → Codex subscription streams:

- Present on every completed stream (tool-call turns).
- Same shape for `fast=0` and `fast=1`.
- No cost field — tokens only.
- `cached_tokens` and `reasoning_tokens` always in `*_tokens_details`; values
  may be `0`.
- Input counts include full Cursor context per turn (often 170k+).

Fast tier sample (`fast=1`):

```json
{
  "input_tokens": 197708,
  "input_tokens_details": { "cached_tokens": 0 },
  "output_tokens": 2153,
  "output_tokens_details": { "reasoning_tokens": 1526 },
  "total_tokens": 199861
}
```

Capture point in ePort: Codex stream handler on `response.completed` (both
`/v1/chat/completions` translation path and `/v1/responses` passthrough).

## Codex plain stop finish (Q7 — open)

Current ePort code already distinguishes text-only vs tool-call finishes:

- Responses passthrough observes `response.output_item.added` and infers
  `tool_calls` only when a function/custom tool item was seen before
  `response.completed`; otherwise it reports `stop`.
- Chat translation has a regression test for text-only streams ending with
  `finish_reason: "stop"`.
- Real usage probes captured so far all ended in tool-call turns, so a live
  plain-stop `response.completed.response.usage` sample has not been captured.

**Recommended Q7 lock:** do not block the usage writer on a live plain-stop
sample. Flush usage on every `response.completed` that contains `response.usage`,
independent of finish reason. Record `finish` with the existing inference:
`tool_calls` if a tool/custom tool item appeared, otherwise `stop`. Add a manual
post-implementation smoke item to confirm a real text-only Codex turn carries
the same usage shape.

## Claude upstream usage (docs + code verified 2026-06-17)

Source: Anthropic Messages streaming SSE. Official docs show usage on
`message_start.message.usage` and cumulative usage on `message_delta.usage`:
<https://platform.claude.com/docs/en/build-with-claude/streaming>.

Current ePort route:

- `ClaudeUpstreamClient.stream()` returns the raw Anthropic SSE response.
- `translateAnthropicSseToResponses()` and `translateAnthropicSseToChat()` parse
  each Anthropic event and are the capture points.
- Existing fixtures already include `message_start.message.usage`, but the
  translator currently ignores all Claude usage fields and only reports finish
  reason.

**Q5 locked:** capture usage in both Claude stream translators by remembering
the latest usage object seen on `message_start.message.usage` or
`message_delta.usage`, preferring `message_delta.usage` because it is
cumulative. Flush one raw event on `message_stop`.

Draft Claude raw event:

```json
{
  "id": "evt_<uuid>",
  "recordedAt": "2026-06-17T15:04:00.000Z",
  "provider": "claude",
  "providerAccountFingerprint": "fp_…",
  "responseId": "msg_…",
  "clientModel": "opus-4.8max",
  "bareModelId": "opus-4.8",
  "effort": "max",
  "finish": "tool_calls",
  "usage": {
    "input_tokens": 10682,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "output_tokens": 510,
    "server_tool_use": { "web_search_requests": 1 }
  }
}
```

## Claude account partition project path (Q6 — locked)

Current eUsage/OpenUsage behavior:

- Claude plugin reads the active Claude home from `CLAUDE_CONFIG_DIR`, defaulting
  to `~/.claude`.
- eUsage ccusage host API sets `CLAUDE_CONFIG_DIR=<homePath>` for Claude
  `ctx.host.ccusage.query(...)`.
- Therefore each ePort account partition must look like a Claude home:
  `~/.claude/eport-accounts/<fingerprint>/projects/<project-folder>/...`.

Options:

| Option | Project folder | Trade-off |
|--------|----------------|-----------|
| A — synthetic ePort project | One stable folder per account, e.g. `projects/eport-cursor-proxy/` | Simple, privacy-safe, no workspace path discovery, ideal for daily per-account totals |
| B — encode real Cursor workspace path | Mirror Claude Code's `projects/<encoded-path>/` behavior when known | More familiar project grouping, but Cursor may not provide cwd reliably and it leaks workspace paths into usage partitions |
| C — one folder per ePort session/thread | `projects/eport-cursor-proxy/<session-id>/` or equivalent | Good traceability, but high-cardinality and not needed for daily totals |

**Q6 locked:** A. Use one stable synthetic project folder inside each account
partition for ePort Cursor traffic:
`~/.claude/eport-accounts/<fingerprint>/projects/eport-cursor-proxy/...`.
Keep day-sharded raw ePort event logs as the place for request/session detail;
keep ccusage-shaped files optimized for daily/account aggregation. Usage writer
paths must stream JSONL and increment Daily snapshots so large local histories do
not become large in-memory arrays.

## Planned storage shape (draft — grill in progress)

### Raw event (day-sharded append-only JSONL)

Path: `eport/raw-events/<YYYY-MM-DD>.jsonl` under the Provider Account
partition. One line per completed upstream response. Immutable; dedupe by event
id. Legacy `eport/raw-events.jsonl` files remain readable during migration.

```json
{
  "id": "evt_<uuid>",
  "recordedAt": "2026-06-17T15:04:00.000Z",
  "provider": "codex",
  "providerAccountFingerprint": "fp_…",
  "responseId": "resp_…",
  "clientModel": "gpt-5.5xhigh",
  "bareModelId": "gpt-5.5",
  "effort": "xhigh",
  "fastTier": false,
  "finish": "tool_calls",
  "usage": {
    "input_tokens": 173715,
    "input_tokens_details": { "cached_tokens": 0 },
    "output_tokens": 564,
    "output_tokens_details": { "reasoning_tokens": 396 },
    "total_tokens": 174279
  }
}
```

### Daily calculated row (ccusage-shaped, replace by identity)

Cumulative totals for one provider account + reporting day. eUsage upserts by
`dataIdentity`.

```json
{
  "dataIdentity": "eport:codex:fp_…:daily:2026-06-17",
  "provider": "codex",
  "date": "2026-06-17",
  "inputTokens": 1234567,
  "outputTokens": 89012,
  "cachedInputTokens": 987654,
  "reasoningOutputTokens": 12345,
  "totalTokens": 1323579,
  "costUSD": null,
  "costSource": "unknown"
}
```

`costSource`: `exact` | `calculated` | `unknown`. v1: tokens always recorded;
cost only when exact or confidently calculated (fast tier may stay `unknown`).

## Open grill questions

- **Q7:** Lock Codex plain-stop handling as finish inference + post-implementation
  smoke, without waiting for a live plain-stop usage sample?
