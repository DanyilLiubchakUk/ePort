# ePort CLI — `--help` specification

Copy-paste ready help text for each command. Implementation should match these blocks verbatim (modulo dynamic values like version strings and detected paths).

---

## Global flags

These flags apply to `eport up` and other run commands where noted.

```
GLOBAL FLAGS

  --tunnel <mode>    Tunnel mode: ngrok (default), named, quick, or none
  --fast             Force Codex priority (fast) tier for this session
  --verbose          Verbose logging (request details, tunnel output)

  -h, --help         Show help for the current command
  -V, --version      Print version
```

---

## `eport`

```
NAME
  eport — Route Cursor through Codex and Claude subscriptions

SYNOPSIS
  eport [command] [options]

DESCRIPTION
  ePort is a local OpenAI-compatible proxy for Cursor (and other clients).
  It forwards requests to ChatGPT/Codex and Claude Max using subscription
  auth — no metered API keys. Cursor requires a public HTTPS URL; ePort
  exposes one via ngrok or Cloudflare tunnel (ngrok by default).

COMMANDS
  up                 Start the proxy and tunnel (default workflow)
  init               Initialize ~/.eport config (API key, defaults)
  status             Show proxy, auth, tunnel, and config summary
  auth               Manage subscription login (Codex + Claude)
  accounts           Manage multi-account queues (list, add, switch, reorder)
  api-key            Show or rotate the proxy API key for Cursor
  config             Set model defaults and global options
  tunnel             Configure ngrok or Cloudflare tunnel
  service            Install and control background service (macOS/Windows)

EXAMPLES
  eport up
  eport init
  eport auth login
  eport api-key show
  eport config
  eport tunnel setup ngrok
  eport service install

NEXT STEPS
  New install? Run:  eport init  →  eport auth login  →  eport config  →  eport tunnel setup ngrok  →  eport up
  Then paste the printed block into Cursor → Settings → Models → OpenAI.
  See README.md for ngrok/static-domain setup and Cursor custom models.

LOCAL CHECKOUT TIP
  Developing from this repo? Add an alias so eport uses local source:
  alias eport='bun run /path/to/ePort/src/cli/index.ts'
  Then future commands can be short, e.g. eport up
```

---

## `eport up`

```
NAME
  eport up — Start proxy and tunnel

SYNOPSIS
  eport up [options]

DESCRIPTION
  Starts the local OpenAI-compatible HTTP server and connects the configured
  configured public tunnel (ngrok mode by default). Prints a copy-paste block with
  Base URL, API key, and suggested custom models for Cursor.

  On first run (or if no key exists), auto-generates a cryptographically
  random proxy API key and saves it to ~/.eport/config. Use eport api-key
  show or eport api-key rotate to manage the key later.

  Applies saved config profile defaults (per-model effort, global fast
  override, tunnel mode). Session flags override without saving.

OPTIONS
  --tunnel <mode>    ngrok (default) | named | quick | none
  --fast             Force Codex priority tier for this session only
  --verbose          Verbose request and tunnel logs
  --port <n>         Local listen port (default: 8787)

EXAMPLES
  eport up
  eport up --tunnel ngrok
  eport up --tunnel quick
  eport up --tunnel named --fast
  eport up --tunnel none --port 8787

NEXT STEPS
  1. Copy the printed Base URL and API key.
  2. Cursor → Settings → Models → OpenAI → Override Base URL.
  3. Paste Base URL (must end with /v1), enter API key, click Verify.
  4. Add custom models (e.g. gpt-5.5, gpt-5.5xhigh-fast, opus-4.8max).
  5. Optional: eport service install  to keep running after you close the terminal.
     Use ngrok or named tunnel only — quick tunnel URLs change on restart and break Cursor.

  Discover models: curl -H "Authorization: Bearer $(eport api-key show)" <base>/models
  API key required for public tunnels; optional for --tunnel none.

  If tunnel fails: eport tunnel setup ngrok  (need authtoken + static domain).
  If auth fails: eport auth login
```

