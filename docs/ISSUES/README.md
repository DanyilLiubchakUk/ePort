# ePort v1 — Implementation slices

Dependency-ordered vertical slices for [docs/prd/eport-v1.md](../docs/prd/eport-v1.md). Each slice is an end-to-end tracer bullet; completing slice 17 delivers fully working ePort v1.

| # | Title | Type | Blocked by | User stories |
|---|-------|------|------------|--------------|
| 01 | [CLI skeleton, config store, init, api-key](01-cli-skeleton-config-init-api-key.md) | AFK | None | 1–5, 67–70 |
| 02 | [Model resolver + unit tests](02-model-resolver-unit-tests.md) | AFK | 01 | 28, 42–44, 46–53, 89 |
| 03 | [Codex hybrid auth + login/status](03-codex-hybrid-auth-login-status.md) | AFK | 01 | 6, 8–9, 11–14, 87 |
| 04 | [Codex edge route (local `--tunnel none`)](04-codex-edge-route-local-up.md) | AFK | 01, 02, 03 | 24 (partial), 26, 32–36, 74–77, 91 |
| 05 | [Tunnel manager + up paste block](05-tunnel-manager-up-paste-block.md) | AFK | 04 | 15–27, 29, 67 |
| 06 | [Claude auth, translator, dual routing](06-claude-auth-translator-dual-routing.md) | AFK | 04 | 7, 10, 14, 39–45 |
| 07 | [Dynamic GET /v1/models catalog](07-dynamic-models-catalog.md) | AFK | 03, 06 | 30–31, 78, 89 |
| 08 | [Account queue + rotation](08-account-queue-rotation.md) | AFK | 03 | 58–66 |
| 09 | [Config wizard + flag equivalents](09-config-wizard-flag-equivalents.md) | AFK | 01, 02 | 46–56, 92 |
| 10 | [Service install (Windows + macOS)](10-service-install-windows-macos.md) | AFK | 05 | 79–84 |
| 11 | [Codex Agent tool streams](11-codex-agent-tool-streams.md) | AFK | 04, 07 | Agent parity 1, 3–5, 15–16, 20 |
| 12 | [Codex Agent tool ingress](12-codex-agent-tool-ingress.md) | AFK | 11 | Agent parity 6, 9–10, 13, 27 |
| 13 | [Claude Agent tool loop](13-claude-agent-tool-loop.md) | AFK | 06, 11 | Agent parity 2, 11–14, 17–19 |
| 14 | [Codex reasoning round-trip](14-codex-reasoning-round-trip.md) | AFK | 11 | Agent parity 26–27 |
| 15 | [Multimodal images both providers](15-multimodal-images-both-providers.md) | AFK | 06, 11, 13 | Agent parity 21–25 |
| 16 | [Agent observability + session](16-agent-observability-session.md) | AFK | 11, 13 | Agent parity 30–32, 36–37 |
| 17 | [Multimodal, status polish, CLI-HELP parity](17-multimodal-status-cli-help-polish.md) | HITL | 05, 06, 07, 08, 09, **11, 12, 13, 15** | 37–38, 71–78, 4–5, 41–44 |

**Legend:** AFK = implement and verify without human interaction. HITL = includes manual Cursor smoke test checklist (slice 17).

**Suggested grab order:** 01 → 02 → 03 → 04 → 05 and 06 in parallel after 04 → 07, 08, 09 in parallel where unblocked → **11 → 12, 13 → 14 → 15 → 16** → 10 → 17.

**Agent parity detail:** [cursor-agent-parity-issues.md](cursor-agent-parity-issues.md) · PRD [cursor-agent-parity.md](../prd/cursor-agent-parity.md)
