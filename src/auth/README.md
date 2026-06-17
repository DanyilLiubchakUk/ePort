# Auth manager

## Purpose

Credential lifecycle for **dual auth** (Codex + Claude): hybrid CLI reuse when fresh, ePort OAuth fallback, proactive coalesced refresh, and **account queue** rotation on upstream 429/401.

## Will contain

`AuthManager` (`getCredentials`, `handleUpstreamError`, `status`, `login`); per-provider ordered account lists; hybrid reads from `~/.codex/auth.json` and Claude Code stores; background refresh scheduler.

## Blocked by / ISSUES slice

Codex hybrid login in [03 — Codex hybrid auth + login/status](../../docs/ISSUES/03-codex-hybrid-auth-login-status.md); queue rotation in [08 — account queue + rotation](../../docs/ISSUES/08-account-queue-rotation.md). Claude auth extends in [06](../../docs/ISSUES/06-claude-auth-translator-dual-routing.md).

## Notes

Rotation promotes the next account on 429; 401 refreshes current first, then promotes — retry once per ADR 0002.
