## Parent
docs/prd/eport-v1.md

## What to build
Ship the npm/bun-distributed CLI skeleton with global flags (`--help`, `--version`, `--verbose`, `--tunnel`, `--fast`), a persisted config store at `~/.eport/config`, and the first-run lifecycle commands. `eport init` creates the config directory and auto-generates a cryptographically random proxy API key when missing. `eport api-key show` prints the current key; `eport api-key rotate` invalidates the old key immediately, saves a new one, and prints a Cursor-oriented paste reminder (full paste block comes in slice 05). Session overrides from global flags must not write to the saved config profile.

## Acceptance criteria
- [ ] Package installs and runs via `npm i -g eport` / `bunx eport`; `eport --version` prints package version
- [ ] Global flags documented and parsed consistently across top-level commands (per CLI-HELP)
- [ ] `eport init` creates `~/.eport/` and generates proxy API key on first run if none exists
- [ ] Config store loads/saves proxy API key and empty defaults without requiring hand-editing
- [ ] `eport api-key show` displays current key; `eport api-key rotate` invalidates old key and prints new key
- [ ] Config store P1 tests: init writes expected profile; rotate changes key; session flag parsing does not persist overrides
- [ ] CLI integration test with temp `HOME`: `eport init` + `eport api-key show|rotate` exit 0 with expected stdout

## Blocked by
None - can start immediately