---

## `eport init`

```
NAME
  eport init — Initialize ePort config directory

SYNOPSIS
  eport init [options]

DESCRIPTION
  Creates ~/.eport/ and writes initial config if missing. Auto-generates a
  cryptographically random proxy API key when none exists (same behavior as
  first eport up). Does not start the proxy or tunnel.

  Use before auth/tunnel setup on a fresh machine, or to ensure config exists
  without starting the server.

OPTIONS
  --force            Regenerate API key only if combined with api-key flow
                     (prefer eport api-key rotate for key rotation)
  --verbose          Show paths written

EXAMPLES
  eport init

NEXT STEPS
  eport auth login
  eport config
  eport tunnel setup ngrok
  eport up  — prints Cursor paste block (Base URL + API key + Verify hint)
```

---

## `eport api-key`

```
NAME
  eport api-key — Manage proxy API key for Cursor

SYNOPSIS
  eport api-key show
  eport api-key rotate

DESCRIPTION
  The proxy API key is what Cursor sends as the OpenAI API key on your custom
  Base URL. Stored in ~/.eport/config.

  Auto-created on first eport up or eport init if missing.

  Required when tunnel is public (ngrok, named, or quick). Optional for local-only
  eport up --tunnel none.

SUBCOMMANDS
  show               Print current API key (for Cursor or curl)
  rotate             Generate new key; invalidate old key immediately; print new
                     Cursor paste block (Base URL + API key + Verify hint)

EXAMPLES
  eport api-key show
  eport api-key rotate

NEXT STEPS
  After rotate: update API key in Cursor → Settings → Models → OpenAI.
  Re-run Verify. Old key stops working immediately.
```

---

## `eport status`

```
NAME
  eport status — Show runtime and config summary

SYNOPSIS
  eport status [options]

DESCRIPTION
  Reports whether the proxy is running, tunnel URL and mode, auth state for
  Codex and Claude (including token expiry and active account per provider),
  saved config profile, and Codex usage windows when available. Does not
  start the server.

OPTIONS
  --json             Machine-readable output
  --verbose          Include extra detail (paths, last log lines)

EXAMPLES
  eport status
  eport status --json

NEXT STEPS
  Proxy not running?  eport up  or  eport service start
  Auth expired?       eport auth login
  Wrong tunnel URL?   eport tunnel setup ngrok  (stable) or re-run with --tunnel quick
  Update Cursor?      Use the tunnel URL shown here + /v1 as Base URL
```

---

## `eport auth login`

```
NAME
  eport auth login — Log in to subscription providers

SYNOPSIS
  eport auth login [codex|claude] [options]

DESCRIPTION
  Authenticates to upstream subscription providers. Without a provider
  argument, logs in to all providers that are missing or stale.

  Hybrid auth: ePort reuses fresh credentials from the Codex CLI
  (~/.codex/auth.json) or Claude Code when available; otherwise opens
  ePort's OAuth flow for that provider.

ARGUMENTS
  codex              Log in to ChatGPT/Codex only
  claude             Log in to Claude Max only
  (none)             Log in to all missing/stale providers

OPTIONS
  --verbose          Show OAuth redirect and token paths

EXAMPLES
  eport auth login
  eport auth login codex
  eport auth login claude

NEXT STEPS
  eport auth status     — confirm both providers if you use dual routing
  eport config          — set default effort per model
  eport tunnel setup ngrok
  eport up              — start proxy and paste block into Cursor
```

---

## `eport auth login codex`

```
NAME
  eport auth login codex — Log in to ChatGPT/Codex

SYNOPSIS
  eport auth login codex [options]

DESCRIPTION
  Authenticates only the Codex (ChatGPT subscription) upstream. Reuses
  ~/.codex/auth.json when fresh; otherwise runs ePort OAuth for Codex.

OPTIONS
  --verbose          Show OAuth redirect and token paths

EXAMPLES
  eport auth login codex

NEXT STEPS
  eport auth status
  eport config model gpt-5.5 --effort xhigh
  eport up
```

