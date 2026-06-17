# ePort v1 — Product Requirements Document

**Status:** Draft for implementation  
**Date:** 2026-06-16  
**Sources:** [CONTEXT.md](../../CONTEXT.md), [CLI-HELP.md](../CLI-HELP.md), [ISSUES/README.md](../../ISSUES/README.md)

---

## Problem Statement

Developers who pay for **ChatGPT/Codex** and **Claude Max** subscriptions want to use those entitlements inside **Cursor** instead of metered OpenAI or Anthropic API keys. Cursor's cloud backend calls a user-configured custom OpenAI **Base URL** and **cannot reach private networks** (`127.0.0.1`, RFC1918) — so a local proxy alone is insufficient; the proxy must be reachable at a **public HTTPS endpoint**.

Community proxies solve pieces of this problem in isolation: Codex-only tools, Claude-only tools, manual tunnel setup, inconsistent model suffix conventions, no dual-provider routing from one endpoint, fragile auth reuse, and no cross-platform background service story. Users face fragmented setup (separate tools per provider, separate tunnels, hand-invented API keys), broken Cursor flows when `session_id` / `prompt_cache_key` misalign or when Cursor sends Responses-shaped bodies to a Chat-Completions-only proxy, and silent failures when quick-tunnel URLs change after reboot.

**ePort v1** addresses this for individual developers on **macOS and Windows**: one OpenAI-compatible **edge protocol** surface for the **Cursor client**, **dual auth** (Codex + Claude) behind model-based routing, stable **named Cloudflare tunnel** by default, subscription-grade features (session continuity, encrypted reasoning passthrough, concurrency cap, **account queue** rotation, multimodal input, BYOK validation bypass), and a first-class CLI for install, auth, config, tunnel, and service lifecycle — distributed via npm/bun without requiring standalone binaries.

---

## Solution

**ePort** is a local OpenAI-compatible proxy that:

1. Exposes a public HTTPS **Base URL** (via **named Cloudflare tunnel** by default) so Cursor's cloud backend can reach it.
2. Accepts the **edge protocol** Cursor sends — `POST /v1/chat/completions` and/or `POST /v1/responses` — on a single endpoint with one **proxy API key**.
3. Routes by model name or **model alias** to the correct **upstream provider**: Codex subscription (`chatgpt.com/backend-api/codex/responses`) or Claude subscription (**Anthropic Messages API**).
4. Uses **hybrid auth** per provider: reuse fresh CLI credentials when available (`~/.codex/auth.json`, Claude Code credentials), otherwise ePort OAuth (`eport auth login`).
5. Parses **suffix grammar** and **effort precedence** (body → suffix → **default effort profile** → global default; separate **fast mode** stack on Codex only) so users can set-and-forget defaults or override per request via custom model names.
6. Returns a **full dynamic catalog** from `GET /v1/models` reflecting all models accessible from logged-in accounts.
7. Provides CLI commands for init, up, status, auth, accounts, api-key, config (flag one-liner + **interactive config**), tunnel setup, and **service mode** (Windows schtasks + macOS launchd).

After `eport up`, the user pastes a copy-paste block (Base URL ending in `/v1`, **proxy API key**, suggested custom models) into Cursor Settings → Models → OpenAI, clicks Verify (**BYOK validation bypass** via `GET /health`), adds custom models, and chats or runs agents through paid subscriptions — no API metering.

---

## User Stories

### Install and distribution

1. As a new user on macOS or Windows, I want to install ePort with `npm i -g eport` or run it once with `bunx eport`, so that I can start without building from source or downloading a standalone binary.
2. As a user without Node.js, I want clear prerequisites (Node.js 20+ or Bun 1.1+) documented at install time, so that I know what to install first.
3. As a user on a fresh machine, I want `eport init` to create `~/.eport/` and auto-generate a **proxy API key** if none exists, so that I can configure auth and tunnel before starting the proxy.
4. As a user, I want `eport --version` to print the package version, so that I can confirm which release I am running when reporting issues.
5. As a user, I want global flags (`--tunnel`, `--fast`, `--verbose`, `--help`) documented consistently, so that session overrides behave predictably across commands.

### Auth — hybrid dual provider

