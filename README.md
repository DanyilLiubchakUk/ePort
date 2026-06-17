# ePort

ePort is a local OpenAI-compatible proxy that routes IDE traffic (especially **Cursor**) through your paid **ChatGPT/Codex** and **Claude Max** subscriptions instead of metered API keys. It runs on macOS and Windows, exposes a public HTTPS endpoint via Cloudflare (required for Cursor), and supports dual-provider routing from a single Base URL — Codex models like `gpt-5.5` and Claude models like `opus-4.8max` in one setup.

## Prerequisites

- **Node.js 20+** or **[Bun](https://bun.sh) 1.1+** (either works for install and run)
- **ChatGPT/Codex** and/or **Claude Max** subscription (the accounts you want to route)
- **Cloudflare account** (free tier is enough for tunnels)
- **Domain on Cloudflare** (optional but recommended for a stable hostname; you can use a free `*.trycloudflare.com` URL for quick testing only)

## Quick start

Follow these steps in order. Each step links to more detail below.

1. **Install ePort**

   ```bash
   npm i -g eport
   # or one-shot without global install:
   bunx eport
   ```

2. **Authenticate** — log in to the providers you need:

   ```bash
   eport auth login          # all missing providers
   eport auth status         # verify both Codex and Claude
   ```

   ePort uses **hybrid auth**: it reuses fresh credentials from the Codex CLI (`~/.codex/auth.json`) or Claude Code when available, and falls back to its own OAuth flow when missing or stale.

3. **Configure model defaults** — set default reasoning effort and optional fast mode:

   ```bash
   eport config model gpt-5.5 --effort xhigh
   eport config model opus-4.8 --effort max
   # or run the guided wizard:
   eport config
   ```

   Effort levels are **provider-specific**: Codex uses tokens like `xhigh`; Claude uses Anthropic-native levels like `high` and `max` (not `xhigh`).

4. **Set up a named Cloudflare tunnel** (recommended; stable URL for Cursor):

   ```bash
   eport tunnel setup named
   ```

   You need a **tunnel token** and a **public hostname** from the Cloudflare dashboard. See [Cloudflare named tunnel setup](#cloudflare-named-tunnel-setup) for click-by-click instructions.

5. **Start the proxy** (named tunnel is the default):

   ```bash
   eport up
   ```

   ePort prints a copy-paste block with your Base URL, API key, and suggested custom models. On first run, ePort **auto-generates** a proxy API key if none exists (`eport api-key show` / `eport api-key rotate` to manage later). Keep this terminal open, or install a background service (step 6).

6. **Install as a background service** (optional — auto-start at login):

   ```bash
   eport service install
   eport service start
   ```

7. **Configure Cursor** — paste the block from `eport up` into Cursor Settings. See [Cursor setup](#cursor-setup).

8. **Optional — multiple accounts** — add backup subscription accounts and let ePort rotate on rate limits:

   ```bash
   eport accounts add codex
   eport accounts list
   eport accounts status
   ```

---

## Account queue

When you have more than one subscription account per provider, ePort keeps an ordered **account queue**. The active account serves requests until a limit or auth failure triggers rotation.

```bash
eport accounts list              # all accounts and queue order
eport accounts add codex         # OAuth + append to Codex queue
eport accounts add claude
eport accounts switch codex 2    # make account #2 active now
eport accounts reorder codex 2 1 3   # set queue order
eport accounts status            # active account + last rotation reason
```

| Trigger | Behavior |
|---------|----------|
| **429** rate limit / quota | Next account in queue; exhausted account moves to back |
| **401** auth failure | Refresh token first; rotate to next account only if refresh fails |
| **Manual** `eport accounts switch` | Your chosen account becomes active immediately |

`eport status` shows the active Codex and Claude account when the proxy is running.

---

## Cloudflare named tunnel setup

Cursor's cloud backend cannot reach `localhost` or private networks. ePort must be reachable at a **public HTTPS URL**. A **named Cloudflare tunnel** gives you a fixed hostname (e.g. `eport.example.com`) that survives restarts — this is the recommended daily-driver setup.

> **Cost note:** Cloudflare **tunnel** features are free on the Zero Trust free tier. A **custom domain** may cost money (registrar + optional Cloudflare plan). For ad-hoc testing without a domain, use a **quick tunnel** instead (`eport tunnel setup quick` or `eport up --tunnel quick`), which gives a random `*.trycloudflare.com` URL that changes on every restart.

### Token vs hostname — what each one is

| Item | What it is | Where you get it | What ePort uses it for |
|------|------------|------------------|------------------------|
| **Tunnel token** | A long secret string (starts with `eyJ…`) that authorizes `cloudflared` to connect *your* tunnel to Cloudflare's edge | Copied once when you **create** the tunnel in the Cloudflare dashboard | Stored in your ePort config; `eport up` passes it to `cloudflared` so the tunnel connects |
| **Public hostname** | The HTTPS URL Cursor will call, e.g. `eport.example.com` | Configured under **Public Hostname** on the same tunnel, pointing to your local proxy | Saved as your stable Base URL: `https://eport.example.com/v1` |

The token proves "this machine may run this tunnel." The hostname is the address clients (Cursor) use. You need **both** for a named tunnel.

### Step-by-step in the Cloudflare dashboard

1. Open **[Cloudflare Zero Trust](https://one.dash.cloudflare.com)** and sign in (or create a free account).

2. Go to **Networks** → **Tunnels** (left sidebar under Zero Trust).

3. Click **Create a tunnel**.

4. Choose **Cloudflared** as the connector type → **Next**.

5. Enter a tunnel name (e.g. `eport`) → **Save tunnel**.

6. On the **Install connector** page, find the **tunnel token** — a long string starting with `eyJ`. Click **Copy** (or copy from the `cloudflared service install …` command).  
   - Paste this into ePort when prompted: `eport tunnel setup named`, or save it in config.  
   - You do **not** need to run the install command manually if ePort manages `cloudflared` for you.

7. Click **Next** to reach **Public Hostname** (or open the tunnel → **Public Hostname** tab → **Add a public hostname**).

8. Configure the hostname:
   - **Subdomain:** e.g. `eport` (full host: `eport.yourdomain.com`)
   - **Domain:** pick a domain already on your Cloudflare account
   - **Path:** leave empty
   - **Type:** HTTP
   - **URL:** `localhost:8787` (or the port ePort uses — check `eport status`)

9. Click **Save hostname**.

10. Back in the terminal:

    ```bash
    eport tunnel setup named
    # paste token when prompted, confirm hostname
    ```

11. Verify: `eport up` should print `https://eport.yourdomain.com/v1` (your hostname + `/v1`).

Official reference: [Create a Cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/).

---

## Cursor setup

After `eport up` prints the copy-paste block:

1. Open **Cursor → Settings → Models**.
2. Find the **OpenAI** section (API Key / Base URL).
3. Enable **Override OpenAI Base URL**.
4. Set:
   - **Base URL:** `https://<your-hostname>/v1` (must end with `/v1`; use the URL from `eport up`, not `localhost`)
   - **API Key:** the key ePort generated (`eport api-key show` if you need it again). Required when the tunnel is public; optional for local-only `--tunnel none`.
5. Click **Verify**. ePort serves `GET /health` for BYOK validation and does not require a real third-party API key check (**BYOK bypass**).
6. **Add custom models** in the model picker. Examples:

   | Custom model ID | Provider | Notes |
   |-----------------|----------|-------|
   | `gpt-5.5` | Codex | Uses your configured default effort |
   | `gpt-5.5xhigh` | Codex | Explicit xhigh reasoning |
   | `gpt-5.5xhigh-fast` | Codex | xhigh + priority (fast) tier |
   | `opus-4.8max` | Claude | Opus + max Anthropic reasoning effort |

7. Select a custom model and start a chat or agent session.

> **Never use `http://localhost:…` in Cursor** for chat/agents. Cursor's cloud backend blocks private networks. Always use your tunnel's public HTTPS URL.

### Multimodal input

ePort **v1** supports all Cursor input types on both Codex and Claude routes — text, images, and attachments. The proxy translates each content part to the correct upstream format (including known Cursor image-upload workarounds).

### Claude API shapes

Claude-routed models accept **both** OpenAI endpoints Cursor may send:

- `POST /v1/chat/completions`
- `POST /v1/responses`

ePort normalizes either shape and forwards to the Anthropic Messages API upstream. You do not configure which endpoint Cursor uses — one Base URL covers chat and agent flows.

### Dynamic model catalog

`GET /v1/models` returns a **full dynamic catalog** — all models your logged-in Codex and Anthropic accounts can access, merged and tagged by provider — not just `gpt-5.5` and `opus-4.8`. Use it to discover ids for Cursor custom models:

```bash
curl -H "Authorization: Bearer $(eport api-key show)" https://your-hostname/v1/models
```

Suffix grammar still applies when you send requests; you can add bare ids or suffixed variants (e.g. `gpt-5.5xhigh`) in the Cursor model picker.

---

## Model suffix grammar

Client model strings can encode **reasoning effort** and (on Codex only) **fast mode** as suffixes. ePort strips suffixes before forwarding the **bare model name** upstream and maps effort/tier from the suffix or your **config profile** defaults.

### Codex routes

Format: `[bare-model-id][effort-token][-fast]`

| Suffix part | Values | Example |
|-------------|--------|---------|
| Bare model | `gpt-5.5`, `gpt-5.4`, … | `gpt-5.5` |
| Effort (concatenated, no hyphen) | `minimal`, `low`, `medium`, `high`, `xhigh` | `gpt-5.5xhigh` |
| Fast tier (hyphenated, end only) | `-fast` | `gpt-5.5xhigh-fast` |

Bare name with no suffix uses the **default effort profile** saved for that model (`eport config model gpt-5.5 --effort xhigh`).

### Claude routes

Format: `[bare-model-id][effort-token]` — **no** `-fast` or other speed-tier suffix. Use **Anthropic-native** effort tokens only (not Codex `xhigh`).

| Example | Maps to |
|---------|---------|
| `opus-4.8` | Bare Opus + default effort from config |
| `opus-4.8high` | Opus + `high` Anthropic reasoning effort |
| `opus-4.8max` | Opus + `max` Anthropic reasoning effort |
| `opus-4.8xhigh` | **Invalid** — `xhigh` is Codex-only |
| `opus-4.8xhigh-fast` | **Invalid** — Claude routes do not support `-fast` |

### Effort precedence

When multiple sources set effort, **highest wins** (same on Codex and Claude routes):

1. Request body effort/thinking fields when Cursor sends them — `reasoning.effort` on Codex; same plus Claude-native equivalents (`thinking`, etc.) on Claude routes
2. Explicit model suffix
3. Per-model default in config (`eport config model …`)
4. Global default

Body beats suffix (e.g. `gpt-5.5xhigh` + body `medium` → `medium`). Suffix and config apply only when the body omits effort.

See [docs/prd/eport-v1.md](./docs/prd/eport-v1.md) (effort precedence section).

### Global fast override

To force Codex priority tier on every request regardless of suffix:

```bash
eport config --fast on
# or one session only:
eport up --fast
```

---

## Config CLI

Settings persist to `~/.eport/config`. You never need to hand-edit this file.

### Flag one-liner

```bash
# Per-model default effort (provider-appropriate values)
eport config model gpt-5.5 --effort xhigh
eport config model opus-4.8 --effort max

# Global fast override (Codex only)
eport config --fast on

# Default tunnel mode
eport config --tunnel named
```

### Interactive config

```bash
eport config
```

The wizard uses **provider-aware** radio buttons for effort (Codex tokens vs Claude tokens), a fast-mode checkbox for Codex models only, and writes the same config file as the flags. When finished, it prints the **flag equivalent** — copy-paste that one-liner to rerun or script the same settings:

```text
Flag equivalent:
  eport config model gpt-5.5 --effort xhigh && eport config --fast off
```

### Session overrides

`eport up --fast` and `eport up --tunnel quick` apply for one run only and do not change saved config.

---

## Proxy API key

ePort stores a cryptographically random API key in `~/.eport/config`. Cursor sends it as the OpenAI API key on your custom Base URL.

| Command | Action |
|---------|--------|
| *(first `eport up` or `eport init`)* | Auto-generate key if none exists; print Cursor paste block |
| `eport api-key show` | Display current key |
| `eport api-key rotate` | Generate new key; old key invalid immediately; print new paste block |

**Required** when the tunnel is public (named or quick). **Optional** for `eport up --tunnel none` (local-only).

---

## Tunnel modes

| Mode | Command | URL stability | Best for |
|------|---------|---------------|----------|
| **named** (default) | `eport up` or `eport up --tunnel named` | Fixed hostname you configure | Daily Cursor use |
| **quick** | `eport up --tunnel quick` | Random `*.trycloudflare.com`; changes each restart | Try-it / debugging |
| **none** | `eport up --tunnel none` | No tunnel; local proxy only | You supply your own public URL (VPS, ngrok, etc.) |

Setup commands:

```bash
eport tunnel setup named    # save token + hostname to config
eport tunnel setup quick      # no dashboard setup; ephemeral URL at runtime
eport tunnel setup            # interactive wizard (named vs quick)
```

---

## Service install

Run the proxy and tunnel in the background without keeping a terminal open.

```bash
eport service install     # register auto-start
eport service start       # start now
eport service status      # running / stopped / URL / auth summary
eport service stop
eport service restart
eport service uninstall   # remove auto-start
```

| Platform | Mechanism |
|----------|-----------|
| **Windows** | Scheduled task (`schtasks`), auto-start on logon |
| **macOS** | `launchd` user agent plist |

Run `eport service install` from an elevated shell on Windows if you get access-denied errors from `schtasks`.

> **Warning — do not use service install with quick tunnel.** Quick tunnels (`eport up --tunnel quick`) generate a new `*.trycloudflare.com` URL on every restart. A background service restarts across reboots and logins, so Cursor's Base URL will silently break. Use a **named tunnel** (`eport tunnel setup named`) before `eport service install`.

---

## Troubleshooting

### Cursor says localhost / private network is forbidden

Cursor's cloud backend cannot call `127.0.0.1` or RFC1918 addresses. Use a **public HTTPS URL** from a named or quick tunnel. Set Base URL to `https://your-hostname/v1`, not `http://localhost:8787/v1`.

### Tunnel URL changed and Cursor stopped working

**Quick tunnels** generate a new `*.trycloudflare.com` URL on every restart. Switch to a **named tunnel** (`eport tunnel setup named`) for a stable hostname, update Cursor Base URL once, and use `eport service install` so the tunnel stays up across reboots.

### Auth expired / 401 / refresh_token_expired

```bash
eport auth status
eport auth login codex    # or: eport auth login claude
eport auth login          # refresh all missing/stale providers
```

If you ran `codex logout` or revoked Claude access, re-authenticate. `eport status` shows token expiry before requests fail.

### Verify button fails

- Confirm `eport up` (or the service) is running: `eport status`
- Base URL must end with `/v1`
- Hostname must be reachable over HTTPS (tunnel connected)
- Use the API key ePort printed (required when the endpoint is public)

### Model not found

Run `curl https://your-hostname/v1/models` (with your API key from `eport api-key show`) or check `eport status` for the dynamic catalog. Add the exact custom model ID in Cursor (including suffix, e.g. `gpt-5.5xhigh-fast` or `opus-4.8max`). Cursor-facing names are normalized to official upstream ids via the alias layer — see [docs/prd/eport-v1.md](./docs/prd/eport-v1.md).

---

## Development

Application source lives under [`src/`](./src/README.md): module layout, build order, and links to vertical implementation slices in `docs/ISSUES/`.

---

## Further reading

- **[CONTEXT.md](./CONTEXT.md)** — locked glossary and architecture terms (tunnel modes, suffix grammar, dual auth, config profile).
- **[docs/prd/eport-v1.md](./docs/prd/eport-v1.md)** — v1 product requirements (implementation plan).
- **[docs/CLI-HELP.md](./docs/CLI-HELP.md)** — specification for every `eport` command's `--help` text.
- **[ISSUES/README.md](./ISSUES/README.md)** — dependency-ordered vertical implementation slices.
