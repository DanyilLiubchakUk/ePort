# Service installer

## Purpose

**Service mode** — OS auto-start for proxy and tunnel without an open terminal: Windows scheduled task (`schtasks`) and macOS launchd user agent.

## Contains

`ServiceInstaller` (`install`, `uninstall`, `start`, `stop`, `restart`, `status`); platform-specific registration; status reporting; verbose log tail.

## Notes

Install invokes the same entrypoint as `eport up` with saved config; uninstall removes registration only — config and auth persist.
