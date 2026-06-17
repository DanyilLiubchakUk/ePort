## Parent
docs/prd/eport-v1.md

## What to build
Cross-platform service installer: `eport service install|uninstall|start|stop|restart|status`. macOS launchd user agent; Windows schtasks logon trigger. Install invokes same entrypoint as `eport up` with saved config (named tunnel expected). Uninstall removes OS registration only — config and auth preserved. Warn against install with quick tunnel mode. Windows elevated-shell guidance on schtasks access denied. Verbose `eport service status` includes log tail.

## Acceptance criteria
- [ ] `eport service install` registers auto-start on macOS (launchd) and Windows (schtasks)
- [ ] `eport service start|stop|restart|status|uninstall` manage lifecycle from CLI
- [ ] Installed service runs proxy + named tunnel using saved config profile
- [ ] CLI warns when attempting service install with quick tunnel as default mode
- [ ] Windows: clear guidance to re-run from elevated shell on access denied
- [ ] `eport service status` reports OS service state; verbose mode includes log tail
- [ ] Uninstall removes registration only; does not delete `~/.eport/` config or auth
- [ ] P2 service installer tests: mock OS commands on CI; platform smoke where CI allows

## Blocked by
- ISSUES/05-tunnel-manager-up-paste-block.md
