# ePort — Glossary

## ePort
A planned local OpenAI-compatible proxy that routes IDE traffic (especially Cursor) through paid subscriptions (ChatGPT/Codex, Claude Max) instead of metered API keys, on macOS and Windows. **v1** must preserve session continuity, encrypted reasoning passthrough, upstream concurrency limits, multi-account rotation, BYOK verification compatibility, and full multimodal input on Codex and Claude routes.

## Cursor client
The Cursor IDE whose cloud backend calls a user-configured custom OpenAI base URL. It cannot reach private networks (127.0.0.1, RFC1918); a public HTTPS endpoint is required for chat/agents. Sends **multimodal requests** (text, images, and other input types) and runs a BYOK "Verify" step against the configured base URL — ePort must satisfy both via **BYOK validation bypass** and correct per-upstream translation.

## BYOK validation bypass
**v1** workaround so Cursor's BYOK "Verify" step succeeds against the ePort base URL without requiring a real third-party API-key validation response.

## Multimodal request
Cursor request payload with text, images, or other content parts. The proxy must translate each part correctly for the chosen upstream (Codex or Claude), including image and attachment workarounds where the client and upstream formats differ. **v1** must support all Cursor input types on both provider routes.

## Upstream provider
The authenticated backend that actually serves inference: e.g. `chatgpt.com/backend-api/codex/responses` (Codex subscription), `api.anthropic.com` (Claude subscription), or `api2.cursor.sh` (Cursor Agent).

## Subscription auth
Credentials used to authenticate to an upstream provider without a pay-per-token API key. **Hybrid auth:** ePort reuses existing CLI credentials when fresh (e.g. `~/.codex/auth.json`, Claude Code credentials); when missing or stale, it falls back to ePort's own OAuth login for that provider. Managed via `eport auth status` (both providers), `eport auth login` (all missing providers), or `eport auth login codex` / `eport auth login claude` (single provider). Multiple accounts per provider are managed via the **account queue**.

## Account queue
Ordered list of subscription accounts for a provider. The active account serves requests until a **account rotation trigger** fires, then the next account is promoted. Users manage the queue via `eport accounts list|add|switch|reorder|status`; `eport status` shows the active account per provider. **v1** must-have for Codex multi-account rotation; Claude uses the same queue pattern when multiple accounts are configured.

## Account rotation trigger
Automatic promotion to the next account in the **account queue**. **429** (rate limit / quota): rotate immediately, move exhausted account to back. **401** (auth failure): attempt token refresh for current account first; rotate only if refresh fails. **Manual:** `eport accounts switch` always sets the chosen account active. See [docs/prd/eport-v1.md](./docs/prd/eport-v1.md) (Account queue).

## Session continuity
Stable session identity across related requests so upstream providers can reuse cached context. On Codex routes, the proxy aligns `session_id` with the upstream prompt cache key. **v1** must-have.

## Reasoning effort
How much internal reasoning a model uses. **Codex** levels include `minimal`, `low`, `medium`, `high`, `xhigh`. **Claude** uses Anthropic-native levels only (see **Provider effort levels**). In Cursor flows, effort is set by the client in the request body or encoded in the model name suffix; proxies strip suffixes and forward provider-appropriate effort upstream. See **Effort precedence** and [docs/prd/eport-v1.md](./docs/prd/eport-v1.md). On Codex routes, **encrypted reasoning** payloads must pass through unchanged.

## Effort precedence
Locked resolution order for reasoning/thinking effort (**highest wins**). Applies identically on **Codex and Claude routes** — body effort is honored on both when Cursor sends it (grill **Q11**); suffix/config/global apply only when the body omits effort.

1. **Model suffix** — concatenated effort token on client model string.
2. **Request body** — Codex: `reasoning.effort`, `reasoning_effort`, `reasoning`. Claude: same OpenAI-shaped fields plus native equivalents (`thinking`, `thinking.budget_tokens`, Anthropic effort fields) on the Messages translation path.
3. **Per-model default** — **default effort profile** in `~/.eport/config`.
4. **Global default** — fallback when nothing else is set.

Suffix beats body when both are present (e.g. `gpt-5.5xhigh` + body `medium` → `xhigh`). On Claude routes, OpenAI-style body labels translate to Anthropic-native upstream values (never `xhigh`). Fast tier uses a separate Codex-only stack (`-fast` suffix → body `service_tier` → config → global). See [docs/prd/eport-v1.md](./docs/prd/eport-v1.md).

## Encrypted reasoning
Upstream reasoning delivered in encrypted form (`reasoning.encrypted_content`). The proxy forwards these payloads without decoding or re-encoding so Cursor can consume Codex reasoning. **v1** must-have for Codex.

