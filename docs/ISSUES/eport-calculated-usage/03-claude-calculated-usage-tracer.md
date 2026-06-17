## Parent

docs/prd/eport-calculated-usage.md

## What to build

Add the first end-to-end Claude ePort Calculated Usage tracer. Both Claude stream translators remember Anthropic streaming usage as events arrive, prefer the latest cumulative `message_delta.usage`, fall back to `message_start.message.usage`, and flush one raw event on `message_stop`. The flushed event updates a cumulative Daily usage snapshot in the Claude ePort account partition using the stable synthetic ePort project folder.

## Acceptance criteria

- [ ] Claude Responses translation captures `message_start.message.usage` as a fallback
- [ ] Claude Chat Completions translation captures `message_start.message.usage` as a fallback
- [ ] Both Claude translators prefer the latest cumulative `message_delta.usage` when present
- [ ] One Claude raw event is flushed on `message_stop` for each completed stream with known usage
- [ ] Raw Claude events include provider, Provider Account fingerprint, response id, client model, bare model, effort, finish, and upstream usage
- [ ] Claude input tokens, cache creation input tokens, cache read input tokens, output tokens, and server tool usage are preserved when upstream provides them
- [ ] Daily Claude snapshots upsert by provider, Provider Account fingerprint, and reporting day
- [ ] Claude ePort-proxied usage is written under a stable synthetic ePort project folder inside the Claude ePort account partition
- [ ] Tests use temporary provider homes and do not encode real Cursor workspace paths into Claude partition folders

## Blocked by

- 01-lock-account-bound-eusage-contract.md
