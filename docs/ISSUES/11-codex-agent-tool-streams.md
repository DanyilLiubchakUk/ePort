## Parent
docs/prd/cursor-agent-parity.md

## What to build
Codex **Agent tool egress** on the edge: when Cursor hits `POST /v1/chat/completions` with a Codex-routed model, translate Codex Responses API SSE into OpenAI chat completion chunks that include streaming `tool_calls` (start, argument deltas, done fallback), `custom_tool_call` / ApplyPatch support, and `finish_reason: tool_calls` when the model invoked tools. Keep `POST /v1/responses` on Codex routes as **native Responses SSE passthrough** so tool items are not stripped on the responses edge shape. Text-only turns must remain unchanged. Borrow behavior from `vendors/codex-cursor` and `vendors/codex-proxy-ts` (patterns only).

## Acceptance criteria
- [ ] Mocked upstream SSE with `function_call` emits chat chunks with `tool_calls` (id, name, streaming arguments) and final `finish_reason: tool_calls`
- [ ] `custom_tool_call` and `custom_tool_call_input.delta` events translate like `function_call` / `function_call_arguments.delta`
- [ ] Text-only upstream stream still ends with `finish_reason: stop` and existing chat chunk shape
- [ ] Codex `POST /v1/responses` returns passthrough SSE including tool-related events (no lossy chat translation on responses path)
- [ ] P0 golden/fixture tests for tool start, argument delta, output_item.done fallback, and text regression
- [ ] P1 edge integration test: mocked Codex SSE through full router on chat path returns expected chunk sequence

## Blocked by
- ISSUES/04-codex-edge-route-local-up.md
- ISSUES/07-dynamic-models-catalog.md
