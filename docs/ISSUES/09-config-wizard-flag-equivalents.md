## Parent
docs/prd/eport-v1.md

## What to build
Full config CLI beyond init: flag one-liners (`eport config model gpt-5.5 --effort xhigh`, `eport config model opus-4.8 --effort max`, `eport config --fast on|off`, `eport config --tunnel named|quick|none`) and interactive `eport config` wizard with provider-aware effort radios and Codex-only fast checkbox. Wizard always prints flag equivalent one-liner on completion. Per-model default effort profiles and global fast override persist to config; session `eport up --fast` and `--tunnel` overrides do not mutate saved profile.

## Acceptance criteria
- [ ] Flag one-liners write equivalent config profile entries for model defaults, global fast, default tunnel mode
- [ ] Interactive wizard guides provider-aware effort selection and Codex fast toggle
- [ ] Wizard completion prints copy-paste flag equivalent matching saved settings
- [ ] Effort config values are provider-appropriate (Codex `xhigh` vs Claude `max`; no `xhigh` on Claude models)
- [ ] `eport config --tunnel named|quick|none` persists default tunnel mode for subsequent `eport up`
- [ ] `eport up --fast` and `eport up --tunnel *` are session-only and do not corrupt saved config
- [ ] Config store P1 tests: wizard vs flags produce equivalent profile; session overrides do not persist
- [ ] All settings manageable via CLI without hand-editing `~/.eport/config`

## Blocked by
- ISSUES/01-cli-skeleton-config-init-api-key.md
- ISSUES/02-model-resolver-unit-tests.md