6. As a Codex subscriber, I want ePort to reuse fresh credentials from `~/.codex/auth.json` when I have already run `codex login`, so that I skip redundant OAuth.
7. As a Claude Max subscriber, I want ePort to reuse fresh Claude Code credentials when available, so that I skip redundant OAuth for Claude routes.
8. As a user missing or stale on either provider, I want `eport auth login` to authenticate all missing/stale providers, so that one command gets me dual-routing ready.
9. As a user who only uses Codex in Cursor, I want `eport auth login codex` to log in to Codex only, so that I am not forced through Claude OAuth.
10. As a user who only uses Claude in Cursor, I want `eport auth login claude` to log in to Claude only, so that I am not forced through Codex OAuth.
11. As a user, I want `eport auth status` to show both providers' credential source (CLI reuse vs ePort OAuth), expiry, and refresh need, so that I can fix auth before Cursor requests fail.
12. As a user, I want proactive background token refresh with coalesced in-flight refresh (not blocking every request), so that time-to-first-token stays low.
13. As a user who ran `codex logout` or revoked Claude access, I want clear CLI guidance to re-run `eport auth login`, so that I understand `refresh_token_expired` failures.
14. As a user, I want **dual auth** to keep Codex and Claude credential stores independent, so that one provider expiring does not invalidate the other route.

### Tunnel — named, quick, none

15. As a Cursor user, I want `eport up` to default to a **named tunnel** with a stable public hostname, so that my Cursor Base URL survives restarts and reboots.
16. As a user trying ePort for the first time, I want `eport up --tunnel quick` to spawn an ephemeral `*.trycloudflare.com` URL without Cloudflare dashboard setup, so that I can validate the proxy quickly.
17. As a user with my own public URL (VPS, ngrok, etc.), I want `eport up --tunnel none` to run the local proxy only, so that I supply external forwarding myself.
18. As a user setting up a named tunnel, I want `eport tunnel setup named` to prompt for tunnel token and public hostname and save them to the **config profile**, so that I do not hand-edit config files.
19. As a user, I want `eport tunnel setup` (interactive) to explain named vs quick and guide token vs hostname collection, so that I understand Cloudflare Zero Trust setup.
20. As a user, I want `eport tunnel setup quick` to set default tunnel mode to quick in config, so that subsequent `eport up` runs use quick mode without a flag.
21. As a user, I want the README and CLI to warn that quick tunnel URLs change on every restart, so that I do not silently break Cursor after a reboot.
22. As a user, I want ePort to manage `cloudflared` lifecycle (connect, reconnect on drop) for named mode, so that the proxy stays reachable without manual tunnel babysitting.
23. As a user on a custom domain, I want documentation that Cloudflare tunnel features are free but the domain may cost money, so that I budget correctly.

### Cursor setup

24. As a Cursor user, I want `eport up` to print a copy-paste block with Base URL (`https://<hostname>/v1`), **proxy API key**, and suggested custom models, so that Cursor setup is one paste operation.
25. As a Cursor user, I want to enable "Override OpenAI Base URL" and paste the tunnel URL ending in `/v1`, so that Cursor's cloud backend reaches ePort over HTTPS.
26. As a Cursor user, I want the Verify button to succeed via `GET /health` (**BYOK validation bypass**), so that Cursor accepts my custom endpoint without validating against real OpenAI.
27. As a Cursor user, I want to never use `http://localhost:…` as Base URL for chat/agents, so that I avoid "Access to private networks is forbidden" errors.
28. As a Cursor user, I want to add custom models in the model picker (e.g. `gpt-5.5`, `gpt-5.5xhigh-fast`, `opus-4.8max`), so that I control effort and fast tier from model names.
29. As a Cursor user, I want one Base URL to cover both chat and agent flows regardless of whether Cursor sends Chat Completions or Responses bodies, so that I do not reconfigure per feature.
30. As a Cursor user, I want `GET /v1/models` to list all models my subscriptions expose, so that I can discover ids for the custom model picker without reading provider docs.
31. As a Cursor user, I want suffixed model ids in the catalog when helpful, so that I can pick `gpt-5.5xhigh` directly in Cursor.

### Codex route

32. As a Codex subscriber using Cursor, I want requests for Codex models (e.g. `gpt-5.5`) routed to the Codex subscription Responses API, so that I use my ChatGPT plan instead of API keys.
33. As a Cursor user on Codex routes, I want Responses-native passthrough when the wire format matches, so that latency stays low.
34. As a Cursor user on Codex routes, I want **session continuity** via aligned `session_id` and `prompt_cache_key`, so that tool calling does not degrade across turns.
35. As a Cursor user on Codex routes, I want **encrypted reasoning** (`reasoning.encrypted_content`) forwarded unchanged, so that Cursor can display Codex reasoning blocks.
36. As a power user, I want a **concurrency cap** on simultaneous upstream Codex requests, so that I avoid rate-limit storms and upstream overload.
37. As a Cursor user, I want Codex usage windows (5h / weekly) surfaced in `eport status` when available, so that I know quota headroom.
38. As a Cursor user sending multimodal input on Codex routes, I want text, images, and attachments translated to Codex upstream format, so that image paste and attachments work in chat and agents.