---

## `eport auth login claude`

```
NAME
  eport auth login claude — Log in to Claude Max

SYNOPSIS
  eport auth login claude [options]

DESCRIPTION
  Authenticates only the Claude (Anthropic subscription) upstream. Reuses
  Claude Code credentials when fresh; otherwise runs ePort OAuth for Claude.

OPTIONS
  --verbose          Show OAuth redirect and token paths

EXAMPLES
  eport auth login claude

NEXT STEPS
  eport auth status
  eport config model opus-4.8 --effort max
  eport up
  Add opus-4.8max (or similar) as a custom model in Cursor.
```

---

## `eport auth status`

```
NAME
  eport auth status — Show auth state for all providers

SYNOPSIS
  eport auth status [options]

DESCRIPTION
  Shows Codex and Claude credential status: source (CLI reuse vs ePort
  OAuth), expiry, and whether refresh is needed. Read-only.

OPTIONS
  --json             Machine-readable output
  --verbose          Show credential file paths

EXAMPLES
  eport auth status
  eport auth status --json

NEXT STEPS
  Missing or expired?   eport auth login  or  eport auth login codex|claude
  All good?             eport up
```

---

## `eport accounts list`

```
NAME
  eport accounts list — Show account queues

SYNOPSIS
  eport accounts list [codex|claude] [options]

DESCRIPTION
  Lists all configured subscription accounts per provider with queue order,
  active marker, and optional label. Read-only.

ARGUMENTS
  codex              List Codex accounts only
  claude             List Claude accounts only
  (none)             List both providers

OPTIONS
  --json             Machine-readable output
  --verbose          Show account ids and credential source

EXAMPLES
  eport accounts list
  eport accounts list codex

NEXT STEPS
  Add account:       eport accounts add codex
  Change active:     eport accounts switch codex <n>
  Reorder queue:     eport accounts reorder codex 2 1 3
```

---

## `eport accounts add`

```
NAME
  eport accounts add — Add account to provider queue

SYNOPSIS
  eport accounts add <codex|claude> [options]

DESCRIPTION
  Runs OAuth for the provider and appends the new account to the end of
  that provider's queue. Does not make it active unless the queue was empty.

ARGUMENTS
  codex              Add ChatGPT/Codex subscription account
  claude             Add Claude Max subscription account

OPTIONS
  --label <name>     Optional friendly label (e.g. "work", "personal")
  --verbose          Show OAuth and storage paths

EXAMPLES
  eport accounts add codex --label work
  eport accounts add claude

NEXT STEPS
  eport accounts list
  eport accounts switch codex <n>   — make new account active
  eport accounts status             — confirm active account and rotation policy
```

---

## `eport accounts switch`

```
NAME
  eport accounts switch — Set active account

SYNOPSIS
  eport accounts switch <codex|claude> <index|id> [options]

DESCRIPTION
  Immediately sets the chosen account as active (moves it to front of queue).
  Subsequent requests use this account. Does not retry in-flight requests.

ARGUMENTS
  <codex|claude>     Provider
  <index|id>         1-based queue index from eport accounts list, or account id

OPTIONS
  --verbose

EXAMPLES
  eport accounts switch codex 2
  eport accounts switch claude work

NEXT STEPS
  eport accounts status
  eport status        — active account in running proxy summary
```

---

## `eport accounts reorder`

