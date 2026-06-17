# ePort — Cursor Agent Parity PRD

**Status:** Draft for implementation  
**Date:** 2026-06-17  
**Parent:** [eport-v1.md](./eport-v1.md)  
**Sources:** [CONTEXT.md](../../CONTEXT.md), conversation on Agent/tool-call gaps (slices 01–07), vendor patterns under `vendors/`

---

## Problem Statement

After ePort slices 01–07, a Cursor user can verify a custom Base URL, discover models from `GET /v1/models`, and receive **single-turn text** replies over a public tunnel. That is not enough for how Cursor is actually used day to day: **Agent mode**, **multi-turn chat with tools**, **image paste**, and **reasoning traces** on both **Codex** and **Claude** subscription routes.

Today, ePort’s edge translators are text-centric on the response path. When Cursor Agent asks the model to edit files, run terminal commands, or apply patches, the upstream may emit tool-call events — but ePort often drops them and ends the stream with `finish_reason: stop`. From the user’s perspective the model says “I’ll work on that” and then nothing happens. Similarly, multimodal parts and encrypted reasoning are only partially wired: request sanitization may be correct while **egress** does not round-trip what Cursor needs on the next turn.

Users should not need separate proxies per provider or per feature (chat vs agent). They configured one Base URL and one proxy API key; Agent, Chat, Codex models, and Claude models must all work through the same **edge protocol** surface.

---

## Solution

Extend ePort’s **dual-provider edge boundary** so Cursor’s full client behavior works end to end:

1. **Tool-call parity (P0)** — Translate tool invocations and results in **both directions** on **both** `POST /v1/chat/completions` and `POST /v1/responses` ingress shapes, for **Codex** and **Claude** routes. Stream `tool_calls` (or Responses-native tool items) back to Cursor with correct `finish_reason`, including Cursor-specific variants (`custom_tool_call` / ApplyPatch on Codex).
2. **Multimodal parity (P1)** — Translate Cursor content parts (text, images, attachments) into Codex Responses input and Anthropic message blocks on ingress; preserve or re-emit compatible shapes on egress where the client expects them.
3. **Reasoning parity on Codex (P1)** — Round-trip **encrypted reasoning** on the chat translation path, not only on request `include`, so multi-turn Codex Agent flows do not lose reasoning context.
4. **Session continuity (P1)** — Honor client-supplied `prompt_cache_key` / session identifiers; optionally strengthen resume semantics when Cursor sends parent reasoning or tool output items (vendor-learned session matching).
5. **Symmetry** — Every behavior below applies per **provider route** (Codex vs Claude) with provider-appropriate upstream APIs; Claude never receives Codex-only tokens (`xhigh`, `-fast`).

Implementation borrows proven patterns from `vendors/codex-cursor`, `vendors/codex-proxy-ts`, and `vendors/ccproxypal` without vendoring their codebases wholesale.

After this work ships (and slice 17 manual smoke passes), a user on a **named tunnel** can run Cursor Agent with custom Codex or Claude models through ePort the same way they would expect from community Codex-only or Claude-only proxies — but from one dual-auth endpoint.

---

## User Stories

### Cursor Agent — core loop (both providers)

1. As a Cursor user running **Agent** with a Codex custom model, I want the proxy to stream `tool_calls` back to Cursor when the model invokes tools, so that the Agent loop continues instead of stopping after one text message.
2. As a Cursor user running **Agent** with a Claude custom model, I want the same `tool_calls` streaming behavior, so that Claude-routed Agent sessions work identically to Codex-routed ones from Cursor’s perspective.
3. As a Cursor user, I want `finish_reason: tool_calls` when the model ended the turn to invoke tools, so that Cursor does not treat the turn as a normal `stop` completion.
4. As a Cursor user, I want streaming tool **argument** deltas (partial JSON), so that Cursor can display in-progress tool calls without waiting for the full upstream event.
5. As a Cursor user on Codex routes, I want **custom_tool_call** (e.g. ApplyPatch) translated to OpenAI-shaped `tool_calls`, so that Cursor’s patch/edit tools work through subscription Codex.
6. As a Cursor user, I want tool **results** from prior turns forwarded correctly on the next request, so that multi-step Agent tasks retain context.
7. As a Cursor user, I want Agent to work whether Cursor sends **Chat Completions** or **Responses** bodies on the edge protocol, so that I do not reconfigure per Cursor version or feature.
8. As a Cursor user, I want one failed tool turn to surface a clear HTTP/SSE error rather than a silent truncated stream, so that I can distinguish proxy bugs from model refusals.