### Claude route

39. As a Claude Max subscriber using Cursor, I want Claude-routed models (e.g. `opus-4.8max`) forwarded to the **Anthropic Messages API**, so that I use my Claude subscription instead of API keys.
40. As a Cursor user on Claude routes, I want ePort to accept both `POST /v1/chat/completions` and `POST /v1/responses` on the **edge protocol** and normalize internally (Claude path B per ADR 0001), so that any Cursor version or flow works.
41. As a Cursor user on Claude routes, I want the response stream converted back to the OpenAI-shaped stream the client used (chat chunks or response events), so that Cursor renders output correctly.
42. As a Cursor user on Claude routes, I want **model alias** normalization (e.g. `claude-4.6-opus-high`, `cc/claude-opus-4-6`, `opus-4.8`) to resolve to official Anthropic upstream ids, so that I type Cursor-friendly names.
43. As a Cursor user on Claude routes, I want invalid Codex-only suffixes like `opus-4.8xhigh` rejected with a clear error, so that I do not silently get wrong effort behavior.
44. As a Cursor user on Claude routes, I want no **fast mode** applied (no `-fast` suffix, no global fast override), so that I understand Claude routes have no priority tier.
45. As a Cursor user sending multimodal input on Claude routes, I want content parts translated to Anthropic message blocks (including known Cursor image workarounds), so that images work in Claude-routed chat.

### Config wizard, suffix grammar, effort, fast mode

46. As a user, I want `eport config model gpt-5.5 --effort xhigh` to save a **default effort profile** for bare `gpt-5.5`, so that Cursor bare model names use my preferred reasoning without suffixes.
47. As a user, I want `eport config model opus-4.8 --effort max` to save Anthropic-native effort for Claude models, so that config values match provider APIs.
48. As a user, I want `eport config` (interactive **interactive config**) with provider-aware effort radio buttons and Codex-only fast checkbox, so that guided setup matches flag one-liners.
49. As a user finishing the wizard, I want the **flag equivalent** one-liner printed, so that I can script or repeat the same settings.
50. As a user, I want **effort precedence** locked: request body effort/thinking (Q11) → model suffix → per-model default → global default, so that Cursor body intent wins when present.
51. As a user, I want body effort to beat suffix (e.g. `gpt-5.5xhigh` + body `medium` → `medium`), so that harness/settings overrides model picker suffixes.
52. As a user, I want Codex **suffix grammar** `[bare-model-id][effort-token][-fast]` (e.g. `gpt-5.5xhigh-fast`), so that one custom model string encodes effort and fast tier.
53. As a user, I want Claude **suffix grammar** `[bare-model-id][effort-token]` only (e.g. `opus-4.8max`), so that I do not confuse Codex fast suffixes with Claude routes.
54. As a user, I want `eport config --fast on` to set **global fast override** (Codex `service_tier: priority` on every Codex request), so that I avoid adding `-fast` to every custom model.
55. As a user, I want `eport up --fast` to apply fast override for one session only without changing saved config, so that I can experiment temporarily.
56. As a user, I want `eport config --tunnel named|quick|none` to persist default **tunnel mode**, so that `eport up` respects my daily-driver preference.
57. As a user, I want all settings in `~/.eport/config` without hand-editing, so that the **config profile** is always CLI-managed.

### Account queue

58. As a power user with multiple Codex accounts, I want `eport accounts add codex` to OAuth and append to the **account queue**, so that I have backup quota.
59. As a power user with multiple Claude accounts, I want `eport accounts add claude` to use the same queue pattern, so that Claude failover matches Codex mental model.
60. As a user, I want `eport accounts list` to show queue order and active marker per provider, so that I know which account serves requests.
61. As a user, I want `eport accounts switch codex 2` to immediately make account #2 active, so that I can manually pick work vs personal accounts.
62. As a user, I want `eport accounts reorder codex 2 1 3` to set queue order with the first index becoming active, so that I control failover priority.
63. As a user hitting **429** rate limits, I want automatic rotation to the next account with the exhausted account moved to the back, so that Cursor requests retry without my intervention.
64. As a user hitting **401** auth failures, I want token refresh attempted first and rotation only if refresh fails, so that transient expiry does not skip accounts unnecessarily.
65. As a user, I want `eport accounts status` to show active account, queue length, rotation policy, and last rotation reason in verbose mode, so that I can debug failover.
66. As a user, I want `eport status` to show active Codex and Claude accounts when the proxy is running, so that runtime and config views stay aligned.