```
NAME
  eport accounts reorder — Set account queue order

SYNOPSIS
  eport accounts reorder <codex|claude> <index...> [options]

DESCRIPTION
  Reorders the account queue for a provider. First index in the list becomes
  the active account. Use after eport accounts list to see current indices.

ARGUMENTS
  <codex|claude>     Provider
  <index...>         New order as 1-based indices (all accounts must appear once)

OPTIONS
  --verbose

EXAMPLES
  eport accounts reorder codex 2 1 3
  eport accounts reorder claude 1 2

NEXT STEPS
  eport accounts list
  eport accounts status
```

---

## `eport accounts status`

```
NAME
  eport accounts status — Show active account and rotation policy

SYNOPSIS
  eport accounts status [codex|claude] [options]

DESCRIPTION
  Shows the active account per provider, queue length, and how ePort rotates
  on upstream errors. Read-only.

  Rotation policy (automatic):
    429  Rate limit / quota exhausted
         → promote next account in queue; move hit account to back; retry once

    401  Unauthorized / expired token
         → refresh current account token first; if refresh fails, promote next
           account (failed account to back) and retry once

    Manual eport accounts switch always overrides — chosen account is active
    immediately for new requests.

ARGUMENTS
  codex              Codex queue only
  claude             Claude queue only
  (none)             Both providers

OPTIONS
  --json             Machine-readable output
  --verbose          Last rotation reason (429, 401-refresh-failed, manual), timestamps

EXAMPLES
  eport accounts status
  eport accounts status codex --verbose

NEXT STEPS
  Hit rate limits often?  eport accounts add codex  — add backup account
  Wrong account active?   eport accounts switch codex <n>
  Auth failing?           eport auth login codex  before adding duplicates
```

---

## `eport config model`

```
NAME
  eport config model — Set default effort for a bare model

SYNOPSIS
  eport config model <bare-model> [options]

DESCRIPTION
  Saves a default effort profile for a bare model ID in ~/.eport/config.
  When Cursor sends the bare name with no suffix (e.g. gpt-5.5), ePort
  applies this default. Precedence (highest wins): request-body effort →
  suffix → this profile → global default.

  --effort values are provider-specific:
    Codex models:   minimal | low | medium | high | xhigh
    Claude models:  low | medium | high | max  (Anthropic-native; no xhigh)

ARGUMENTS
  <bare-model>       Bare model ID without suffix (e.g. gpt-5.5, opus-4.8)

OPTIONS
  --effort <level>   Provider-appropriate level (see DESCRIPTION)
  --fast             Enable fast tier for this model (Codex only; ignored for Claude)

EXAMPLES
  eport config model gpt-5.5 --effort xhigh
  eport config model gpt-5.5 --effort high --fast
  eport config model opus-4.8 --effort max

NEXT STEPS
  eport config          — interactive wizard for multiple models
  eport up              — apply defaults on next session
  In Cursor, bare gpt-5.5 uses saved effort; use gpt-5.5xhigh to override per request.
  Cursor request-body reasoning.effort overrides suffix and config on both routes.
```

---

## `eport config`

```
NAME
  eport config — Interactive config wizard

SYNOPSIS
  eport config [options]
  eport config model <bare-model> --effort <level> [--fast]

DESCRIPTION
  Without subcommands or with no model argument, runs an interactive wizard:
  pick models, select effort via provider-aware radio buttons (Codex tokens
  vs Claude tokens), optional fast checkbox for Codex models only. Writes the
  same ~/.eport/config as flag one-liners.

  Always prints the flag equivalent at the end for copy-paste reuse.

OPTIONS
  --effort <level>   Set global or per-model effort (with model subcommand)
  --fast on|off      Global fast override (Codex priority on every request)
  --tunnel <mode>    Default tunnel mode: ngrok | named | quick | none

EXAMPLES
  eport config
  eport config --fast on
  eport config --tunnel ngrok
  eport config model gpt-5.5 --effort xhigh

NEXT STEPS
  Copy the printed "Flag equivalent" line to script or repeat settings.
  eport tunnel setup ngrok  if not done yet
  eport up
```

---

## `eport tunnel setup ngrok`

