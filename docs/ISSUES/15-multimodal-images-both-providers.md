## Parent
docs/prd/cursor-agent-parity.md

## What to build
**Multimodal image ingress** on Codex and Claude routes: translate Cursor content parts (`input_text`, `input_image`, `image_url`, base64) into Codex Responses input items and Anthropic image blocks. Apply known Cursor upload workarounds (malformed URLs, attachment quirks) per ccproxypal / codex-proxy-ts patterns — loud 400 or verbose warning when a part cannot be mapped (no silent empty user messages). Golden fixtures for both providers. Overlaps slice 17 multimodal acceptance; this slice is the implementation tracer bullet.

## Acceptance criteria
- [ ] Codex route: request fixture with image part produces upstream body with correct image/input content (mocked dispatch test)
- [ ] Claude route: same fixture shape produces Anthropic `image` block (url or base64 source)
- [ ] Text-only requests unchanged; invalid unmappable part returns clear error or verbose skip per PRD
- [ ] P0 golden fixture tests per provider for at least URL image and base64 image
- [ ] P1 edge tests route multimodal Codex vs Claude models to correct upstream shape

## Blocked by
- ISSUES/06-claude-auth-translator-dual-routing.md
- ISSUES/11-codex-agent-tool-streams.md
- ISSUES/13-claude-agent-tool-loop.md