### Proxy API key

67. As a user with a public tunnel, I want a cryptographically random **proxy API key** auto-generated on first `eport up` or `eport init`, so that my tunneled endpoint is not an open faucet on my subscriptions.
68. As a user, I want `eport api-key show` to display the current key for Cursor or curl, so that I can recover it without rotating.
69. As a user, I want `eport api-key rotate` to invalidate the old key immediately and print a new Cursor paste block, so that I can respond to key compromise quickly.
70. As a user running `--tunnel none` locally, I want the proxy API key to be optional, so that local-only setups stay simple.

### Multimodal

71. As a Cursor user, I want all Cursor input types (text, images, attachments) supported on Codex routes in v1, so that paste-image and attachment flows match native Cursor behavior.
72. As a Cursor user, I want all Cursor input types supported on Claude routes in v1, so that dual routing does not regress multimodal on Opus/Sonnet.
73. As a user, I want known Cursor image-upload workarounds applied at translation boundaries, so that upstream providers accept image parts reliably.

### Status, usage, observability

74. As a user, I want `eport status` to report proxy running state, tunnel URL/mode, auth expiry, active accounts, config summary, and Codex usage when available, so that one command diagnoses setup.
75. As a user, I want `eport status --json` for scripting, so that automation can monitor ePort.
76. As a user, I want one-line structured request logs by default (model, effort, fast, latency, tokens), so that hot-path latency is not harmed by verbose dumps.
77. As a user, I want `--verbose` / `--log verbose` for full request/upstream dumps when debugging, so that I can deep-dive without changing code.
78. As a user, I want `eport status` to show catalog age and model count per provider when dynamic catalog is stale, so that I know when to re-auth or refresh.

### Service install — Windows and macOS

79. As a macOS user, I want `eport service install` to register a launchd user agent, so that proxy and named tunnel start at login without an open terminal.
80. As a Windows user, I want `eport service install` to register a scheduled task (schtasks), so that proxy and named tunnel start at logon.
81. As a user, I want `eport service start|stop|restart|status|uninstall`, so that I manage background lifecycle from CLI.
82. As a user, I want CLI warnings against `eport service install` with quick tunnel mode, so that I do not get silent Cursor breakage after service restarts.
83. As a Windows user, I want guidance to run service install from an elevated shell when schtasks reports access denied, so that install succeeds on locked-down machines.
84. As a user, I want `eport service status` to complement `eport status` with OS service state and log tail in verbose mode, so that background deployments are debuggable.

### Platform — Windows + Mac parity

85. As a macOS user, I want full feature parity (auth, tunnel, config, accounts, service), so that ePort is not Windows-second-class.
86. As a Windows user, I want full feature parity (auth, tunnel, config, accounts, service), so that ePort is not Mac-only.
87. As a cross-platform user, I want hybrid auth to resolve Codex CLI auth paths correctly on Windows, so that `~/.codex/auth.json` reuse works on both OSes.
88. As a cross-platform user, I want the same **suffix grammar**, **effort precedence**, and CLI command surface on both platforms, so that documentation and Cursor custom models are portable.

### Edge cases and troubleshooting

89. As a user, I want clear errors when an unknown model fails routing after alias resolve, so that I add the correct custom model from `GET /v1/models`.
90. As a user, I want 5xx upstream errors surfaced without account rotation, so that I do not burn through accounts on provider outages.
91. As a user, I want `curl` examples with `Authorization: Bearer $(eport api-key show)` for `/v1/models`, so that I can verify routing outside Cursor.
92. As a user, I want session overrides (`eport up --tunnel quick`, `eport up --fast`) to not mutate saved **config profile**, so that one-off experiments do not corrupt defaults.

---

## Implementation Decisions

Architecture follows grill decisions Q1–Q11: one Cursor endpoint, **dual auth**, language-agnostic components chosen per hot-path latency and cross-platform support, npm/bun distribution for v1. Deep modules below expose simple interfaces and encapsulate vendor-learned behavior (session continuity, encrypted reasoning, BYOK bypass, account rotation). ADRs hold detailed rationale — referenced here, not duplicated.

