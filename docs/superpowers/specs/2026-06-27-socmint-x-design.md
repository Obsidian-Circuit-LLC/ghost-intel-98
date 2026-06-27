# Ghost Intel 98 — X/Twitter Collector (Clearnet Module) — Draft Design Spec

**Status:** DESIGN/RESEARCH ONLY. No application code written. Primary-source research complete; items the research could not fully verify are marked **[UNVERIFIED]**. All codebase anchors are from direct reads of the repo; none are invented. Produced by a design-research agent (2026-06-27), reviewed and accepted by the orchestrator.

**Operator decision in effect (2026-06-27):** Build the X collector now as a quarantined clearnet module. Operator accepts: Python sidecar runtime, scraper breakage on a 2–4 week cadence, and the requirement that absence/partial results must surface as an explicit error state and never as "no results."

**Basis:** SOCMINT v1 spec (`docs/superpowers/specs/2026-06-26-socmint-module-design.md`, §1, §2, §4), all cited files read directly from `feat/socmint-telegram-v1`. Web research via primary sources; URLs cited inline.

---

## 0. Honest baseline

### 0.1 twscrape — primary source read

Source: pypi.org/project/twscrape/ and github.com/vladkens/twscrape, both fetched.

**Current version:** 0.19.1, released 2026-06-26. The v0.19.1 release notes read "Updated GraphQL operation IDs for current X API compatibility" — this is the doc_id rotation in practice: the maintainer updates hardcoded operation IDs every 2–4 weeks to restore API access after X rotates them. Release cadence over the last eight releases is roughly every 2–4 weeks. **The maintenance model is: break → patch → break → patch, indefinitely.**

**License:** MIT. **Python requirement:** 3.10+ (support through 3.14).

**Authentication model:** Operator-supplied account pool. Two modes: (a) cookie-based — extract `auth_token` and `ct0` from a logged-in browser session and inject via CLI (documented as the most stable setup); (b) username/password with optional email-IMAP verification. The library stores sessions in SQLite and rotates accounts when one hits a rate limit. No API key or developer app required. Account-ban risk is real; the numeric threshold is **[UNVERIFIED]**.

**v0.19.0 note:** introduced a `curl-cffi` backend for TLS fingerprint impersonation (native extensions — implications for PyInstaller bundling, §2.2).

**Tweet model fields** (from `twscrape/models.py`): `id`, `id_str`, `url` (permalink), `date`, `rawContent` (text), `lang`, reply/retweet/like/quote counts; nested `User` with `id_str`, `username` (@handle), `displayname`. Permalink `url` is `https://x.com/<username>/status/<id_str>`.

### 0.2 Pure-JS alternative verdict

`@the-convocation/twitter-scraper` v0.22.3 (2026-04-01) exists but is **not a functional equivalent** to twscrape for multi-account pooled bulk collection (no account-pool rotation, no SQLite session management; subject to Cloudflare Turnstile). The v1 finding that there is "no maintained pure-JS equivalent" holds for this use case. **twscrape (Python) is the correct choice.**

### 0.3 Breakage characteristics

X rotates GraphQL operation IDs (doc_ids) every 2–4 weeks (confirmed by twscrape release history — primary-source). The operationally critical mode is **silent truncation/redirect rather than a clean error**: X may return HTTP 200 with an empty payload, or a GraphQL "invalid" rather than "failed." The sidecar must detect and surface this (§4). Specific monthly breakage event dates compiled from web sources are **[UNVERIFIED]** against X's own (unpublished) changelogs.

---

## 1. Schema mapping: X post → HarvestedItem

`HarvestedItem` (`src/shared/socmint/types.ts`) is platform-generic. Only change: extend `SocmintPlatform` to `'telegram' | 'x'` (and `'whatsapp'` per the WhatsApp spec).

| HarvestedItem field | ← twscrape field |
|---|---|
| `id` | SHA-256 of `x:${channelId}:${tweet.id_str}` (reuse `harvestedItemId`) |
| `platform` | `'x'` |
| `authorHandle` | `tweet.user.username` (no leading @) |
| `authorId` | `tweet.user.id_str` |
| `text` | `tweet.rawContent` |
| `channelId` | analyst query string OR `@username` (see §1.1) |
| `channelLabel` | analyst-supplied label |
| `messageId` | `tweet.id_str` |
| `publishedAt` | `tweet.date` UTC ISO 8601 (never `Date.now()`) |
| `harvestedAt` | injected clock |
| `url` | `tweet.url` (scheme-guard to `https://x.com/` / `https://twitter.com/`) |
| `mediaType` | `'photo'\|'video'\|'gif'` if present, else absent |
| `mediaRef` | absent in v1 (no media retrieval, §5.4) |
| `provenance.keyword` | the search query or username |