## Concurrency cap
Maximum number of simultaneous upstream Codex requests the proxy will send; additional requests wait until a slot frees. Prevents overload and rate-limit storms. **v1** must-have.

## Fast mode
Priority queue / accelerated inference tier for **Codex upstream only** — not available on Claude subscription routes. Often expressed as model suffix (`-fast`, `-extra`), request `service_tier`, or upstream value `priority` (Codex naming). Claude model strings may encode reasoning effort but never a fast/speed tier suffix.

## Tunnel
A mechanism exposing a local proxy on a public HTTPS URL so Cursor's cloud backend can reach it. `eport up` defaults to a **ngrok static-domain tunnel**; other modes are selectable via CLI flags (see **Tunnel mode**).

## ngrok tunnel
A persistent ngrok tunnel bound to a saved static domain (e.g. `name.ngrok-free.app`) via a ngrok account and authtoken. Default for `eport up`; survives restarts and gives a stable public URL for Cursor configuration without requiring a user-owned domain.

## Named tunnel
A persistent Cloudflare tunnel bound to a fixed hostname (e.g. `eport.example.com`) via a Cloudflare account and tunnel token. Optional alternative to ngrok; survives restarts and gives a stable public URL for Cursor configuration.

## Tunnel mode
How `eport up` exposes the local proxy publicly. Values: **ngrok** (default — persistent ngrok static-domain tunnel), **named** (persistent Cloudflare named tunnel), **quick** (ephemeral Cloudflare quick tunnel for ad-hoc testing), **none** (no tunnel — local proxy only; user supplies a public URL manually). Selectable via CLI flags for experimentation.

## Service mode
OS-level auto-start so the proxy and tunnel run at login/boot without an open terminal. **v1** includes install/uninstall via CLI: `eport service install`, `eport service uninstall`. **Windows:** scheduled task (schtasks pattern from Firzus codex-cursor-proxy). **macOS:** launchd user agent plist.

## Model alias
A client-facing model ID (what the user types in Cursor) mapped to a canonical **official upstream model ID** and provider route. ePort uses **official upstream model IDs** (Anthropic + Codex) as source of truth; Cursor-facing names (e.g. `claude-4.6-opus-high`, `opus-4.8`, `cc/claude-opus-4-6`) resolve through an alias/normalize layer (ccproxypal / sub-bridge pattern) before suffix parse and upstream forward. Bare names in config may be shorthand; upstream always receives the canonical provider id. See [docs/prd/eport-v1.md](./docs/prd/eport-v1.md) (Model catalog).

## Bare model name
The upstream model ID after stripping all effort and tier suffixes (e.g. `gpt-5.5xhigh-fast` → `gpt-5.5`, `opus-4.8max` → `opus-4.8`). Used for routing and catalog lookup. A bare name with no suffix (e.g. `gpt-5.5`) uses the configured default effort profile for that model.

## Model suffix
Optional tail on the client model string that encodes reasoning effort and/or service tier without changing the base model. **Codex:** effort tokens (`minimal`, `low`, `medium`, `high`, `xhigh`) concatenated directly after the bare model id with no hyphen; optional `-fast` at end. **Claude:** Anthropic-native effort tokens only (`low`, `medium`, `high`, `max`, …) concatenated after bare id — **no** `xhigh` or other Codex-only tokens; **no** `-fast`. Proxies strip suffixes before forwarding the canonical bare model name upstream and map effort per **Provider effort levels**.

## Suffix grammar
Canonical ePort client model string format. **Codex:** `[bare-model-id][effort-token][-fast]` — Codex effort tokens (`minimal`, `low`, `medium`, `high`, `xhigh`); optional `-fast` at end. **Claude:** `[bare-model-id][effort-token]` only — Anthropic-native effort tokens (`low`, `medium`, `high`, `max`, …); no `-fast`. Examples: `gpt-5.5`, `gpt-5.5xhigh`, `gpt-5.5xhigh-fast`; `opus-4.8`, `opus-4.8high`, `opus-4.8max`. `opus-4.8xhigh` is invalid on Claude routes. See [docs/prd/eport-v1.md](./docs/prd/eport-v1.md) (Suffix grammar).

## Config profile
Saved defaults and global settings persisted to `~/.eport/config`: per-model **default effort profile**s (provider-appropriate values), **proxy API key**, **global fast override**, **tunnel mode**, and related CLI defaults. Set via flag one-liner (e.g. `eport config model gpt-5.5 --effort xhigh --fast`) or **interactive config** — both paths write the same file. Must not require hand-editing; interactive setup is first-class.