```
NAME
  eport tunnel setup ngrok — Configure persistent ngrok tunnel

SYNOPSIS
  eport tunnel setup ngrok [options]

DESCRIPTION
  Saves a ngrok authtoken and static domain URL to config. This is the
  default stable tunnel mode for new ePort installs.

  You create a free ngrok account, reserve a static domain in the ngrok
  dashboard, then paste the authtoken and domain here. ePort starts ngrok
  with NGROK_AUTHTOKEN at runtime and does not mutate global ngrok config.

OPTIONS
  --token <token>    ngrok authtoken; prompts if omitted
  --hostname <url>   Static ngrok URL (e.g. https://name.ngrok-free.app);
                     prompts if omitted
  --url <url>        Alias for --hostname

EXAMPLES
  eport tunnel setup ngrok
  eport tunnel setup ngrok --token 2abc... --url name.ngrok-free.app

NEXT STEPS
  1. Install ngrok from https://ngrok.com/download.
  2. Reserve a static domain in ngrok dashboard.
  3. eport up  — should print https://<domain>/v1
  4. Paste into Cursor Settings → Models → OpenAI Base URL.
```

---

## `eport tunnel setup named`

```
NAME
  eport tunnel setup named — Configure persistent Cloudflare tunnel

SYNOPSIS
  eport tunnel setup named [options]

DESCRIPTION
  Saves a Cloudflare named tunnel token and public hostname to config.
  Required for stable Cursor Base URL (e.g. https://eport.example.com/v1).

  You create the tunnel in Cloudflare Zero Trust → Networks → Tunnels:
  create tunnel → copy token → add Public Hostname → point to localhost:8787.

OPTIONS
  --token <token>    Tunnel token (eyJ…); prompts if omitted
  --hostname <host>  Public hostname (e.g. eport.example.com); prompts if omitted
  --port <n>         Local port for hostname target (default: 8787)

EXAMPLES
  eport tunnel setup named
  eport tunnel setup named --token eyJh... --hostname eport.example.com

NEXT STEPS
  1. In Cloudflare: Zero Trust → Networks → Tunnels → Create → copy token.
  2. Add Public Hostname: subdomain + domain → HTTP → localhost:8787.
  3. eport up  — should print https://<hostname>/v1
  4. Paste into Cursor Settings → Models → OpenAI Base URL.

  Token = secret that connects cloudflared. Hostname = URL Cursor calls.
  Tunnels are free; custom domains may cost money. See README.md § Cloudflare.
```

---

## `eport tunnel setup quick`

```
NAME
  eport tunnel setup quick — Enable ephemeral quick tunnel mode

SYNOPSIS
  eport tunnel setup quick [options]

DESCRIPTION
  Sets default tunnel mode to quick. No Cloudflare dashboard setup required.
  Each eport up run gets a random *.trycloudflare.com URL that changes on
  restart. Good for testing; not recommended for daily Cursor use.

OPTIONS
  (none)

EXAMPLES
  eport tunnel setup quick
  eport up --tunnel quick

NEXT STEPS
  eport up  — copy the new URL into Cursor Base URL each time it changes.
  For stable URL: eport tunnel setup ngrok
```

---

## `eport tunnel setup`

```
NAME
  eport tunnel setup — Interactive tunnel wizard

SYNOPSIS
  eport tunnel setup [ngrok|named|quick] [options]

DESCRIPTION
  Guided setup: choose ngrok (stable static domain), named Cloudflare
  (stable hostname), or quick Cloudflare (random URL).
  Prompts for the required token/domain values and saves them to config.

ARGUMENTS
  ngrok              Skip menu; run ngrok tunnel setup
  named              Skip menu; run named tunnel setup
  quick              Skip menu; enable quick tunnel mode

EXAMPLES
  eport tunnel setup
  eport tunnel setup ngrok
  eport tunnel setup named
  eport tunnel setup quick

NEXT STEPS
  ngrok: eport up  → paste https://<ngrok-domain>/v1 into Cursor.
  Named: eport up  → paste https://<hostname>/v1 into Cursor.
  Quick: eport up  → update Cursor Base URL whenever the URL changes.
  eport service install  — optional background service; ngrok or named only.
```

