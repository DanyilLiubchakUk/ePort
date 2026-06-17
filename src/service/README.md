# Service installer

## Purpose

**Service mode** — OS auto-start for proxy and tunnel without an open terminal: Windows scheduled task (`schtasks`) and macOS launchd user agent.

## Will contain

`ServiceInstaller` (`install`, `uninstall`, `start`, `stop`, `restart`, `status`); platform-specific registration; status reporting (service state, tunnel URL, auth summary); verbose log tail option.

## Blocked by / ISSUES slice

[10 — service install (Windows + macOS)](../../docs/ISSUES/10-service-install-windows-macos.md).

## Notes

Install invokes the same entrypoint as `eport up` with saved config; uninstall removes registration only — config and auth persist.