## Interactive config
Guided `eport config` flow when invoked without flags: **provider-aware** radio-button selection for effort (Codex tokens vs Claude tokens — not a single mixed list), checkbox for fast mode on Codex models only. Persists the same **config profile** as the flag one-liner; always prints the **flag equivalent** at the end for copy-paste reuse.

## Flag equivalent
The exact `eport config …` one-liner printed after **interactive config** (and usable anytime as an equivalent to the wizard). Lets users rerun or script the same settings without repeating the guided flow.

## Default effort profile
Per bare-model default applied when the client sends no body effort/thinking fields and no suffix (e.g. bare `gpt-5.5` → `xhigh`; bare Claude Opus → `high` or `max`). Precedence (highest wins): explicit suffix → request body effort/thinking → this profile → global default. Stored values must be **provider-appropriate** (Codex tokens on Codex models; Anthropic-native levels on Claude models). Saved per model in the **config profile** via `eport config model <bare-model> --effort <level>` or **interactive config**; `eport up` session flags can override fast tier for one run without changing saved config. See [docs/prd/eport-v1.md](./docs/prd/eport-v1.md).

## Global fast override
A setting that forces `service_tier: priority` (Codex fast mode) on every request, regardless of model suffix or client body. Saved in the **config profile** via `eport config` flags or **interactive config**; `eport up --fast` applies it for one run only. Used to avoid per-request suffix parsing and to keep fast tier consistent across all Codex routes.

## Provider effort levels
Provider-specific vocabularies for reasoning/thinking effort. **Codex:** `minimal`, `low`, `medium`, `high`, `xhigh` (concatenated suffix and config). **Claude:** Anthropic-native set only — e.g. `low`, `medium`, `high`, `max` per current Messages API (no `xhigh`; do not map Codex tokens onto Claude). Interactive config and `eport config model --effort` validate against the model's provider. See [docs/prd/eport-v1.md](./docs/prd/eport-v1.md).

## Proxy API key
Cryptographically random secret ePort generates and stores in `~/.eport/config` for Cursor to send as the OpenAI API key on the custom Base URL. Auto-created on first `eport up` or `eport init` if none exists. **Required** when the tunnel is public (ngrok, named, or quick); **optional** for `--tunnel none` (local-only). CLI: `eport api-key show` (display current key), `eport api-key rotate` (new key, old key invalid immediately, print new Cursor paste block). Printed in the copy-paste block from `eport up` alongside Base URL and Verify hint.

## Edge protocol
The OpenAI-compatible wire format Cursor sends to ePort on the public HTTPS endpoint. Cursor may use **`POST /v1/chat/completions`** (Chat Completions) or **`POST /v1/responses`** (Responses API) depending on client version and flow. **Claude path B (locked):** ePort accepts **both** shapes on Claude-routed models, normalizes internally, and translates upstream to the **Anthropic Messages API**. Codex routes prefer Responses-native passthrough where the wire format matches. See [docs/prd/eport-v1.md](./docs/prd/eport-v1.md) (Claude edge protocol).

## Anthropic Messages API
Anthropic's native inference API (`POST /v1/messages` on `api.anthropic.com`). Claude subscription routes translate from the **edge protocol** (OpenAI Chat Completions or Responses) into Messages request shape (model, messages, thinking/effort, tools, multimodal content blocks) and convert the upstream SSE stream back to the OpenAI-shaped response the Cursor client used.

## Dual auth
Two independent subscription credential stores in one proxy process — Codex and Claude — both reachable through a single OpenAI-compatible Cursor endpoint, with routing chosen by model name or alias. Each provider uses **hybrid auth:** reuse existing CLI credentials when fresh (`~/.codex/auth.json`, Claude Code credentials), otherwise fall back to ePort's own OAuth login. CLI: `eport auth status` (both providers), `eport auth login` (all missing), `eport auth login codex` / `eport auth login claude` (single provider). Codex may hold multiple accounts in an **account queue**; Claude uses the same auth model with provider-appropriate limits.

## Implementation stack
ePort is not locked to a single language or runtime. Components may use different languages (mixing is OK); per-component choices are driven by **cross-platform support** (macOS and Windows) and **hot-path latency** on both platforms — not by a single-language mandate.

## Distribution
How users install ePort. **v1:** npm registry — global install (`npm i -g eport`) or one-shot run (`bunx eport`); published as a free public npm package. **Standalone binaries** (macOS app, Windows `.exe`) deferred until a Tauri/Electron desktop app or first stable release.
