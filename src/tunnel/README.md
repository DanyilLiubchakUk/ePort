# Tunnel manager

## Purpose

Expose the local proxy on public HTTPS via Cloudflare: **named** (stable hostname), **quick** (ephemeral `*.trycloudflare.com`), or **none** (user-supplied external URL).

## Will contain

`TunnelManager` (`start`, `stop`, `status`); `cloudflared` process lifecycle; token and hostname persistence; session override via `eport up --tunnel`; public Base URL composition for Cursor paste block.

## Blocked by / ISSUES slice

[05 — tunnel manager + up paste block](../../docs/ISSUES/05-tunnel-manager-up-paste-block.md).

## Notes

Warn when service install is combined with quick mode; named tunnel is the expected default for production use.
