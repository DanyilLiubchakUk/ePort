## Parent

docs/prd/eport-calculated-usage.md

## What to build

Add the first end-to-end Claude ePort Calculated Usage tracer. Both Claude stream translators remember Anthropic streaming usage as events arrive, prefer the latest cumulative `message_delta.usage`, fall back to `message_start.message.usage`, and flush one raw event on `message_stop`. The flushed event updates a cumulative Daily usage snapshot in the Claude ePort account partition using the stable synthetic ePort project folder.

## Acceptance criteria

- [x] Claude Responses translation captures `message_start.message.usage` as a fallback
- [x] Claude Chat Completions translation captures `message_start.message.usage` as a fallback
- [x] Both Claude translators prefer the latest cumulative `message_delta.usage` when present
- [x] One Claude raw event is flushed on `message_stop` for each completed stream with known usage
- [x] Raw Claude events include provider, Provider Account fingerprint, response id, client model, bare model, effort, finish, and upstream usage
- [x] Claude input tokens, cache creation input tokens, cache read input tokens, output tokens, and server tool usage are preserved when upstream provides them
- [x] Daily Claude snapshots upsert by provider, Provider Account fingerprint, and reporting day
- [x] Claude ePort-proxied usage is written under a stable synthetic ePort project folder inside the Claude ePort account partition
- [x] Tests use temporary provider homes and do not encode real Cursor workspace paths into Claude partition folders

## Verification notes

- Claude stream translators now capture `message_start.message.usage`, replace it with cumulative `message_delta.usage` when present, and emit one usage capture on `message_stop`.
- Claude calculated usage writes raw events, cumulative Daily snapshots, and ccusage-readable Claude project JSONL under `~/.claude/eport-accounts/<fingerprint>/projects/eport-cursor-proxy/`.
- Router coverage proves queued-account fingerprint ownership, Responses and Chat Completions capture paths, token normalization, and stable synthetic project partitioning.

## Blocked by

- 01-lock-account-bound-eusage-contract.md
