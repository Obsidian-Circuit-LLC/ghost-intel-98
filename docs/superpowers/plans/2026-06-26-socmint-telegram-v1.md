# SOCMINT Telegram v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Implement task-by-task, in order. Each task ends with an independently testable deliverable + a commit.

**Goal:** Build the Telegram-only SOCMINT v1 collector for Ghost Intel 98 — public-channel join-then-filter, main-process only, Tor-required with per-burner circuit isolation, embedding relevance-ranking, encrypted at rest — to the swap-ready library interface, with the concrete MTProto library binding left as a clearly-marked seam pending the operator's live smoke test + library lock.

**Architecture:** Main-process collector service behind a thin `join/backfill/subscribe/filterLocal/disconnect` interface so GramJS↔mtcute is swappable. Egress gated off-by-default. Tor transport bound per-burner via distinct SOCKS5 `(user,pass)` → `IsolateSOCKSAuth` circuits. Harvested items normalized, deduped by deterministic id, persisted via secure-fs sidecars per case, relevance-ranked with the existing local-Ollama embedder. No renderer network calls.

**Tech Stack:** Electron 33 / Node 20 / React 18 / TS-strict; vitest (node env); existing seams: `secretStore`, `embed`/`cosine`, `bgconn` Tor + `tor-egress` SOCKS pattern, `secure-fs`, settings registry, IPC `register.ts`.

**Reference:** spec `docs/superpowers/specs/2026-06-26-socmint-module-design.md` (read §3 architecture, §4 OpSec invariants, §7 transport). Verdicts and decisions are settled there; do not re-litigate scope.

## Global Constraints

Copy verbatim into every task's awareness. Every task's requirements implicitly include this section.