### 1.1 Collection modes & channelId semantics

X has no stable channel entity. Two modes: **keyword-search** (`channelId` = percent-encoded query; sidecar `search` request) and **user-timeline** (`channelId` = `@username`; sidecar `userTweets` request). Both flow through the same `upsertItems`/dedup/rank pipeline; `provenance.keyword` carries the raw query/username for provenance.

---

## 2. Sidecar architecture

### 2.1 Why a Python sidecar
twscrape is Python; no viable Node equivalent (§0.2). Process isolation prevents a twscrape crash/hang from affecting Electron, makes the sidecar replaceable without rebuilding the app (relevant for the 2–4 week cadence), and creates a clean trust boundary. The pattern is already established in-repo: ML-KEM, ExifTool, Piper TTS, bundled Tor, local-ai. Reuse the lifecycle/path-resolution from `src/main/services/mlkem-sidecar.ts` and `exiftool.ts`.

### 2.2 Bundling: PyInstaller `--onedir` frozen binary
PyInstaller 6.x. **`--onedir`** (not `--onefile`): no per-launch temp self-extraction (latency + TOCTOU), keeps curl-cffi native libs in a predictable path, faster startup, easier integrity-check. Layout under `resources/twscrape-runner/<platform>/twscrape-runner/` with `_internal/`. extraResources entry `{ "from": "resources/twscrape-runner", "to": "twscrape-runner" }`. Path resolution mirrors `mlkem-sidecar.ts:54` (`app.isPackaged ? process.resourcesPath : join(app.getAppPath(),'resources')`).

**SEALED:** `resources/twscrape-runner/` does NOT exist in this build. `sidecarPath()` points at a non-existent binary; the start function `existsSync`-checks and returns `status:'sidecar-missing'` ("X collector sidecar not installed — pending operator lock") — distinct from a runtime error, no stub, no silent skip. SHA-256 pins are empty (dev pattern) until lock; any non-empty hash triggers verify-before-exec.

**Build constraints:** must NOT use `--noconsole` (sets stdio to None → breaks IPC). Per-platform build runners (no fragile cross-compile); each computes the executable SHA-256, committed into the sidecar client before the Electron build. **[UNVERIFIED]:** macOS code-signing/notarization requirements for curl-cffi native extensions.

### 2.3 JSON IPC contract (NDJSON over stdin/stdout)
Newline-delimited JSON; Node uses `readline` over stdout; stderr piped + scrubbed-logged. Spawn with `PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1`, `stdio:['pipe','pipe','pipe']`.

Requests: `{type:'ping'}`, `{type:'search',query,limit,since?,until?}`, `{type:'userTweets',username,limit,since?,until?}`, `{type:'shutdown'}`.
Responses: `{type:'pong'}`, `{type:'tweet',data:{...}}`, `{type:'done',count,truncated}`, `{type:'truncated',count,reason,message}`, `{type:'error',code,message,fatal}`.

**Wire invariants (load-bearing):**
1. Every run terminates with exactly one `done` | `truncated` | `error` frame — never both, never silence.
2. `done {truncated:false}` = fetched all up to `limit`, no rate-limit/GraphQL error, confident complete.
3. `truncated` = stopped short for any reason; MUST be sent even if zero tweets returned.
4. `error {fatal:true}` = whole run failed; `fatal:false` = mid-stream warning that does NOT replace the terminal frame.
5. A GraphQL 200 with empty `data`/`errors[]` is `truncated` (or `error` if zero), **never `done`**.
6. Doc_id rotation signature (HTTP 400/403, `errors[].extensions.name==='AuthorizationError'`, or empty data on a previously-good endpoint) → `error {code:'DOC_ID_ROTATION'}`, never a silent `done {count:0}`.

### 2.4 Lifecycle & teardown
**Per-job process** (not a daemon): spawned per collection run, exits after the terminal frame (or `shutdown`). No cross-job state accumulation. Flow: IPC handler checks `networkEnabled && clearnetAcknowledged` → resolve path → existsSync → SHA verify → spawn → 10s ping/pong → write request → readline accumulates `tweet` frames into `upsertItems()` in batches of 50 → on terminal frame send `shutdown`, wait ≤3s, SIGKILL. App-quit teardown: module-level child ref SIGKILL'd synchronously in `will-quit` (mirrors `BgconnTor.killSync()`). Credentials passed via stdin payload (NOT env, NOT argv). **[UNVERIFIED]:** whether twscrape's pool works cleanly in single-run mode (typical usage is a long-lived service) — validate empirically (§6 decision 4/5). Per-line cap 1 MB → `error {code:'PROTOCOL_ERROR'}`.