### Edge router (OpenAI Chat + Responses ingress)

**Responsibility:** HTTP server facing the **Cursor client** on the public HTTPS endpoint. Terminates TLS at the tunnel; validates **proxy API key** when tunnel is public; routes by path and model.

**Ingress surface:**

| Method / path | Purpose |
|---------------|---------|
| `GET /health` | BYOK validation bypass for Cursor Verify |
| `GET /v1/models` | Dynamic catalog (delegates to model resolver + catalog fetcher) |
| `POST /v1/chat/completions` | Chat Completions **edge protocol** |
| `POST /v1/responses` | Responses **edge protocol** |
| `GET /usage` (optional v1) | Operator visibility for Codex limits |

**Behavior:**

- Authenticate `Authorization: Bearer <proxy-api-key>` on public tunnels; optional skip for `--tunnel none`.
- Extract model id from body; hand off to **model resolver** for route (Codex vs Claude), alias normalize, suffix parse, effort/fast resolution.
- Codex route: prefer Responses-native passthrough when client shape matches upstream; translate Chat Completions → Responses when needed.
- Claude route: accept **both** edge shapes (ADR 0001 path B); detect protocol shape; normalize to internal representation; delegate to **Claude translator**; serialize response in the same OpenAI shape the client used.
- Apply **concurrency cap** before Codex upstream dispatch (queue excess requests; unrelated to **account queue**).
- On upstream 429/401, delegate retry/rotation to **auth manager** / account queue policy (ADR 0002).
- Default logging: one-line structured summary per request; verbose gated.

**Interface (conceptual):**

```typescript
type EdgeRequest = {
  path: '/v1/chat/completions' | '/v1/responses' | '/v1/models' | '/health';
  headers: Record<string, string>;
  body: unknown;
};

type ResolvedRoute = {
  provider: 'codex' | 'claude';
  canonicalModelId: string;
  effort: string | null;
  fastTier: boolean;
  edgeShape: 'chat' | 'responses';
};

interface EdgeRouter {
  handle(req: EdgeRequest): Promise<Response>;
}
```

### Model resolver (alias normalize, suffix parse, effort precedence)

**Responsibility:** Turn client model string + request body + **config profile** into a `ResolvedRoute` and upstream parameters. Single sanitize pass per request (no double suffix work downstream).

**Pipeline (order locked):**

1. **Alias normalize** — map Cursor-facing **model alias** strings to bare shorthand + provider route; resolve to official upstream id target (ADR 0004). Longest-match alias table; implementation data, refreshable from provider catalogs.
2. **Suffix parse** — apply **suffix grammar** after alias resolve (ADR 0003):
   - Codex: `[bare-model-id][effort-token][-fast]`
   - Claude: `[bare-model-id][effort-token]` only; reject Codex-only tokens (`xhigh`, `-fast`).
3. **Effort precedence** (ADR 0005, Q11):
   - Body effort/thinking fields when present (Codex: `reasoning.effort`, `reasoning_effort`, `reasoning`; Claude: same plus `thinking`, `thinking.budget_tokens`, Anthropic effort fields on normalized internal request).
   - Else suffix effort token.
   - Else **default effort profile** for bare model in config.
   - Else global default.
   - Body beats suffix always.
4. **Fast mode stack** (Codex only): body `service_tier` → `-fast` suffix → per-model config → **global fast override** / session `--fast`.
5. Emit **bare model name** (post-strip) for upstream forward and config key lookup.

**Dynamic catalog (`GET /v1/models`):**

- Aggregate models from all logged-in Codex and Anthropic accounts (active queue credentials).
- Merge/tag by provider; optional suffixed ids for picker convenience.
- TTL cache; refresh on auth login, account switch, periodic poll; stale degrade with status warning.

**Interface:**

```typescript
interface ModelResolver {
  resolve(model: string, body: unknown, config: ConfigProfile): ResolvedRoute;
  listModels(): Promise<OpenAIModelList>;
}
```

### Codex upstream client

**Responsibility:** Authenticated HTTP to Codex subscription Responses API. Direct HTTP only — no subprocess on hot path.

**Must-have behaviors (vendor must-haves):**