### Tool ingress — request normalization

9. As a Cursor user on Codex routes, I want Responses-shaped `input` items (`function_call`, `function_call_output`, `message`, reasoning items) sanitized and forwarded consistently, so that upstream Codex accepts multi-turn Agent history.
10. As a Cursor user on Codex routes, I want legacy chat-shaped `messages` with `tool_calls` and `tool` role converted to Responses input items when needed, so that older or mixed Cursor payloads still route.
11. As a Cursor user on Claude routes, I want Responses-shaped `function_call` / `function_call_output` items normalized to Anthropic `tool_use` / `tool_result` blocks, so that Claude sees correct tool history.
12. As a Cursor user on Claude routes, I want chat-shaped `messages` with `tool_calls`, `tool` role, and `tool_call_id` normalized — not only plain user/assistant text — so that Agent chat ingress works on Claude models.
13. As a Cursor user, I want `tools` and `tool_choice` from the edge body passed through to the appropriate upstream (Codex Responses tools vs Anthropic Messages tools), so that Cursor’s tool definitions reach the model.
14. As a Cursor user on Claude routes, I want OpenAI-style tool schemas converted to Anthropic tool format at the provider boundary, so that I do not need separate tool config per provider in Cursor.

### Tool egress — stream translation

15. As a Cursor user on Codex routes hitting `POST /v1/chat/completions`, I want Codex Responses SSE events (`output_item.added`, `function_call_arguments.delta`, `output_item.done`, `custom_tool_call_input.delta`) translated to chat completion chunks, so that Agent works on the chat path.
16. As a Cursor user on Codex routes hitting `POST /v1/responses`, I want native Responses SSE **passthrough** when the client used Responses ingress, so that latency stays low and tool items remain Responses-shaped.
17. As a Cursor user on Claude routes hitting `POST /v1/chat/completions`, I want Anthropic SSE (`content_block_start` for `tool_use`, `input_json_delta`, `message_stop` with `tool_use` stop reason) translated to OpenAI `tool_calls` chunks, so that Claude Agent works on the chat path.
18. As a Cursor user on Claude routes hitting `POST /v1/responses`, I want Anthropic tool blocks translated to Responses API tool events (not only `output_text.delta`), so that Responses-shaped Agent flows work on Claude.
19. As a Cursor user, I want assistant text and tool calls in the **same turn** when the model does both, so that Cursor renders narration plus tool invocation correctly.
20. As a Cursor user on Codex routes, I want `web_search_call` or other Codex output item types either translated or explicitly logged in verbose mode, so that new Cursor/Codex item types are diagnosable.

### Multimodal — images and attachments

21. As a Cursor user pasting an image into **Chat** on a Codex model, I want image content parts translated to Codex upstream input format, so that vision works on subscription Codex.
22. As a Cursor user pasting an image into **Agent** on a Codex model, I want the same translation, so that Agent can reason over screenshots and UI captures.
23. As a Cursor user pasting an image on a Claude model, I want parts translated to Anthropic image blocks (URL or base64) with known Cursor upload workarounds, so that Claude vision works through ePort.
24. As a Cursor user attaching files or non-text parts Cursor encodes oddly, I want ePort to apply vendor-documented workarounds (not silent drops), so that attachments do not become empty user messages.
25. As a Cursor user, I want multimodal translation covered by golden fixtures derived from real Cursor payload shapes, so that regressions are caught without live IDE tests in CI.

### Encrypted reasoning and thinking (Codex + Claude)

26. As a Cursor user on Codex routes, I want `reasoning.encrypted_content` from upstream echoed on the egress stream in the shape Cursor expects, so that reasoning blocks display and survive to the next turn.
27. As a Cursor user on Codex multi-turn Agent flows, I want prior reasoning items in the request forwarded unchanged upstream, so that Codex does not reject turns missing encrypted reasoning payloads.
28. As a Cursor user on Claude routes, I want thinking/reasoning streams translated without emitting Codex-only `xhigh` upstream, so that effort semantics stay provider-correct.
29. As a Cursor user on Claude routes, I want thinking blocks handled on egress where Cursor expects reasoning-like display, within Anthropic subscription constraints.

### Session continuity

30. As a Cursor user on Codex routes, I want `session_id` header aligned with body `prompt_cache_key` when Cursor supplies it, so that cache and session continuity match Codex CLI behavior.
31. As a Cursor user, I want client-supplied `prompt_cache_key` preferred over proxy-generated installation ids, so that Cursor controls session scope across turns.
32. As a power user, I want optional strengthened session resume (parent fingerprint / related-turn matching) when Cursor does not resend explicit keys, so that long Agent threads degrade gracefully rather than randomly resetting context.