- **Egress gated off by default.** New `settings.socmint.networkEnabled`, default **false**. Every egress-touching IPC handler checks it at the **main-process** boundary (pattern: `src/main/ipc/register.ts:1189,1202,1265`). Renderer-side checks are not a boundary.
- **Tor-required, never silent clearnet fallback.** The collector refuses to connect when `getBgTor()?.isBootstrapped()` is false — throw/abort, never dial clearnet (mirror `src/main/geoint/cctv-proxy.ts` 503-on-Tor-down). Dial the **bgconn** Tor (`src/main/index.ts:325-335`, `setBgTor`), never the chat Tor (`src/main/chat/transport-tor.ts:57` has no isolation flags).
- **Per-burner stream isolation is mandatory.** Each burner identity uses a **distinct** SOCKS5 `(user,pass)` so Tor's `IsolateSOCKSAuth` (already set in `src/main/bgconn/torrc.ts`) gives it its own circuit. `IsolateDestAddr` alone will NOT separate burners (Telegram uses a small fixed set of DC IPs). Same id → same creds → same circuit (desired; no mid-session rotation).
- **Encrypt at rest.** Secrets (burner session strings, API_ID/HASH, SOCKS creds) only via `secretStore` (`src/main/secrets/index.ts:127`), namespaced. Per-case data only via `secureWriteFile`/`secureReadFile` (`src/main/storage/secure-fs.ts`, atomic). Never plaintext in `settings.json` or logs.
- **Untrusted input is hostile at every boundary.** Harvested text/handles/labels/urls are attacker-controlled. NEVER `new RegExp()` on harvested text (ReDoS — main thread). Renderer renders text as `textContent` only (no `dangerouslySetInnerHTML`); scheme-guard urls to http(s) (`isPublicHttpUrl` semantics, `src/main/security/validate.ts`); sanitize any filename to a basename.
- **No determinism claims for the LLM/embedder.** Embedding ranking is not deterministic across runtime/quant; record model+runtime+quant in job metadata; the only deterministic guarantees are exact-id dedup + hashing.
- **AI stays loopback-only.** SOCMINT embedding calls assert `provider==='ollama'` / loopback endpoint and refuse a cloud endpoint. Harvested content must never leave for a third-party LLM.
- **Library binding is a sealed seam.** Do NOT add the `@mtcute/node` or `telegram` npm dependency in this build, and do NOT install it. The concrete adapter is written to the verified config shape but its dependency import is lazy/guarded; invoking it without the dep throws a clear "library not installed — pending operator smoke test + lock" error. The lock (mtcute vs GramJS) is the operator's, post-smoke-test (spec §7).
- **Commit discipline.** Stage ONLY the explicit files each task lists, by path. NEVER `git add -A` / `git add .` (the working tree has unrelated pending changes: `searchlight.css`, `active-snapshot.tle`, `Cargo.lock` — they must never be swept into a commit). Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF`
- **Verify command:** `pnpm typecheck && pnpm test <new test file>` per task; report BLOCKED rather than improvise. Renderer code (Task 9) is not headlessly testable — flag for manual smoke, do not invent a renderer test harness.

---

### Task 1: Shared types + settings gate

**Files:**
- Create: `src/shared/socmint/types.ts`
- Create: `src/main/socmint/utils.ts` (**`harvestedItemId` lives here, not in `src/shared/`** — see note below)
- Modify: `src/shared/types.ts` (add `socmint` block to `AppSettings` near the other `networkEnabled` fields ~`:406-465`)
- Modify: the settings default/persistence path (`src/main/storage/json-fs.ts` defaults ~`:896-920`) so `socmint.networkEnabled` defaults `false`
- Test: `test/socmint-types.test.ts`

> **Architecture note (implemented, not a deviation):** `harvestedItemId` calls `node:crypto`
> (`createHash`), which is not available in the renderer-safe `src/shared/` tree. The function
> lives in `src/main/socmint/utils.ts` (main-process only). All downstream tasks (T2 store, T5
> collector) **must import `harvestedItemId` from `@main/socmint/utils`**, not from
> `@shared/socmint/types`. `src/shared/socmint/types.ts` exports only pure-TS interfaces and
> type aliases.

**Interfaces (Produces):**

`src/shared/socmint/types.ts`:
```ts
export type SocmintPlatform = 'telegram';
export interface HarvestedItem {
  id: string;            // SHA-256 hex of `${platform}:${channelId}:${messageId}`
  platform: SocmintPlatform;
  authorHandle: string; authorId: string;
  text: string;
  mediaType?: string; mediaRef?: string;
  channelId: string; channelLabel: string;
  messageId: string;
  publishedAt: string;   // ISO from platform — never Date.now()
  harvestedAt: string;   // ISO, supplied by caller (injected clock; not Date.now() inside pure code)
  url: string;           // permalink
  provenance: { collectorVersion: string; jobId: string; caseId: string; keyword?: string };
  relevanceScore?: number; // absent on raw harvest; filled by ranking
}
export interface MonitoredChannel { channelId: string; label: string; keywords: string[]; }
export interface SocmintJob {
  jobId: string; caseId: string; startedAt: string;
  model?: string; runtime?: string; quantization?: string; // recorded for AI provenance
}
```

`src/main/socmint/utils.ts` (main-process only — uses `node:crypto`):
```ts
export function harvestedItemId(platform: SocmintPlatform, channelId: string, messageId: string): string;
```
- `harvestedItemId` uses `crypto.createHash('sha256')` (pattern: `src/main/services/memory/chunker.ts:22`). Deterministic.
- `AppSettings.socmint: { networkEnabled: boolean }`, default `false`.

**Steps:**
- [ ] Write `test/socmint-types.test.ts`: (a) `harvestedItemId('telegram','-100','42')` is stable across calls and differs for different inputs; (b) settings default has `socmint.networkEnabled === false`.
- [ ] Run it, watch it fail.
- [ ] Implement `src/shared/socmint/types.ts` + the `AppSettings` field + the default.
- [ ] Run `pnpm typecheck && pnpm test test/socmint-types.test.ts` — pass.
- [ ] Commit (`src/shared/socmint/types.ts src/main/socmint/utils.ts src/shared/types.ts src/main/storage/json-fs.ts test/socmint-types.test.ts`).

---

### Task 2: Encrypted per-case store + exact-id dedup

**Files:** Create `src/main/socmint/store.ts`; Test `test/socmint-store.test.ts`.

**Interfaces:**
- Consumes: `HarvestedItem`, `SocmintJob` (T1); `secureReadFile`/`secureWriteFile` (`src/main/storage/secure-fs.ts:41,73`); a mutex (`src/main/util/mutex.ts withLock`).
- Produces:
```ts
export async function upsertItems(caseId: string, items: HarvestedItem[]): Promise<{ added: number; skipped: number }>;
export async function listItems(caseId: string): Promise<HarvestedItem[]>;
export async function recordJob(caseId: string, job: SocmintJob): Promise<void>;
export async function listJobs(caseId: string): Promise<SocmintJob[]>;
```
- Sidecars under `caseDir/<caseId>/`: `socmint-items.json`, `socmint-jobs.json`. Every read-modify-write wrapped in `withLock(caseId)`. Dedup: skip an item whose `id` already exists (deterministic, check-before-append). Stable order: append order preserved; `listItems` returns a stable order.
- Allow a secure-fs injection seam for tests (e.g. accept an fs adapter or use the existing test seam) so tests run without the real vault.

**Steps:**
- [ ] Write `test/socmint-store.test.ts` against a mock/temp secure-fs: round-trip upsert→list; re-upsert same ids → `added:0, skipped:n` (idempotent); jobs round-trip.
- [ ] Run, fail.
- [ ] Implement.
- [ ] `pnpm typecheck && pnpm test test/socmint-store.test.ts` — pass.
- [ ] Commit (store.ts + test).

---

### Task 3: Literal keyword filter (no RegExp on untrusted text)

**Files:** Create `src/main/socmint/filter.ts`; Test `test/socmint-filter.test.ts`.

**Interfaces:**
```ts
export function matchesKeywords(text: string, keywords: string[]): boolean; // case-folded literal substring; OR semantics
export function filterByKeywords(items: HarvestedItem[], keywords: string[]): HarvestedItem[];
```
- **Invariant:** literal `String.prototype.includes` on case-folded strings. NEVER construct a `RegExp` from a keyword or from harvested text. Empty `keywords` ⇒ match all (no filtering).

**Steps:**
- [ ] Write `test/socmint-filter.test.ts`: matches a contained keyword case-insensitively; a regex-metachar keyword like `".*"` or `"a|b"` matches **literally** (i.e. only when those exact characters appear), proving no RegExp; unicode keyword matches; empty keywords passes all.
- [ ] Run, fail.
- [ ] Implement.
- [ ] Verify — pass.
- [ ] Commit.

---

### Task 4: Per-burner Tor identity + transport config (Tor-required)

**Files:** Create `src/main/socmint/tor-identity.ts`; Test `test/socmint-tor-identity.test.ts`.

**Interfaces:**
- Consumes: `getBgTor`/bgconn socks port (`src/main/bgconn/tor-singleton.ts`); the credential-derivation pattern from `src/main/plugins/tor-egress.ts:41 deriveCaseCredentials`; `src/main/bgconn/lane.ts newSocksCreds`.
- Produces:
```ts
export function deriveBurnerCredentials(burnerId: string): { user: string; pass: string }; // HMAC/hash of burnerId + a fixed SOCMINT salt; deterministic; distinct burnerId → distinct creds
export interface BurnerProxyConfig { host: '127.0.0.1'; port: number; version: 5; user: string; password: string; }
export function burnerProxyConfig(burnerId: string): BurnerProxyConfig; // throws SocmintTorUnavailableError if getBgTor()?.isBootstrapped() !== true; else reads bgconn socksPort
export class SocmintTorUnavailableError extends Error {}
```
- **Invariants:** distinct `burnerId` ⇒ distinct `(user,pass)` (isolation); same `burnerId` ⇒ same creds (stable circuit); `burnerProxyConfig` **refuses** (throws `SocmintTorUnavailableError`) when bgconn Tor is not bootstrapped — never returns a clearnet/no-Tor config. Use a SOCMINT-specific salt distinct from `CASE_SOCKS_SALT`.

**Steps:**
- [ ] Write `test/socmint-tor-identity.test.ts` (stub `getBgTor` to return `{isBootstrapped:()=>true, socksPort:()=>9999}` and `false`): distinct/stable creds; `burnerProxyConfig` returns `{host,port:9999,version:5,user,password}` when bootstrapped; throws `SocmintTorUnavailableError` when not.
- [ ] Run, fail.
- [ ] Implement.
- [ ] Verify — pass.
- [ ] Commit.

---

### Task 5: Collector interface + mock + sealed mtcute adapter

**Files:** Create `src/main/socmint/collector.ts`; Test `test/socmint-collector.test.ts`.

**Interfaces:**
```ts
export interface CollectorEvents { onItem(cb: (raw: HarvestedItem) => void): void; }
export interface SocmintCollector {
  connect(): Promise<void>;
  join(channel: string): Promise<MonitoredChannel>;
  backfill(channelId: string, limit: number): Promise<HarvestedItem[]>;
  subscribe(channelIds: string[], onItem: (i: HarvestedItem) => void): () => void; // returns unsubscribe
  disconnect(): Promise<void>;
}
export class MockCollector implements SocmintCollector { /* deterministic, in-memory; for tests + dev */ }
export function makeMtcuteCollector(opts: { burnerId: string; harvestedAt: () => string }): SocmintCollector; // adapter
```
- `makeMtcuteCollector`: builds the proxy config via `burnerProxyConfig(burnerId)` (so it inherits Tor-required), and constructs the client config shape verified in spec §7.3: `new SocksProxyTcpTransport({host,port,version:5,user,password})` for mtcute. **The actual `@mtcute/node` import is lazy and guarded**: attempt `await import('@mtcute/node')` inside `connect()` and, on failure (module not found), throw `new Error('SOCMINT: Telegram library not installed — pending operator smoke test + library lock (spec §7)')`. The module must typecheck and all tests pass WITHOUT the dependency present.
- Tests use `MockCollector` to exercise the interface contract; an adapter test asserts the proxy-config construction is correct and that `connect()` throws the sealed-seam error when the dep is absent.

**Steps:**
- [ ] Write `test/socmint-collector.test.ts`: MockCollector join→subscribe delivers items→unsubscribe stops them; `makeMtcuteCollector(...).connect()` rejects with the sealed-seam message; the adapter computed a `version:5` proxy config carrying the burner creds.
- [ ] Run, fail.
- [ ] Implement (guarded dynamic import; no static `@mtcute/*` import anywhere).
- [ ] Verify — pass.
- [ ] Commit.

---

### Task 6: Embedding relevance ranking (loopback-only)

**Files:** Create `src/main/socmint/rank.ts`; Test `test/socmint-rank.test.ts`.

**Interfaces:**
- Consumes: `embed` + `setEmbedderForTest` (`src/main/services/memory/embeddings.ts`), `cosine` (`src/main/services/memory/store.ts:58`), `validateAiEndpoint` (`src/main/security/validate.ts`).
- Produces:
```ts
export async function rankByRelevance(keyword: string, items: HarvestedItem[], opts?: { maxTextLen?: number; batchSize?: number }): Promise<HarvestedItem[]>;
// embeds [keyword, ...texts], cosine(keyword, each), returns items sorted by score desc, tie-break id asc, each with relevanceScore set.
export function assertLoopbackAi(): void; // throws if the resolved AI endpoint/provider is not loopback Ollama
```
- **Invariants:** call `assertLoopbackAi()` before embedding; refuse a non-loopback/cloud endpoint. Bound per-item text to `maxTextLen` (default e.g. 2000) and embed in fixed `batchSize` batches independent of content. Tie-break by `id` ascending for stable order. Do NOT claim determinism in comments.

**Steps:**
- [ ] Write `test/socmint-rank.test.ts` with `setEmbedderForTest` returning controlled vectors: items rank by cosine desc; equal scores tie-break by id asc; `assertLoopbackAi` throws on a stubbed cloud endpoint.
- [ ] Run, fail.
- [ ] Implement; restore embedder in test teardown (`setEmbedderForTest(null)`).
- [ ] Verify — pass.
- [ ] Commit.

---

### Task 7: Analyst label-capture hook

**Files:** Create `src/main/socmint/labels.ts`; Test `test/socmint-labels.test.ts`.

**Interfaces:**
```ts
export interface ItemLabel { itemId: string; decision: 'accept' | 'reject'; entityCorrections?: { kind: string; value: string }[]; labeledAt: string; }
export async function recordLabel(caseId: string, label: ItemLabel): Promise<void>; // append to encrypted sidecar socmint-labels.json via secure-fs + withLock
export async function listLabels(caseId: string): Promise<ItemLabel[]>;
```
- Purpose (spec §6 / decision 8): persist accept/reject + entity corrections so a future *local-only* fine-tune is possible. v1 only captures; no training. Encrypted at rest; `withLock`.

**Steps:**
- [ ] Write `test/socmint-labels.test.ts`: record→list round-trip; multiple appends preserved.
- [ ] Run, fail. Implement. Verify — pass. Commit.

---

### Task 8: IPC wiring + egress gate + burner secret storage

**Files:** Create `src/main/socmint/ipc.ts`; Modify `src/main/ipc/register.ts` (register the handlers); Modify the preload/contract types as the existing modules do; Test `test/socmint-contracts.test.ts` (+ a gate unit test `test/socmint-gate.test.ts`).

**Interfaces / channels** (mirror existing naming, e.g. `geoint:*`):
- `socmint:addChannel` / `socmint:removeChannel` / `socmint:listChannels`
- `socmint:listItems` / `socmint:rankItems` / `socmint:recordLabel`
- `socmint:setBurner` (stores session/creds in `secretStore` under `socmint.burner.<id>.*`; **never echoes secrets back**; renderer gets only a boolean `hasBurner`) / `socmint:hasBurner`
- `socmint:startMonitor` / `socmint:stopMonitor` (the only egress-causing ones)
- **Gate:** every egress-causing handler (`startMonitor`, `backfill`, anything that calls the collector's `connect`) first checks `(await settingsStore.read()).socmint.networkEnabled`; if false, return a typed disabled-result, do not touch the collector. Non-egress handlers (list/rank/label over already-stored data) may run regardless.
- Burner secrets only via `secretStore`; reference strings (channel ids, labels) may live in settings/case data.

**Steps:**
- [ ] Write `test/socmint-gate.test.ts`: with `networkEnabled:false`, the start-monitor handler logic returns disabled and never constructs a collector (inject a collector factory spy). Write `test/socmint-contracts.test.ts`: the registered SOCMINT channel set matches an explicit expected list (guard against drift — mirror `searchlight-contracts.test.ts`).
- [ ] Run, fail.
- [ ] Implement handlers + registration + preload contract. Keep handler bodies thin (delegate to store/rank/labels/collector modules).
- [ ] Run `pnpm typecheck && pnpm test test/socmint-gate.test.ts test/socmint-contracts.test.ts` — pass. Also run the FULL suite once to catch any cross-file contract guard (`pnpm test`).
- [ ] Commit (ipc.ts, register.ts, preload/contract files, both tests).

---

### Task 9: Renderer SOCMINT module + registration (XSS-safe)

**Files:** Create `src/renderer/modules/socmint/SocmintModule.tsx` (+ a small `socmint.css`); Modify module registration — `src/renderer/modules/register-builtins.tsx` (import + `registerModule`), `src/renderer/state/store.ts` (`ModuleKey` literal), `src/renderer/shell/Desktop.tsx` (title), shortcut in `src/shared/types.ts`. No headless test (flag for manual smoke).

**Behavior:**
- Panels: Monitored Channels (add/remove + per-channel keywords), Harvested Items list (status, author, channel, time, permalink, relevanceScore), a "Rank by keyword" action, per-item Accept/Reject buttons (→ `socmint:recordLabel`), a network-gate notice when off.
- **XSS invariants (critical):** render `text`, `authorHandle`, `channelLabel` as React text children (`textContent`) — never `dangerouslySetInnerHTML`; build the permalink anchor only after scheme-guarding `url` to http(s) (reuse `isPublicHttpUrl` semantics; if it fails, render as plain text, no anchor); never render `mediaRef` as a path. All collector data flows main→renderer over IPC; the renderer makes no network calls.

**Steps:**
- [ ] Implement the module + registration. Wire to the T8 IPC channels via the existing `window.api` surface.
- [ ] `pnpm typecheck` green. Manually confirm registration compiles (no headless render test). Add a brief comment block documenting the manual-smoke checklist.
- [ ] Commit (renderer files + registration files).

---

### Task 10: Settings → SOCMINT pane + honest docs

**Files:** Modify `src/renderer/modules/settings/SettingsModule.tsx` (add a `SocmintPane` mirroring the GeoINT pane — network toggle bound to `settings.socmint.networkEnabled`, a burner-reference entry that calls `socmint:setBurner` and shows only `hasBurner`, never the secret). Modify `README.md` ONLY to add a truthful one-line Status entry (do NOT fabricate test counts or claim live-Telegram works — state "Telegram collector built to interface; live validation + library lock pending operator smoke test").

**Steps:**
- [ ] Implement the pane. `pnpm typecheck` green.
- [ ] Update README Status line truthfully (no invented numbers; re-read the diff before writing the line).
- [ ] Run the FULL suite `pnpm test` — green.
- [ ] Commit.

---

## Verification (orchestrator, after all tasks)

- `pnpm typecheck` + full `pnpm test` green (new suites: socmint-types, -store, -filter, -tor-identity, -collector, -rank, -labels, -gate, -contracts).
- Confirm NO `@mtcute/*` or `telegram` static import landed and no dependency was added to `package.json`.
- Confirm the working-tree's pre-existing unrelated changes (`searchlight.css`, `active-snapshot.tle`, `Cargo.lock`) were NOT swept into any commit (`git diff IMPL_BASE..HEAD --stat` shows only SOCMINT files).
- Whole-branch adversarial review (4 dims) + a dedicated red-team pass on the security-critical surface: Tor-required + per-burner isolation (T4), egress gate (T8), renderer XSS / untrusted-input handling (T9), secret non-echo (T8). Auto-fix confirmed-critical only.

## Operator-gated (NOT in this build — surfaced, not done)

- Add + pin the chosen MTProto dependency (`@mtcute/node` recommended) by integrity hash; run the spec §7.4 live smoke test (two burners, distinct circuits via `IsolateSOCKSAuth`, zero clearnet via tcpdump); **then** finalize the library lock and unseal the adapter import.
- Burner SIM provisioning + the `my.telegram.org`-over-Tor / clean-IP-SMS acquisition ceremony (decision 4).
- Merge to main + any release (operator-gated as always).