- Attach subscription auth from **auth manager** (active Codex **account queue** head).
- Align `session_id` header with body `prompt_cache_key` for **session continuity**.
- Passthrough **encrypted reasoning** unchanged.
- Map resolved effort to `reasoning.effort`; map fast tier to `service_tier: priority`.
- Shared keep-alive HTTP client; coalesced token refresh before request.
- Stream: Responses SSE passthrough when possible; else translate events to client's edge shape.
- Sanitize payload: system → instructions, strip unsupported fields, force `stream: true`, `store: false` where vendor pattern requires.
- Multimodal: translate Cursor content parts to Codex upstream format.
- Retry once on 429/401 per ADR 0002 after account promotion or refresh.

**Interface:**

```typescript
interface CodexUpstream {
  complete(request: NormalizedCodexRequest, auth: CodexCredentials): AsyncIterable<UpstreamEvent>;
}
```

### Claude translator (OpenAI → Anthropic Messages)

**Responsibility:** Provider boundary for Claude routes. Converts normalized internal request (from either edge protocol) to **Anthropic Messages API**; converts Anthropic SSE stream back to OpenAI chat or Responses stream matching client ingress.

**Must-have behaviors (ADR 0001):**

- Dual ingress parsers: Chat Completions messages/tools/stream chunks; Responses input items/reasoning blocks/tools.
- Normalize to internal messages + tools + effort/thinking + multimodal parts.
- Map resolved effort to Anthropic-native thinking/effort parameters — never emit Codex `xhigh` upstream.
- Translate OpenAI-style body effort labels to Anthropic-native at boundary when needed.
- Image/attachment workarounds for known Cursor upload quirks.
- Direct HTTPS to `api.anthropic.com`; shared keep-alive client.
- Retry once on 429/401 per ADR 0002.

**Interface:**

```typescript
interface ClaudeTranslator {
  translateRequest(normalized: NormalizedClaudeRequest): AnthropicMessagesRequest;
  translateStream(
    upstream: AsyncIterable<AnthropicStreamEvent>,
    edgeProtocol: 'chat' | 'responses'
  ): AsyncIterable<OpenAIShapedEvent>;
}
```

### Auth manager (hybrid dual provider + account queue)

**Responsibility:** Credential lifecycle for **dual auth** — Codex and Claude independent stores; **hybrid auth** (CLI reuse when fresh, else ePort OAuth tokens); **account queue** rotation (ADR 0002).

**Per provider:**

- Ordered account list with active pointer; persist queue order and labels.
- `add`: run OAuth, append to queue.
- `switch`: move chosen account to front, immediate active.
- `reorder`: set order; first index becomes active.

**Rotation policy:**

| Trigger | Action |
|---------|--------|
| 429 | Promote next; exhausted to back; retry once |
| 401 | Coalesced refresh current; on failure promote next; retry once |
| Manual switch | Active changes for subsequent requests only |

**Hybrid sources:**

- Codex: read `~/.codex/auth.json` when fresh; else ePort-stored OAuth.
- Claude: read Claude Code credentials when fresh; else ePort OAuth.

**Proactive refresh:** background scheduler + coalesced `inflightRefresh` promise; never synchronous refresh on every request.

**Interface:**

```typescript
interface AuthManager {
  getCredentials(provider: 'codex' | 'claude'): Promise<Credentials>;
  handleUpstreamError(provider: 'codex' | 'claude', status: 401 | 429): Promise<'retry' | 'fail'>;
  status(): AuthStatusSummary;
  login(provider?: 'codex' | 'claude'): Promise<void>;
}
```

### Tunnel manager (named / quick / none)

**Responsibility:** Expose local proxy on public HTTPS per **tunnel mode** (ADR Q4 default: named).

| Mode | Behavior |
|------|----------|
| **named** | Run `cloudflared` with saved token; stable hostname from config; reconnect on drop |
| **quick** | Ephemeral `*.trycloudflare.com` per run; no dashboard setup |
| **none** | No tunnel; user supplies external URL |

- Persist token + hostname via setup commands; default mode in **config profile**.
- Session override: `eport up --tunnel quick` without saving.
- Warn when service install combined with quick mode.
- Print public Base URL (`https://<host>/v1`) for Cursor paste block.

**Interface:**

```typescript
type TunnelMode = 'named' | 'quick' | 'none';

interface TunnelManager {
  start(mode: TunnelMode, localPort: number): Promise<{ publicBaseUrl: string | null }>;
  stop(): Promise<void>;
  status(): TunnelStatus;
}
```

### Config store (`~/.eport/config`)