### Edge protocol and routing (unchanged contract, fuller behavior)

33. As a Cursor user, I want **model resolver** routing unchanged — Agent parity must not break suffix grammar, alias normalize, or dual-provider dispatch.
34. As a Cursor user, I want **proxy API key** gating unchanged on public tunnels during Agent traffic, so that security model stays consistent.
35. As a Cursor user, I want **GET /health** and **GET /v1/models** behavior unchanged, so that Verify and model discovery keep working while Agent parity lands.

### Observability and debugging

36. As a developer debugging Agent failures, I want `--verbose` to log unhandled SSE event types and edge path (`chat` vs `responses`), so that I can see dropped events quickly.
37. As a developer, I want structured one-line logs to include whether the turn ended with `stop` or `tool_calls`, so that production logs show Agent health without full body dumps.
38. As a user, I want `eport status` (slice 17) to remain the place for tunnel/auth/catalog summary; Agent parity adds no new CLI commands unless debugging flags are extended.

### Reliability interaction (account queue — slice 08)

39. As a power user running long Agent sessions, I want 429/401 on tool-heavy turns to trigger account refresh/rotation per ADR 0002, so that Agent retries do not require restarting Cursor.
40. As a user, I want a single retry after auth recovery on upstream errors during Agent streams, so that transient token expiry does not kill an entire Agent run.

### Manual validation (HITL — slice 17)

41. As a release verifier, I want a manual Cursor checklist item: **Agent on Codex model** over named HTTPS tunnel completes at least one tool-using turn (edit or terminal), so that P0 tool egress is proven outside CI.
42. As a release verifier, I want the same checklist for **Agent on Claude model**, so that dual-provider parity is confirmed.
43. As a release verifier, I want checklist items for **image paste** on Codex and Claude routes in Chat, so that multimodal ingress is spot-checked.
44. As a release verifier, I want **multi-turn Chat** (non-Agent) with follow-up messages after a tool-less reply, so that basic continuity is distinguished from Agent tool loops.

---

## Implementation Decisions

### Placement in the slice roadmap

This PRD describes work that is **required for ePort v1 Agent claims** in [eport-v1.md](./eport-v1.md) but was **not fully delivered** in slices 04–07. It lands as slices **11–16** (AFK) before slice **17** (multimodal/status polish + manual Agent checklist). Slice 08 (account queue) and slice 09 (config) remain parallel; they improve Agent reliability but do not replace tool-stream translation.

### Deep modules to build or extend

| Module | Responsibility | Provider scope |
|--------|----------------|----------------|
| **Codex egress translator** | Map Codex Responses SSE → OpenAI chat chunks and/or passthrough Responses SSE; handle text, tools, custom tools, reasoning, completion semantics | Codex only |
| **Claude egress translator** | Map Anthropic Messages SSE → OpenAI chat chunks and Responses events; handle text, tool_use, thinking | Claude only |
| **Edge ingress normalizer** | Unify Chat vs Responses bodies into provider-internal request models; tool history, tools defs, multimodal parts | Both; provider-specific downstream |
| **Multimodal part mapper** | Cursor/OpenAI content parts → Codex input items or Anthropic blocks; attachment workarounds | Both |
| **Session continuity helper** | Resolve `prompt_cache_key` / session id; optional fingerprint-based resume | Codex primary; Claude N/A for same headers |
| **Edge router** (thin) | Select passthrough vs translate per `edgeShape` and provider; no business logic duplication | Both |

Each module should be testable with **golden SSE fixtures** and **golden JSON request fixtures** without live upstream calls.

### Codex egress translator — decisions

- **Chat path (`edgeShape: chat`):** Implement full Responses→chat translation parity with `codex-cursor` behavior: track tool slots by upstream `item_id`; emit `tool_calls` start, argument deltas, and fallback `output_item.done` full arguments; set `finish_reason` to `tool_calls` when any tool item appeared in the turn.
- **Support `custom_tool_call`** in addition to `function_call` — Cursor ApplyPatch depends on this.
- **Support `response.custom_tool_call_input.delta`** in addition to `function_call_arguments.delta`.
- **Reasoning:** Forward `reasoning` / encrypted content items on egress in the OpenAI chunk shape Cursor consumes (vendor: `codex-cursor`, `codex-proxy-ts` codex-to-openai stream).
- **Responses path (`edgeShape: responses`):** Keep **passthrough** of Codex SSE when ingress was Responses-shaped; do not run lossy chat translation on this path.
- **Usage:** Optionally attach usage on final chunk when `response.completed` includes token counts (vendor: `codex-cursor-proxy-lt`).

