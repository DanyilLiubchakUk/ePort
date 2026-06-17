# npm bin entry

## Purpose

Future package `bin` field target: thin executable shim that launches the compiled `eport` CLI (`node` or `bun` runner) for global `npm i -g eport` installs.

## Will contain

`eport` executable stub (e.g. `cli.cjs` or shebang script) delegating to `src/cli/`; no business logic.

## Blocked by / ISSUES slice

[01 — CLI skeleton, config store, init, api-key](../docs/ISSUES/01-cli-skeleton-config-init-api-key.md) (package publish wiring).

## Notes

`package.json` `bin` mapping will point here once the npm package scaffold lands — not added until slice 01 implementation starts.
