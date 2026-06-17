## Parent
docs/prd/cursor-agent-parity.md

## What to build
Claude **Agent tool loop** end-to-end: extend edge ingress so chat-shaped `messages` with `tool_calls`, `tool` role, and `tool_call_id` normalize to Anthropic `tool_use` / `tool_result` blocks (Responses `input` path already partial). Extend Claude stream egress so Anthropic SSE (`tool_use` start, `input_json_delta`, `message_stop` with tool stop reason) translates to OpenAI `tool_calls` chunks on `POST /v1/chat/completions`, and to Responses-shaped tool events on `POST /v1/responses` (not text-only). OpenAI-style `tools` / `tool_choice` convert to Anthropic Messages format at the provider boundary. Same-turn text + tool_use supported. Never emit `xhigh` upstream.

## Acceptance criteria
- [ ] Chat `messages` with `tool_calls` + `tool` role produce correct Anthropic Messages request on mocked upstream
- [ ] Responses `input` with `function_call` / `function_call_output` continues to map to tool_use / tool_result
- [ ] Mocked Anthropic SSE with `tool_use` streams OpenAI chat chunks with `finish_reason: tool_calls`
- [ ] Mocked Anthropic tool stream on responses edge shape emits Responses events (not only `output_text.delta`)
- [ ] Assistant text and tool_use in one turn both appear on egress
- [ ] P0 translator tests for ingress + egress golden fixtures; effort mapping never emits `xhigh`
- [ ] P1 edge dual-routing test: Claude model dispatches tool loop; Codex model unchanged

## Blocked by
- ISSUES/06-claude-auth-translator-dual-routing.md
- ISSUES/11-codex-agent-tool-streams.md
