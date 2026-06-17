## Parent
docs/prd/cursor-agent-parity.md

## What to build
Codex **encrypted reasoning round-trip** on the chat edge path: echo `reasoning.encrypted_content` (and related reasoning SSE events) on egress in the OpenAI chunk shape Cursor expects; ensure prior reasoning items in request `input` pass through sanitize to upstream unchanged. Enables multi-turn Codex Agent and chat when Cursor preserves reasoning traces. Request `include: reasoning.encrypted_content` behavior stays; this slice completes the **response** side missing after slice 04.

## Acceptance criteria
- [ ] Mocked upstream SSE with reasoning items produces chat chunks Cursor can consume (golden fixture; not dropped)
- [ ] Follow-up request containing prior reasoning items in `input` forwards encrypted fields unchanged to mocked Codex upstream
- [ ] Text + reasoning + tool calls in one turn do not regress slice 11 tool egress behavior
- [ ] P0 golden tests for reasoning egress events; P1 ingress forward test

## Blocked by
- ISSUES/11-codex-agent-tool-streams.md