**Responsibility:** Persist **config profile** — no hand-editing required.

**Stored fields:**

- **Proxy API key** (auto-generated)
- Per-model **default effort profile** (provider-appropriate values)
- **Global fast override**
- Default **tunnel mode**; named tunnel token + hostname
- Account queue metadata (order, labels, active pointers) — may be adjacent store if separation helps
- Optional: catalog cache timestamps

**Entry paths (equivalent writes):**

- Flag one-liner (`eport config model …`, `eport config --fast on`, `eport config --tunnel named`)
- **Interactive config** wizard with provider-aware effort radios + Codex fast checkbox; always emit **flag equivalent**
- `eport init` / first `eport up` for API key generation

**Interface:**

```typescript
interface ConfigStore {
  load(): ConfigProfile;
  save(partial: Partial<ConfigProfile>): void;
  getModelDefault(bareModel: string): ModelDefaults | null;
}
```

### Service installer (schtasks + launchd)

**Responsibility:** **Service mode** — OS auto-start for proxy + tunnel without open terminal (ADR Q9).

| Platform | Mechanism |
|----------|-----------|
| Windows | Scheduled task (`schtasks`), logon trigger; pattern from codex-cursor-proxy vendor |
| macOS | launchd user agent plist |

**CLI:** `install`, `uninstall`, `start`, `stop`, `restart`, `status`.

- Install invokes same entrypoint as `eport up` with saved config (named tunnel expected).
- Uninstall removes registration only; does not delete config or auth.
- Status reports OS service state, tunnel URL, auth summary; verbose log tail.

**Interface:**

```typescript
interface ServiceInstaller {
  install(): Promise<void>;
  uninstall(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  status(): ServiceStatus;
}
```

### CLI layer

**Responsibility:** User-facing commands per CLI-HELP spec; orchestrates modules above; prints Cursor paste block, flag equivalent, NEXT STEPS guidance.

Commands: `up`, `init`, `status`, `auth`, `accounts`, `api-key`, `config`, `tunnel`, `service`.

Distribution: public npm package `eport`; engines Node 20+ / Bun 1.1+.

### Cross-cutting concerns

- **BYOK validation bypass:** `GET /health` returns success without upstream API key validation.
- **Implementation stack:** language-agnostic per component; document per-component runtime choices in implementation PRs (Q7).
- **Logging:** structured one-liner default; defer heavy body dumps to verbose.
- **HTTP clients:** one long-lived client per upstream host with keep-alive.

---

## Testing Decisions

### What makes a good test

- Test **external behavior** only — HTTP request in, HTTP/SSE response out, config file side effects, CLI stdout/stderr.
- Do **not** test private method call order, internal cache key strings, or log formatting details unless user-visible.
- Prefer golden fixtures for translation edges (multimodal parts, tool calls, stream chunk sequences) over mocking upstream unless integration tests use recorded fixtures.
- Table-driven tests for **suffix grammar**, **effort precedence**, and alias normalize — highest ROI, lowest flake.

### Modules that must have automated tests

| Module | Priority | Focus |
|--------|----------|-------|
| **Model resolver** | P0 | Alias normalize; suffix parse Codex/Claude; effort precedence (body over suffix); fast stack Codex-only; invalid Claude tokens rejected |
| **Claude translator** | P0 | Chat + Responses ingress → Anthropic request; stream back to both edge shapes; effort mapping never emits `xhigh` |
| **Edge router** | P1 | Route by model; API key gate; `/health`; protocol detection dispatches correct translator |
| **Auth manager** | P1 | 429 rotate order; 401 refresh-then-rotate; manual switch; coalesced refresh single-flight |
| **Config store** | P1 | Wizard vs flags write equivalent profile; session overrides do not persist |
| **Codex upstream client** | P1 | session_id/prompt_cache_key alignment; encrypted reasoning passthrough; sanitize required fields |
| **Tunnel manager** | P2 | Mode selection; URL composition; none mode returns null public URL |
| **Service installer** | P2 | Smoke tests per platform where CI allows; mock OS commands on unsupported CI |

CLI integration tests: spawn `eport` subprocess with temp `HOME` / config dir; assert `--help` text matches CLI-HELP spec for key commands.

### Prior art from vendor test patterns

