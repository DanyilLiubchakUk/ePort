## Parent
docs/prd/eport-v1.md

## What to build
Tunnel manager with named, quick, and none modes integrated into `eport up`. Named mode runs `cloudflared` with saved token and stable hostname, reconnecting on drop. Quick mode spawns ephemeral `*.trycloudflare.com`. None mode runs local proxy only. CLI: `eport tunnel setup named` (token + hostname prompts → config), `eport tunnel setup quick`, interactive `eport tunnel setup`, session override `eport up --tunnel quick|named|none` without mutating saved config. On successful public tunnel start, print Cursor copy-paste block: Base URL ending in `/v1`, proxy API key, suggested custom models. Warn that quick tunnel URLs change every restart.

## Acceptance criteria
- [ ] Named mode: start/stop `cloudflared` with config token; stable `https://<hostname>/v1` public Base URL; reconnect on drop
- [ ] Quick mode: ephemeral `*.trycloudflare.com` URL per run; CLI/README warn URL changes on restart
- [ ] None mode: no tunnel process; public URL null; local proxy only
- [ ] `eport tunnel setup named|quick` and interactive wizard persist defaults to config profile
- [ ] `eport up` defaults to named tunnel; `--tunnel` session override does not persist to config
- [ ] `eport up` prints copy-paste block (Base URL `/v1`, API key, suggested models) when public URL available
- [ ] Proxy API key auto-generated on first `eport up` if missing (init path)
- [ ] P2 tunnel manager tests: mode selection, URL composition, none returns null public URL
- [ ] Document Cloudflare free tier vs optional paid domain in setup guidance

## Blocked by
- ISSUES/04-codex-edge-route-local-up.md
