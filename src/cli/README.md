# CLI layer

## Purpose

User-facing `eport` command: parses argv, dispatches subcommands, prints Cursor paste blocks, flag equivalents, and NEXT STEPS guidance per [docs/CLI-HELP.md](../../docs/CLI-HELP.md).

## Will contain

Command handlers for `up`, `init`, `status`, `auth`, `accounts`, `api-key`, `config`, `tunnel`, and `service`; shared output helpers; orchestration wiring to config, auth, tunnel, edge, and service modules.

## Blocked by / ISSUES slice

[01 — CLI skeleton, config store, init, api-key](../../docs/ISSUES/01-cli-skeleton-config-init-api-key.md); help text parity in [11 — multimodal, status, CLI-HELP polish](../../docs/ISSUES/11-multimodal-status-cli-help-polish.md).

## Notes

No hot-path request logic here — CLI only starts or configures long-running modules.
