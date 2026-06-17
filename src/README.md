# ePort application source

## Purpose

Root of the ePort v1 implementation: local OpenAI-compatible proxy that routes Cursor traffic through Codex and Claude subscriptions. Modules follow [docs/prd/eport-v1.md](../docs/prd/eport-v1.md) Implementation Decisions.

## Module map

| Directory | Responsibility |
|-----------|----------------|
| `cli/` | `eport` command entry, subcommands, `--help` wiring |
| `config/` | `~/.eport/config` load/save, profiles, API key, flag equivalents |
| `auth/` | Hybrid dual auth, token refresh, account queue rotation |
| `tunnel/` | Named / quick / none `cloudflared` lifecycle |
| `edge/` | HTTP server, edge router, BYOK health, API key gate |
| `resolver/` | Model alias normalize, suffix parse, effort precedence |
| `providers/codex/` | Codex upstream client, session continuity, encrypted reasoning |
| `providers/claude/` | OpenAI→Anthropic translator, both edge shapes |
| `service/` | Windows `schtasks` + macOS `launchd` install |

## Build order

Implement in dependency order per [docs/ISSUES/README.md](../docs/ISSUES/README.md): 01 → 02 → 03 → 04 → 05/06 → 07/08/09 → 10 → 11.

## Notes

`vendors/`, `CONTEXT.md`, and `docs/` are temporary research artifacts to be removed before user-facing release. The shipped product is `src/` plus the root user README only.
