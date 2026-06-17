## Parent
docs/prd/cursor-agent-parity.md

## What to build
Codex **Agent tool ingress** for multi-turn loops: forward Responses-shaped `input` history (`function_call`, `function_call_output`, reasoning items, messages) through sanitize unchanged where already supported; add **chat-shaped** `messages[]` conversion (`assistant` `tool_calls`, `tool` role) into Responses `input` items when the body lacks an `input` array. Pass `tools` and `tool_choice` through to Codex upstream. End-to-end fixture: follow-up request after a tool turn reaches mocked upstream with correct `input` item types.

## Acceptance criteria
- [ ] Responses-shaped body with `function_call` + `function_call_output` in `input` forwards to mocked Codex upstream intact (after sanitize)
- [ ] Chat-shaped body with `messages` containing `tool_calls` and `tool` role converts to Responses `input` with matching function_call items
- [ ] `tools` and `tool_choice` from edge body appear on upstream Codex request
- [ ] Prior reasoning items in `input` forwarded without stripping encrypted payloads
- [ ] P0 unit tests with golden request fixtures (Responses input and chat messages variants)
- [ ] P1 edge test: two-turn mocked sequence (tool call turn → tool result turn) sends expected upstream body on second request

## Blocked by
- ISSUES/11-codex-agent-tool-streams.md