---

## `eport service install`

```
NAME
  eport service install — Register auto-start background service

SYNOPSIS
  eport service install [options]

DESCRIPTION
  Installs OS-level auto-start so proxy + tunnel run at login without a
  terminal. Windows: scheduled task (schtasks). macOS: launchd user agent.

  Requires prior auth and tunnel config for ngrok or named mode.

  Do not install the service when default tunnel mode is quick — the tunnel
  URL changes on every restart and Cursor Base URL will break silently.

OPTIONS
  --verbose          Show plist/task paths

EXAMPLES
  eport service install

NEXT STEPS
  eport service start
  eport service status
  Configure Cursor with the stable tunnel URL from status output.
  Windows: run from elevated shell if schtasks reports access denied.
```

---

## `eport service uninstall`

```
NAME
  eport service uninstall — Remove auto-start registration

SYNOPSIS
  eport service uninstall [options]

DESCRIPTION
  Removes the scheduled task (Windows) or launchd plist (macOS). Does not
  delete ~/.eport config or auth credentials.

OPTIONS
  --verbose          Show removed paths

EXAMPLES
  eport service uninstall

NEXT STEPS
  Run proxy in foreground: eport up
  Re-install later: eport service install
```

---

## `eport service start`

```
NAME
  eport service start — Start background service

SYNOPSIS
  eport service start [options]

DESCRIPTION
  Starts the installed ePort service (proxy + tunnel). Fails if not installed
  — run eport service install first.

OPTIONS
  --verbose          Show service logs path

EXAMPLES
  eport service start

NEXT STEPS
  eport service status  — confirm URL and auth
  Paste Base URL into Cursor if not already configured.
```

---

## `eport service stop`

```
NAME
  eport service stop — Stop background service

SYNOPSIS
  eport service stop [options]

DESCRIPTION
  Stops the running ePort service. Leaves install registration in place.

OPTIONS
  --verbose

EXAMPLES
  eport service stop

NEXT STEPS
  eport service start  — start again
  eport up  — run in foreground for debugging
```

---

## `eport service restart`

```
NAME
  eport service restart — Restart background service

SYNOPSIS
  eport service restart [options]

DESCRIPTION
  Stops and starts the ePort service. Use after config or tunnel changes.

OPTIONS
  --verbose

EXAMPLES
  eport service restart

NEXT STEPS
  eport service status  — verify new tunnel URL (quick mode may change URL)
  Re-verify Cursor connection if Base URL changed.
```

---

## `eport service status`

```
NAME
  eport service status — Show background service state

SYNOPSIS
  eport service status [options]

DESCRIPTION
  Reports whether the OS service is installed and running, tunnel URL,
  and summary auth state. Complements eport status for service deployments.

OPTIONS
  --json             Machine-readable output
  --verbose          Include log file tail

EXAMPLES
  eport service status

NEXT STEPS
  Not installed?  eport service install && eport service start
  Not running?    eport service start
  Auth issues?    eport auth login
```

---

## Implementation notes

- Every command should support `eport <command> --help` (or `eport help <command>`).
- **NEXT STEPS** sections are user-facing guidance; keep them in help output.
- Dynamic values in `eport up` / `eport status` (URL, API key, models) are printed at runtime, not in static `--help`.
- Terminology must match [CONTEXT.md](../CONTEXT.md): ngrok tunnel default, suffix grammar, dual auth, config profile, flag equivalent, account rotation trigger, provider effort levels, proxy API key.
- Account rotation, effort precedence, and model catalog rules must match [docs/prd/eport-v1.md](./prd/eport-v1.md).
