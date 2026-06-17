# Claude translator

## Purpose

Provider boundary for Claude routes: convert normalized internal request (from Chat Completions or Responses edge shape) to Anthropic Messages API; stream Anthropic SSE back to the OpenAI shape the client used.

## Will contain

`ClaudeTranslator` (`translateRequest`, `translateStream`); dual ingress parsers; effort/thinking mapping to Anthropic-native parameters (never emit Codex `xhigh`); image/attachment workarounds; direct HTTPS to `api.anthropic.com`.

## Blocked by / ISSUES slice

[06 — Claude auth, translator, dual routing](../../docs/ISSUES/06-claude-auth-translator-dual-routing.md); multimodal edges in [11](../../docs/ISSUES/11-multimodal-status-cli-help-polish.md).

## Notes

Accepts both edge protocols per ADR 0001 path B; retries once on 429/401 via auth manager.