---

## 3. Clearnet quarantine invariant

### 3.1 Settings namespace isolation
Own top-level namespace, fully separate from `settings.socmint`:
```ts
x: {
  networkEnabled: boolean;        // default false
  clearnetAcknowledged: boolean;  // default false; set by an explicit confirm dialog, not just the toggle
}
```
The acknowledgement dialog states the clearnet nature ("connects to x.com over the public internet; your IP and request patterns are visible to X and any network observer; this cannot be routed through Tor") before `networkEnabled` can be enabled. Both flags checked at the IPC boundary before any sidecar path:
```ts
if (!settings.x.networkEnabled || !settings.x.clearnetAcknowledged) throw XCollectorGated;
```

### 3.2 Egress path isolation
The X collector must NEVER import/call `src/main/bgconn/*`, `src/main/chat/transport-tor.ts`, `src/main/chat/socks5.ts`, `src/main/searchlight/tor-socks.ts`, or `src/main/socmint/collector.ts`, and never route through the bgconn SOCKS port. All egress is the sidecar's own clearnet HTTPS to `x.com`/`api.x.com`; the Node side makes no network request for X.

### 3.3 Import-time assertion (test-enforced)
A test (`test/x-collector-contracts.test.ts`) statically asserts no import edge from `src/main/x/*` to the Tor/bgconn/Telegram-transport modules, and that `settings.x` and `settings.socmint` are distinct keys. Fails the suite if quarantine is broken.

---

## 4. FAIL-LOUD: truncation & breakage detection

The most dangerous failure is indistinguishable from success (HTTP 200 + zero/partial results read as "no posts"). This is the operator's explicit invariant.

### 4.1 Status enum
```ts
type XCollectorStatus = 'idle'|'running'|'done'|'partial'|'error'|'sidecar-missing'|'breakage-detected';
```
`partial` is NOT success — presented as "Collection stopped early — N results. Reason: […]. May be incomplete. Do NOT treat as evidence of absence." `done` is the only status whose result set may be treated as complete, and the UI still shows "N results (limit was M)."

### 4.2 XCollectResult → renderer
`{ status, itemsAdded, itemsSkipped, totalFromSidecar, truncationReason?, truncationMessage?, errorCode?, errorMessage?, jobId }`. Renderer must surface `status`/`totalFromSidecar`/reason whenever status ≠ `done`; never render an empty list under `done` without explanation.

### 4.3 Doc_id rotation detection
Sidecar detects rotation (HTTP 400/403 on a previously-good endpoint; `errors[].extensions.name` ∈ {AuthorizationError, BadRequest, Forbidden}; empty instructions on a known-valid query vs a within-job baseline) → `error {code:'DOC_ID_ROTATION', fatal:true}` → Node maps to `breakage-detected`, persistent banner ("X collector is broken — the X API changed. Update the twscrape-runner sidecar."). Exact X error strings **[UNVERIFIED]** — confirm at smoke test.

### 4.4 Zero-result guard
If the sidecar sends `done {count:0}`, the Node wrapper emits `partial` with `truncationReason:'unknown'` ("Sidecar reported done with zero results — may indicate breakage or an overly narrow query. Treat as inconclusive, not evidence of absence."). Operator can override per-job with an explicit "I expect zero results" flag.

---

## 5. OpSec & charter

- **5.1 Clearnet, no Tor:** the host IP is visible to X/Cloudflare/on-path observers; persisted via `settings.x.clearnetAcknowledged` + dialog. **No "via Tor" toggle** (X bans Tor exits near-instantly; Turnstile defeats Tor clients). Non-negotiable platform characteristic.
- **5.2 Burner deanon at signup:** operator-provisioned externally on an unlinked device/network; the app never signs up. Credentials (cookies/up) stored in `secretStore` under `x.accounts.*`, never in `settings.json`/logs, never echoed (boolean count only).
- **5.3 XSS/untrusted (critical):** `text`/`authorHandle`/`displayname` are attacker-controlled — render as `textContent`; normalize/reject bidi-override + homoglyph codepoints in handles (evidentiary misattribution); scheme-guard `url` to `https://x.com/`/`https://twitter.com/`; no `dangerouslySetInnerHTML`. No auto-fetch of `url` or embedded `t.co` links — display-only.
- **5.4 No media retrieval in v1** (type recorded for provenance; no fetch/store/proxy — CDN fetch would reveal host IP).
- **5.6 No telemetry/phone-home.** Verify curl-cffi network behavior at build/import **[UNVERIFIED]**.
- **5.7 Supply-chain:** pin twscrape + transitive deps by hash (`--require-hashes`); no fresh fetch at build; verify the legit `twscrape` (by vladkens), no typosquat.
- **5.8 Creds out of logs:** stdin payload never logged; extend `sanitiseMessage` to strip `auth_token=`/`ct0=` from error strings.