- **codex-proxy-ts** — extensive protocol conversion tests (`tests/`): suffix stripping, OpenAI↔Codex translation edge cases; borrow table-driven fixture style, not codebase weight.
- **codex-cursor** — session_id alignment documented in upstream module; add regression test from vendor bug narrative.
- **openai-api-server-via-codex** — `test_openai_compat_server.py` pattern for OpenAI-compat HTTP assertions.
- **codex-openai-proxy** — auth refresh + 401 retry loop tests in Rust; mirror behavior for auth manager.
- **sub-bridge / ccproxypal** — Claude OpenAI-compat → Anthropic golden streams; reuse multimodal and alias normalize cases.

### Out of scope for automated tests in v1

- Live Cloudflare tunnel connectivity (manual / staging smoke).
- Live OAuth browser flows (mock token exchange).
- Cursor IDE end-to-end (manual test plan).
- Performance benchmarks (manual comparison acceptable for v1).

---

## Out of Scope

The following are explicitly **not** in ePort v1:

| Item | Notes |
|------|-------|
| **Tauri / Electron desktop app** | CLI + npm distribution only; desktop shell deferred |
| **Standalone binaries** | No macOS `.app` or Windows `.exe` installer in v1; npm/bun only (Q8) |
| **Team dashboard / multi-user** | No SQLite team quotas, web dashboard, or shared API keys (code-proxy patterns) |
| **Cursor Agent outbound routing** | claude-code-proxy "Cursor provider" direction (Claude Code → Cursor Agent API) — wrong direction for ePort |
| **Subprocess Claude ToS path** | No `claude --print` spawn per request (claude-code-proxy-subprocess); direct HTTP Anthropic Messages only for Cursor hot path |
| **Tailscale / LAN-only Cursor** | Cursor cloud cannot use tailnet; document for Claude Code / CLI only |
| **Third-party providers** | No Kimi, Gemini, Ollama, Cursor Agent as upstream in v1 |
| **Anthropic `/v1/messages` edge server** | v1 Cursor-facing surface is OpenAI-compatible only; Claude Code local Anthropic server is future scope |
| **MCP-native install deeplink** | sub-bridge MCP onboarding pattern — future UX enhancement |
| **Docker / Kubernetes deployment** | Personal local tool first |

---

## Further Notes

### Related documentation (do not duplicate here)

- **[CONTEXT.md](../../CONTEXT.md)** — glossary terms used throughout this PRD
- **[CLI-HELP.md](../CLI-HELP.md)** — verbatim `--help` specification for implementation
- **[ISSUES/README.md](../../ISSUES/README.md)** — dependency-ordered vertical implementation slices
- **[cursor-agent-parity.md](./cursor-agent-parity.md)** — Agent tool-call streaming, multimodal, and reasoning parity (Codex + Claude)

### Vendor steal list (implementation guidance)

Primary references under `vendors/` (local clones, gitignored):

1. **codex-cursor** — Codex↔OpenAI core, session_id alignment, encrypted reasoning, client effort wins
2. **codex-cursor-proxy** — named CF tunnel lifecycle, Windows schtasks, usage windows, concurrency cap
3. **sub-bridge** — multi-provider routing, Claude↔Cursor mapping, BYOK bypass pattern
4. **ccproxypal** — Cursor Claude name normalization regex, Claude OAuth headers
5. **codex-proxy-ts** (patterns only) — suffix parser, protocol test fixtures

Avoid vendoring codex-proxy-ts codebase (license + weight). Avoid code-proxy team dashboard unless scope expands.

### Known gaps (documented, not blocking v1)

- **Service + quick tunnel** — warn users; use named tunnel with service install
- **`--fast` Codex-only** — document in help and interactive config
- **Anthropic ToS** — document token extraction risks; v1 uses direct HTTP not subprocess ToS-safe path
- Quick tunnel was considered as default in early sketches — **grill Q4 locked named tunnel as default**
- **Cursor Agent / tool-call / multimodal parity** — slices 04–07 deliver text-first routing; full Agent loop (tool egress/ingress, images, reasoning round-trip on chat path) is specified in **[cursor-agent-parity.md](./cursor-agent-parity.md)** and must land in slices **11–16** before slice **17** manual Agent checklist passes

### Suggested implementation slice order

See **[ISSUES/README.md](../../ISSUES/README.md)** for dependency-ordered vertical slices (01–17). Each slice should ship test coverage for its deep module(s) before moving on.

**Agent parity** (tool streams, multimodal, reasoning egress) — see **[cursor-agent-parity.md](./cursor-agent-parity.md)**; slices **11–16** after slice 07, then slice **17** HITL smoke.