### Claude egress translator — decisions

- **Chat path:** Map Anthropic `content_block_start` (`tool_use`), `input_json_delta`, and `message_delta` / `message_stop` to OpenAI streaming `tool_calls` (vendor: `ccproxypal` adapter).
- **Responses path:** Extend current Responses-event mapping beyond `output_text.delta` to include tool-related Responses events analogous to Codex item types, so Responses ingress gets Responses egress.
- **Never emit `xhigh`** on Anthropic requests (existing ADR; unchanged).
- **Beta headers:** Keep Claude Code OAuth beta header set on upstream Messages API calls.

### Edge ingress normalizer — decisions

- **Codex:** Continue Responses-first sanitization (allowed fields, `store: false`, `include: reasoning.encrypted_content`, `parallel_tool_calls`). Add chat→Responses conversion for `messages[]` with `tool_calls` / `tool` role when body lacks `input` array (vendor: `codex-proxy-ts` openai-to-codex).
- **Claude:** Extend chat `messages` normalization to cover `tool_calls`, `tool` role, and `tool_call_id` — today Responses `input` path is richer than chat `messages` path; both must reach parity.
- **Tools array:** Pass through on both shapes; translate schema at Claude boundary only.
- **Reject** invalid multimodal with clear 400 when a part cannot be mapped and no workaround exists (prefer loud failure over silent empty content).

### Multimodal part mapper — decisions

- **Supported part types v1:** `text`, `input_text`, `image_url` / `input_image`, inline base64 images where Cursor sends them.
- **Codex:** Map to Responses input content items Codex subscription accepts.
- **Claude:** Map to `image` blocks with `url` or `base64` source; apply ccproxypal-style URL fixes when Cursor sends malformed or relative URLs.
- **Attachments:** Best-effort text extraction or documented skip with verbose warning; full attachment parity may trail images in the same slice if fixtures demand phasing.

### Session continuity — decisions

- **Baseline (already partially implemented):** Client `prompt_cache_key` wins; `session_id` header matches it on Codex upstream.
- **Enhancement (optional P2 within this PRD):** Port lightweight session resume ideas from `codex-api` session manager (parent fingerprint → reuse session id) only if Agent tests show Cursor omitting keys on follow-up turns.

### Interface sketches (decision-rich, not full implementations)

**Codex egress translator**

```typescript
interface CodexEgressTranslator {
  streamToChatChunks(
    upstream: ReadableStream<Uint8Array>,
    ctx: { clientModel: string }
  ): AsyncIterable<string>; // SSE lines

  passthroughResponses(upstream: Response): Response;
}
```

**Claude egress translator**

```typescript
interface ClaudeEgressTranslator {
  streamToChatChunks(
    upstream: ReadableStream<Uint8Array>,
    ctx: { clientModel: string }
  ): AsyncIterable<string>;

  streamToResponsesEvents(
    upstream: ReadableStream<Uint8Array>,
    ctx: { clientModel: string }
  ): AsyncIterable<string>;
}
```

**Edge ingress normalizer**

```typescript
interface NormalizedEdgeRequest {
  provider: "codex" | "claude";
  edgeShape: "chat" | "responses";
  messages: NormalizedTurn[]; // text, tools, multimodal parts
  tools?: ToolDefinition[];
  toolChoice?: unknown;
  sessionKey?: string;
  stream: boolean;
}
```

### Vendor borrow matrix (patterns only)

| Capability | Primary vendor reference |
|------------|------------------------|
| Codex tool SSE → chat | `codex-cursor` server stream helpers; `codex-proxy-ts` `codex-to-openai.ts` |
| Codex chat messages → Responses input | `codex-proxy-ts` `openai-to-codex.ts` |
| Claude tool SSE → chat | `ccproxypal` `adapter.js` / `adapter.rs` |
| Claude OpenAI messages → Anthropic | `ccproxypal`; `codex-proxy-ts` `codex-request-to-anthropic.ts` (tool blocks) |
| Multimodal + image quirks | `ccproxypal`; `codex-proxy-ts` `anthropic-to-codex.ts` image injection notes |
| Session fingerprint resume | `codex-api` session manager (optional) |

Do not copy `codex-proxy-ts` wholesale (license/weight). Extract fixtures and behavior tables.

### Non-goals within this PRD’s implementation

