# X Collector session-model refinement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Refine the X collector's credential UX — one clearnet-gate control (+ first-time ack modal), atomic auth_token+ct0 session model with a non-secret metadata store, and a main-side Test-session that validates the exact cookies (no sidecar rebuild).

**Architecture:** Two new small main-side files (`sessions-store.ts`, `session-test.ts`) + IPC/preload + the Settings X-section UI + the pure gate-decision helper. Full spec — **read it, it carries the gate flow, session model, Test-session result mapping, and per-section tests:** `docs/superpowers/specs/2026-07-05-x-collector-session-refinement-design.md`.

**Tech Stack:** TypeScript, React 18, Electron main/preload, Vitest (+ jsdom `createRoot`). No new deps.

## Global Constraints

- **Commit identity:** author/committer `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`. NEVER emit `Co-Authored-By`/`Signed-off-by`/`Claude-Session`/any AI trailer.
- **Never stage pre-existing dirty files:** `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, `docs/superpowers/ideation/**`, `resources/local-ai/**`. Stage only your task's files.
- **Secrets:** `auth_token`/`ct0` stay in `secretStore` (`x.accounts.<accountId>.{auth_token,ct0,username}`), write-only from the renderer — the renderer NEVER reads a secret back. Never log/echo a cookie value (incl. in thrown errors). The sessions metadata store holds NO secrets.
- **Egress:** Test-session uses `safeFetch` (host-pinned to X hosts) and is GATED behind `networkEnabled` (same IP exposure as a collect). No ungated clearnet request. Do NOT touch the GhostScrape gate — it must still require BOTH `networkEnabled` AND `clearnetAcknowledged`.
- **Settings schema unchanged:** keep both `x.networkEnabled` + `x.clearnetAcknowledged`. Do not touch the twscrape sidecar, `collector.ts`, or the collection flow.
- **Determinism:** no `Date.now`/`Math.random` in pure logic; `lastTestedAt` uses an injected `now` at the store boundary.
- Branch `feat/x-session-refinement`. TDD: failing test → run (fails) → minimal impl → run (passes) → full `pnpm test` → commit. Component tests mirror `test/x-ghostscrape-cases-sidebar.test.tsx` (createRoot in act(), mocked window.api, native-setter typeInto for inputs). IPC seam tests mirror `test/investigation-run-ipc.test.ts` (makeHandle).

---

### Task 1: `sessions-store.ts` — non-secret session metadata

**Files:** Create `src/main/x/sessions-store.ts`. Test: `test/x-sessions-store.test.ts`.

**Consumes:** `secure-fs` (`secureReadText`/`secureWriteFile`) + `dataRoot()` (mock electron in tests, mirror `test/memory-profile-facade.test.ts`).
**Produces:** `SessionMeta { accountId: string; label: string; username?: string; status: 'valid'|'expired'|'untested'; lastTestedAt?: string; handle?: string }`; `listSessions(): Promise<SessionMeta[]>` (stable sort by label asc, accountId asc); `putSessionMeta(m: SessionMeta): Promise<void>`; `removeSessionMeta(accountId: string): Promise<void>`; `migrateLegacyAccounts(existingAccountIds: string[]): Promise<void>` (for any id not already in the store, add `{ accountId:id, label:id, status:'untested' }` — non-destructive, never overwrites existing metadata). Persist as one JSON object keyed by accountId via secure-fs (encrypted at rest).

- [ ] Tests: put→list round-trip (stable order); remove deletes only that id; migrate adds untested metadata for unknown ids and leaves existing metadata untouched; the store never contains a secret field. TDD, run suite, commit.

### Task 2: `session-test.ts` — main-side cookie validation

**Files:** Create `src/main/x/session-test.ts`. Test: `test/x-session-test.test.ts`.

**Consumes:** `safeFetch(url, maxHops?, headers?)` from `../net/safe-fetch`.
**Produces:** `SessionTestResult = { valid: true; handle: string } | { valid: false; reason: 'expired'|'rate-limited'|'network' }`; `const X_WEB_BEARER` (the public web-app bearer constant, documented as an X-controlled value that can rotate); `testSession(creds: { authToken: string; ct0: string }): Promise<SessionTestResult>` — GET `https://api.x.com/1.1/account/settings.json` via `safeFetch` with headers `{ authorization: 'Bearer '+X_WEB_BEARER, 'x-csrf-token': ct0, cookie: 'auth_token='+authToken+'; ct0='+ct0 }` + a timeout. Map: 200+screen_name→valid+handle; 401/403→expired; 429→rate-limited; throw/timeout→network. Sanitize `screen_name` (strip to `[A-Za-z0-9_]{1,15}`) before returning; NEVER include a cookie value in a thrown error.

- [ ] Tests (mock `safeFetch`): 200 with `{screen_name:'ghostexodus'}`→`{valid,handle:'ghostexodus'}`; 401 and 403→expired; 429→rate-limited; a thrown fetch→network; the request headers carry bearer + x-csrf-token + both cookies; a malicious `screen_name` (`"<img>evil"`) is sanitized; no cookie value appears in any error message. TDD, run suite, commit.

### Task 3: IPC + preload — session channels

**Files:** `src/shared/ipc-contracts.ts` (add `x.testSession`, `x.testStoredSession`, `x.listSessions`, `x.addSession`, `x.removeSession`), `src/main/ipc/register.ts` (add handlers near the existing `channels.x.*` at ~1926), `src/preload/index.ts` + `src/preload/api.d.ts`. Test: `test/x-session-ipc.test.ts` (reuse `makeHandle`).

**Consumes:** Task 1 (`sessions-store`), Task 2 (`session-test`), `secretStore`, the `randomUUID`.
**Produces:**
- `x:addSession(input: { label: string; username?: string; authToken: string; ct0: string }) → Promise<{ accountId: string }>` — generate a UUID; write secrets `x.accounts.<uuid>.{auth_token,ct0,username}` to secretStore; `putSessionMeta({accountId, label, username, status:'untested'})`. Both writes atomic-ish (secrets then metadata).
- `x:removeSession(accountId) → Promise<void>` — delete secrets keys + `removeSessionMeta`.
- `x:listSessions() → Promise<SessionMeta[]>`.
- `x:testSession(creds: {authToken, ct0}) → Promise<SessionTestResult>` — gated: if `!settings.x.networkEnabled` throw `Error('Enable authenticated X collection first')`; else call `testSession(creds)`.
- `x:testStoredSession(accountId) → Promise<SessionTestResult>` — gated the same; read secrets main-side (`secretStore.get('x.accounts.'+id+'.auth_token'|'.ct0')`); call `testSession`; on result `putSessionMeta` with new status/lastTestedAt(now)/handle. Returns the result (NO secrets).
- preload bindings for all five; keep `addAccount`/`removeAccount`/`listAccounts` for back-compat OR redirect — but do NOT break GhostScrape's `x.listAccounts` usage (check: GhostScrape/XCollector call `x.listAccounts()`; keep it returning ids, or add `listSessions` alongside). Simplest: ADD the new channels, keep the old ones.

- [ ] Tests: `addSession` writes the 3 secret keys + untested metadata, returns a uuid accountId; `removeSession` deletes both; `testSession` throws when networkEnabled=false, calls the core when true; `testStoredSession` reads the secret keys main-side + writes metadata with the returned handle/status; the renderer-facing return of every channel contains NO secret value. TDD, run suite, commit.

### Task 4: `x-settings-logic.ts` — one-control gate decision

**Files:** Modify `src/renderer/modules/x/x-settings-logic.ts`. Test: `test/x-settings-logic.test.ts` (extend if it exists).

**Produces:** `xGateEffective(x: { networkEnabled: boolean; clearnetAcknowledged: boolean }): boolean` (= `networkEnabled && clearnetAcknowledged`); `xGateToggleAction(x, nextChecked: boolean): { kind: 'enable-direct' } | { kind: 'needs-ack-modal' } | { kind: 'disable' }` — nextChecked=false→disable; nextChecked=true & clearnetAcknowledged→enable-direct; nextChecked=true & !acknowledged→needs-ack-modal. Keep `CLEARNET_DIALOG_TEXT` and `xNetworkToggleEnabled` exports (still used).

- [ ] Tests: `xGateEffective` for all four flag combos (only both-true → true; the legacy `{networkEnabled:true, ack:false}` → false); `xGateToggleAction` returns disable/enable-direct/needs-ack-modal for each (checked,acknowledged) combo. TDD, run suite, commit.

### Task 5: SettingsModule X section — gate control + session UI

**Files:** Modify `src/renderer/modules/settings/SettingsModule.tsx` (X section ~900–1050). Test: `test/settings-x-session.test.tsx`.

**Consumes:** Task 4 (`xGateEffective`/`xGateToggleAction`), Task 3 (`window.api.x.{listSessions,addSession,removeSession,testSession,testStoredSession}`), `confirmDialog`, `CLEARNET_DIALOG_TEXT`, shared `CaseDialogs`-style patterns are NOT needed (this is inline settings UI).
**Produces:** replace the separate Acknowledge-button + gate-toggle with ONE checkbox **"Enable authenticated X collection"** (checked = `xGateEffective(x)`; onChange → `xGateToggleAction` → disable: patch `networkEnabled:false`; enable-direct: patch `networkEnabled:true`; needs-ack-modal: `confirmDialog(CLEARNET_DIALOG_TEXT,…)` → on ok patch `{clearnetAcknowledged:true, networkEnabled:true}`, on cancel no-op) + a permanent sublabel "Uses your real clearnet IP — X has no Tor path." Replace the add-account form with **Add session** (Local label / X username optional / auth_token / ct0 / **Test & Save**): Test & Save → `x.testSession({authToken,ct0})`; valid → `x.addSession(...)` then `x.testStoredSession(newId)` (to record valid+handle) OR addSession+putMeta valid — simplest: addSession, then testStoredSession to stamp status; show "✓ Session valid — authenticated as @handle"; definitive expired → no save + "✗ invalid or expired"; rate-limited/network → a **Save without testing** button → `x.addSession` (stays untested). Replace **Stored accounts** → **Stored sessions** list from `x.listSessions()`: row = label · @handle/username · status badge (valid green/expired red/untested grey) · last-tested · **Test** (`x.testStoredSession(id)` → refresh) · **Remove** (`x.removeSession(id)` → refresh).

- [ ] Tests (mock `window.api.x` + `confirmDialog`): checking the gate when acknowledged patches networkEnabled true directly; when not acknowledged opens the modal → confirm patches both flags, cancel patches nothing; the legacy state renders the box unchecked; Add-session Test & Save with a mocked valid result calls `addSession` and shows the handle; a mocked expired result does NOT call addSession and shows the error; Stored-sessions renders a badge + Test calls `testStoredSession` + Remove calls `removeSession`. TDD, run suite, commit.

### Task 6: XCollector accounts picker — label + status, sends accountId

**Files:** Modify `src/renderer/modules/x/XCollectorModule.tsx` (accounts picker + `loadAccounts`). Test: extend `test/x-ghostscrape-cases-sidebar.test.tsx` OR a new `test/x-collector-account-picker.test.tsx`.

**Consumes:** `window.api.x.listSessions()`.
**Produces:** the accounts `<select>` lists sessions by **label** (+ a status hint, e.g. "· expired"), with `value={accountId}`; the collect request carries the selected `accountId` (unchanged send path). `loadAccounts` uses `listSessions` (falls back gracefully if empty).

- [ ] Tests: the picker renders session labels from a mocked `listSessions`; selecting one and starting a collect sends that `accountId` in the request (the `[[socmint-collect-path-wiring-v3.24.2]]` seam guard — the renderer MUST send the accountId). TDD, run suite, commit.

## Self-review checklist (controller, before adversarial pass)

- Every spec §3–§7 behavior maps to a task. ✓
- Secrets never returned to the renderer; no cookie value in any log/error; sessions store holds no secrets.
- Test-session gated on `networkEnabled`; `safeFetch` host-pinned; GhostScrape still requires BOTH flags (unchanged).
- Both settings flags preserved; sidecar/collector untouched; non-destructive legacy migration.
- Full `pnpm test` + `pnpm typecheck` green; one commit per task, charter author, no trailers.