---

## 6. Decisions needed from the operator

1. **Account auth mode:** cookie-based (`auth_token`+`ct0`, most stable, manual renewal) vs username/password+IMAP (automatable, more fragile, higher ban-signal).
2. **Account pool size & rotation:** single vs pool (pool = more rate-limit resilience, more provisioning burden). Target size for v1?
3. **Per-job limit:** default max tweets per run (suggested 500 search / 1000 user timeline).
4. **Sidecar lifetime:** per-job spawn (recommended v1) vs long-lived daemon (more efficient, needs heartbeat). Per-job may need re-loading account state per spawn — validate.
5. **Empirical validation gate** (before implementation): confirm per-job mode, cookie survival between runs, a real search returns results, and breakage-detection fires on a simulated empty-data 200.
6. **macOS support now or Win/Linux only v1** (macOS needs notarization + curl-cffi signing **[UNVERIFIED]**).
7. **Zero-result default** = `inconclusive` (§4.4) — confirm acceptable.
8. **Credential namespace** `x.accounts.<uuid>.{auth_token,ct0,username}` — confirm.

---

## 7. Task breakdown (for the implementation plan)

Each independently testable with a mock sidecar or mock store.

- **X-1 Schema extension** — `SocmintPlatform += 'x'`; `url` validation for `'x'`; `settings.x` block (both flags default false). Test: typecheck; Telegram tests still pass; defaults correct.
- **X-2 Import-quarantine sentinel test** — static import-graph assertion that `src/main/x/*` has no edge to Tor/bgconn/Telegram-transport; `settings.x`≠`settings.socmint`. Passes trivially pre-impl, enforces thereafter.
- **X-3 Sidecar client (sealed)** — `src/main/x/sidecar-client.ts`: path resolution, SHA pin, spawn, ping/pong, readline loop, message types, per-job lifecycle, SIGKILL teardown; binary absent → `sidecar-missing`. Test (mock sidecar script): ping/pong, tweet accumulation, `truncated`→`partial`, `done{count:0}`→inconclusive.
- **X-4 Collector store integration** — `src/main/x/collector.ts`: read creds from secretStore, stream tweets→`upsertItems()` in batches, `recordJob()`, return `XCollectResult`. Test: mock client+store.
- **X-5 IPC + registration** — `src/main/x/ipc.ts` (add/remove/list/has accounts, collect, list/rank items); wire `channels.x` in `register.ts`+`ipc-contracts.ts`; egress gate both flags. Test: gate + delegation.
- **X-6 Preload + renderer** — `x` channels in preload; status badge + truncation/breakage/zero-result banners. Test: each status; `partial`/`breakage-detected` never render as complete.
- **X-7 Settings UI** — gated toggle + clearnet-acknowledgement dialog (persistent until confirm) + account management (creds to secretStore, never re-shown). Test: gating, dialog, creds never rendered.
- **X-8 PyInstaller sidecar build** — `scripts/build-twscrape-runner.*`; pinned `--require-hashes` requirements; onedir per platform; per-platform SHA committed into the client. Test: runnable binary; standalone NDJSON smoke; hash-mismatch fails.
- **X-9 App-quit teardown** — register SIGKILL backstop in `index.ts`. Test: quit-while-running kills child.
- **X-10 Live smoke (manual, operator-gated)** — the §6.5 empirical gate against a live account before lock.

---

## Appendix: primary sources
twscrape PyPI / GitHub / `models.py`; @the-convocation/twitter-scraper; PyInstaller common-pitfalls; "Python inside Electron" (Simon Willison TIL); in-repo precedents (`mlkem-sidecar.ts`, `exiftool.ts`, `bgconn/tor.ts`, `local-ai-paths.ts`, `package.json` extraResources, the `socmint/*` + `shared/types.ts` + `ipc-contracts.ts` from `feat/socmint-telegram-v1`); SOCMINT v1 spec §1/§2/§4/§5. Breakage-date timeline **[UNVERIFIED]**; 2–4 week cadence primary-source confirmed.