- Changing **model resolver** suffix/alias rules.
- New upstream providers.
- Cursor Agent **outbound** routing (Claude Code → Cursor API) — wrong direction per v1 out-of-scope.
- Subprocess Claude CLI per request.

---

## Testing Decisions

### What makes a good test

- Assert **HTTP/SSE wire behavior** visible to Cursor: chunk sequences, `finish_reason`, tool call ids, error bodies.
- Use **golden fixtures** recorded from vendor tests or sanitized Cursor captures — not snapshots of internal parser state.
- Table-driven cases for: text-only turn, single tool call, parallel tool calls, text+tool same turn, custom_tool_call, tool result on follow-up request.
- Do **not** require live Cursor, live tunnel, or live OAuth in CI.

### Modules that must have automated tests

| Module | Priority | Focus |
|--------|----------|-------|
| **Codex egress translator** | P0 | Tool start/delta/done; custom_tool_call; finish_reason; text-only regression; reasoning chunk presence |
| **Claude egress translator** | P0 | tool_use streaming; chat + Responses egress shapes; no xhigh in upstream fixture assertions |
| **Edge ingress normalizer** | P0 | Chat messages with tool_calls/tool role; Responses function_call/output; multimodal parts |
| **Multimodal part mapper** | P1 | Image URL and base64 golden parts → Codex and Anthropic shapes |
| **Edge router** | P1 | Agent fixture requests route to correct provider; chat vs responses dispatch unchanged |
| **Session continuity helper** | P2 | prompt_cache_key preference; session_id header alignment on mocked upstream |

### Prior art

- `vendors/codex-proxy-ts/tests/unit/translation/` — OpenAI↔Codex tool round-trip fixtures.
- `vendors/codex-cursor/src/server.ts` — tool call chunk formatting reference tests to port as golden expected SSE strings.
- `tests/claude/translator.test.ts` — extend with tool stream and multimodal ingress cases in ePort tree.
- `tests/edge/router.test.ts` — add Agent-style mocked upstream SSE integration tests.

### Manual tests (slice 17 HITL)

- Named tunnel, Verify, Codex Agent tool turn, Claude Agent tool turn, image paste Chat on both providers, multi-turn Chat without tools.

---

## Out of Scope

| Item | Notes |
|------|-------|
| **Live Cursor IDE automation in CI** | Manual checklist only |
| **Embeddings, images API, audio** | Not part of Cursor Agent chat surface for v1 |
| **Third-party upstreams** | Gemini, OpenRouter, Ollama, Cursor Agent API |
| **Anthropic `/v1/messages` as Cursor-facing edge** | OpenAI-compatible surface only |
| **Full attachment format matrix** | Every exotic Cursor upload type; best-effort with explicit gaps documented |
| **Performance benchmarking** | Latency vs direct proxy — manual acceptable |
| **Team dashboard / multi-user** | Unchanged from v1 |

---

## Further Notes

### Current gap summary (post slice 07)

| Area | Codex today | Claude today |
|------|-------------|--------------|
| Text streaming | Works | Works |
| Tool egress on chat path | Missing | Missing |
| Tool ingress on chat path | Partial (Responses `input` ok) | Incomplete (`messages` ignores tools) |
| Tool egress on responses path | Passthrough (good if Cursor uses path) | Text-only translation |
| Encrypted reasoning egress | Incomplete on chat path | N/A (thinking model differs) |
| Multimodal | Minimal | Minimal |
| Agent end-to-end | Not validated | Not validated |

### Relationship to [eport-v1.md](./eport-v1.md)

Parent PRD user stories **29, 34–35, 38, 40–41, 45** assume this behavior. This document makes the **Agent/tool/multimodal gap** explicit and implementation-ready. Slice 17 remains the **HITL** gate for “chat + agent on Codex and Claude routes.”

### Suggested implementation order

1. **Codex egress tool translation** (chat path) — slice **11**
2. **Claude ingress tool normalization** + **Claude egress tool translation** — slice **13**
3. **Codex chat ingress** tool message conversion — slice **12**
4. **Encrypted reasoning egress** (Codex chat path) — slice **14**
5. **Multimodal golden fixtures** (both providers) — slice **15**
6. **Agent observability + optional session resume** — slice **16**

See **[ISSUES/cursor-agent-parity-issues.md](../ISSUES/cursor-agent-parity-issues.md)** for full slice list (11–16).

### Documentation updates after implementation

- README troubleshooting: “Agent stops after one message” → point to tool-stream requirements and verbose logging.
- CONTEXT.md: add **Agent loop** glossary entry referencing tool egress ingress parity.
