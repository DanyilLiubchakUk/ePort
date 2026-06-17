## Parent
docs/prd/eport-v1.md

## What to build
Final v1 polish: multimodal translation on Codex and Claude routes (text, images, attachments with known Cursor upload workarounds), full `eport status` / `eport status --json` (proxy state, tunnel URL/mode, auth expiry, active accounts, config summary, Codex usage windows when available, catalog age/count), structured one-line request logs and verbose dumps, CLI-HELP parity for all commands (`--help` text matches spec). Manual Cursor smoke checklist confirms Verify, chat, and agent flows over public HTTPS Base URL.

## Acceptance criteria
- [ ] Codex routes translate Cursor multimodal content parts to upstream format (golden fixture tests)
- [ ] Claude routes translate multimodal parts to Anthropic message blocks including image workarounds
- [ ] `eport status` reports running state, tunnel URL/mode, auth expiry, active accounts, config summary, Codex usage windows when available
- [ ] `eport status --json` emits machine-readable equivalent for scripting
- [ ] Catalog staleness warning in status when dynamic catalog is aged
- [ ] Default one-line structured request logs; `--verbose` enables full request/upstream dumps
- [ ] CLI `--help` for all commands matches docs/CLI-HELP.md (subprocess integration tests)
- [ ] Manual Cursor checklist completed: named tunnel, Verify via `/health`, custom models, chat + agent on Codex and Claude routes
- [ ] npm package ready for publish (engines Node 20+ / Bun 1.1+ documented)

## Blocked by
- ISSUES/05-tunnel-manager-up-paste-block.md
- ISSUES/06-claude-auth-translator-dual-routing.md
- ISSUES/07-dynamic-models-catalog.md
- ISSUES/08-account-queue-rotation.md
- ISSUES/09-config-wizard-flag-equivalents.md
