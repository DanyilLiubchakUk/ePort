# Cursor Agent parity — issue breakdown

Parent PRD: [docs/prd/cursor-agent-parity.md](../prd/cursor-agent-parity.md)

Dependency-ordered vertical slices **11–16** (Agent tool loops, reasoning, multimodal images, observability). Slice **17** manual Cursor checklist depends on **11, 12, 13, 15** completing first.

| # | Title | Type | Blocked by | PRD stories (approx) |
|---|-------|------|------------|----------------------|
| 11 | [Codex Agent tool streams](11-codex-agent-tool-streams.md) | AFK | 04, 07 | 1, 3–5, 15–16, 20 |
| 12 | [Codex Agent tool ingress](12-codex-agent-tool-ingress.md) | AFK | 11 | 6, 9–10, 13, 27 |
| 13 | [Claude Agent tool loop](13-claude-agent-tool-loop.md) | AFK | 06, 11 | 2, 11–14, 17–19 |
| 14 | [Codex reasoning round-trip](14-codex-reasoning-round-trip.md) | AFK | 11 | 26–27 |
| 15 | [Multimodal images both providers](15-multimodal-images-both-providers.md) | AFK | 06, 11, 13 | 21–25 |
| 16 | [Agent observability + session](16-agent-observability-session.md) | AFK | 11, 13 | 30–32, 36–37 |

**Suggested grab order after slice 07:** 11 → 12 and 13 (13 after 11) → 14 → 15 → 16. Slices 08–10 can run in parallel with 11–16.

**Slice 17** ([17-multimodal-status-cli-help-polish.md](17-multimodal-status-cli-help-polish.md)) remains the HITL gate; blocked by 11, 12, 13, 15 for Agent checklist items.

---

## Slice summaries

### 11 — Codex Agent tool streams
Tool egress on chat path; responses passthrough for tools; `custom_tool_call` / ApplyPatch.

### 12 — Codex Agent tool ingress
Multi-turn tool history; chat `messages` → Responses `input` conversion.

### 13 — Claude Agent tool loop
Claude ingress + egress tool parity on both edge shapes.

### 14 — Codex reasoning round-trip
Encrypted reasoning on chat egress + request forward.

### 15 — Multimodal images both providers
Image parts Codex + Claude with golden fixtures.

### 16 — Agent observability + session
Logs, verbose unhandled events, session key regression; optional fingerprint resume.
