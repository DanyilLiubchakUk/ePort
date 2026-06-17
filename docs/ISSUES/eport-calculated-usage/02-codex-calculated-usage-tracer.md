## Parent

docs/prd/eport-calculated-usage.md

## What to build

Add the first end-to-end Codex ePort Calculated Usage tracer. When ePort proxies a completed Codex response, it captures the final `response.completed` usage payload, normalizes the token fields, records one raw event owned by the active account queue entry, and updates a cumulative Daily usage snapshot in the Codex ePort account partition. Usage capture must run for both OpenAI Responses passthrough and Chat Completions translation paths, and it must not depend on whether the turn finishes as plain `stop` or `tool_calls`.

## Acceptance criteria

- [ ] Codex `response.completed.response.usage` is captured on Responses passthrough streams
- [ ] Codex `response.completed.response.usage` is captured on Chat Completions translation streams
- [ ] Raw Codex events include provider, Provider Account fingerprint, response id, client model, bare model, effort, fast tier context, finish, and upstream usage
- [ ] Daily Codex snapshots upsert by provider, Provider Account fingerprint, and reporting day
- [ ] Codex cached input tokens, output tokens, reasoning output tokens, and total tokens are preserved when upstream provides them
- [ ] Text-only `stop` and tool-call completions both flush usage exactly once
- [ ] Codex ePort-proxied usage is written under the Codex ePort account partition while native Codex CLI sessions remain untouched
- [ ] Tests use temporary provider homes and do not mutate real Codex or eUsage data
- [ ] Failed usage writes are logged clearly without corrupting the client stream

## Blocked by

- 01-lock-account-bound-eusage-contract.md
