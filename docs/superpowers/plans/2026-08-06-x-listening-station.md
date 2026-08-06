# Plan A — Shared Capture Foundation + X Listening Station Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared hardened-capture + encrypt-at-rest + security foundation, then a full-parity **X Listening Station** module that captures an authenticated X session clearnet-quarantined, retiring the `x` (twscrape) and `GhostScrape` modules and the twscrape sidecar.

**Architecture:** Port GhostExodus's X Listening Station v2.3.0 (the review's hardening exemplar) into Ghost Intel's main/renderer. Capture runs in a main-process hardened `BrowserWindow` on a named clearnet partition, scraping only the visible DOM via static `executeJavaScript`; captured items normalize into the encrypted case store as `HarvestedItem`s, with X-specific artifacts (notes, follower networks, archive state) in per-tool encrypted stores. Plan B (Telegram) reuses this foundation.

**Tech Stack:** Electron main (`BrowserWindow`, `session.fromPartition`, `webContents.executeJavaScript`), React 18 renderer (createRoot+act tests), Vitest, `src/main/storage/secure-fs.ts` encrypt-at-rest, `src/main/ipc/register.ts` `safeHandle`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-x-listening-telegram-hunter-integration-design.md`. Source (read-only quarantine): `/tmp/claude-0/-dcs98/956dbabe-6cc6-4375-9e68-f4a21d90048d/scratchpad/xls-quarantine/CYBERVS-DOMINATVS-X-Listening-Station-v2.3.0-Source` (`electron/main.cjs`, `src/main.tsx`, `src/styles.css`).
- **No new runtime dependency** (reuse the app's existing PDF/DOCX exporters, not `docx`/`pdfkit`) — any new dep needs operator approval. **No new network egress beyond x.com/twitter.com/twimg** (clearnet-quarantined). **No telemetry.**
- **X is a clearnet-quarantine trust domain** — NO import of `bgconn`/Tor/socmint/telegram code into the X module; the import-graph sentinel must stay green.
- **Encrypt-at-rest:** all captured items + X artifact stores go through `src/main/storage/secure-fs.ts` (follow the `src/main/storage/scraping-cases.ts` pattern). Plaintext JSON is forbidden for intel data.
- **Capture window hardening (every window):** `nodeIntegration:false, contextIsolation:true, sandbox:true, webviewTag:false, webSecurity:true`; `setWindowOpenHandler` deny-by-default; `will-navigate` hostname-allowlist guard.
- **IPC:** every handler via `safeHandle` AND sender-validated (reject frames not from the app's own `file://` origin — port XLS `assertTrustedSender`). Captured links use the app's existing scheme-guarded `system.openExternal` only; never `shell.openExternal` on a scraped URL.
- **Honesty (preserve):** visible-DOM-only capture; stop (never bypass) on an X verification/rate-limit challenge; rounded metrics (`"1.2K"`) stored verbatim + `approx:true`, never a false-precision integer; every captured record stamped `provenance:'visible-capture', verified:false`.
- **No remote media inlining:** capture avatars/post media to local `data:` thumbnails at collect time; a stored remote URL must never reach an `<img src>`.
- Commit convention: author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`, `--no-verify`, `-c`; explicit-path `git add`; NO AI trailers. Implementers commit ONLY on the feature branch; controller merges.
- Tests: Vitest; React 18 `createRoot`+`act` (NO @testing-library); main-service tests `vi.mock`/`vi.stubGlobal`. Typecheck covers `src/**` only. Electron `BrowserWindow` main-process logic is tested against a mocked `electron` module (`vi.mock('electron', …)`).

---

## File Structure

- `src/main/capture/capture-window.ts` — **new**: hardened `BrowserWindow`-per-partition factory + static-JS runner + open/navigation guards + sender-check helper. Shared by X and (Plan B) Telegram.
- `src/main/capture/security.ts` — **new**: `guardExternalUrl`, `csvCell` (formula-guarded), `escapeField`, `confineImportPath`, `remoteMediaToDataUri`. Shared.
- `src/main/x-listening/store.ts` — **new**: encrypt-at-rest X intel store (captured `HarvestedItem`s into the case store) + X artifact stores (notes, networks, archive state).
- `src/main/x-listening/extract.ts` — **new**: pure DOM-payload strings (static `executeJavaScript`) + pure normalizers (raw scrape → `HarvestedItem` + artifacts).
- `src/main/x-listening/ipc.ts` — **new**: `safeHandle` channels for connect/capture/notes/network/archive/export.
- `src/renderer/modules/x-listening/XListeningModule.tsx` (+ `panels/*`) — **new**: ported React UI.
- `src/shared/ipc-contracts.ts`, `src/preload/index.ts`, `src/preload/api.d.ts` — add the `xListening` IPC group.
- `src/renderer/modules/register-builtins.tsx` — register `x-listening-station`; remove `x` + `ghostscrape` (~lines 289–290, 43/45/207–216).
- `src/shared/types.ts` + `src/main/storage/json-fs.ts` — `AppSettings.xListening` block + `mergeSettings` line.
- **Delete:** `src/renderer/modules/x/`, `src/renderer/modules/ghostscrape/`, `src/main/x/**`, `resources/twscrape-runner/**` + its fetch/build wiring.
- Tests: `test/capture-*.test.ts`, `test/x-listening-*.test.ts(x)`.

---

### Task F1: Hardened capture-window harness

**Files:** Create `src/main/capture/capture-window.ts`; Test `test/capture-window.test.ts`.

**Interfaces:**
- Produces: `createCaptureWindow(opts: { partition: string; url: string; allowHosts: string[]; proxy?: { socks: string } }): Promise<Electron.BrowserWindow>` — builds a hardened window, applies `proxy` to the partition session (Plan B uses this), installs deny-by-default `setWindowOpenHandler` + a `will-navigate` guard rejecting any host not in `allowHosts`; `runCapture(win, staticJs: string): Promise<unknown>` — `win.webContents.executeJavaScript(staticJs, true)`; `assertTrustedSender(e: Electron.IpcMainInvokeEvent): void` — throws if `e.senderFrame.url` is not the app's own `file://` origin.

- [ ] **Step 1: Write failing tests** — `test/capture-window.test.ts`, `vi.mock('electron', …)` returning a fake `BrowserWindow` recording `webPreferences`, `setWindowOpenHandler`, `webContents.on('will-navigate')`, `session.fromPartition(...).setProxy`:
  - `createCaptureWindow` sets `nodeIntegration:false, contextIsolation:true, sandbox:true, webviewTag:false, webSecurity:true`.
  - the open handler returns `{action:'deny'}` for any URL.
  - a `will-navigate` to a host not in `allowHosts` calls `preventDefault`; one in `allowHosts` does not.
  - when `proxy` is given, `session.fromPartition(partition).setProxy` is called with `proxyRules` containing the socks value and empty `proxyBypassRules`, awaited BEFORE `loadURL`.
  - `assertTrustedSender` throws for a `senderFrame.url` of `https://x.com/…` and passes for the app's `file://…/index.html`.
- [ ] **Step 2: Run — expect FAIL** (`pnpm vitest run test/capture-window.test.ts`).
- [ ] **Step 3: Implement** `capture-window.ts` porting the hardening pattern from quarantine `electron/main.cjs:214-268` (webPreferences, `setWindowOpenHandler` deny + allowlist, permission-deny). Order: create session, `await setProxy` if proxy, install guards, then `loadURL`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** (`src/main/capture/capture-window.ts`, test).

### Task F2: Shared security primitives

**Files:** Create `src/main/capture/security.ts`; Test `test/capture-security.test.ts`.

**Interfaces:**
- Produces: `guardExternalUrl(u: string): string | null` (returns `u` iff `new URL(u).protocol` ∈ `{http:,https:}`, else null); `csvCell(v: string): string` (prefix a `'` when `v[0]` ∈ `= + - @ \t \r`, then quote-escape + double interior quotes); `escapeField(v: string): string` (HTML-escape `& < > " '`); `confineImportPath(root: string, rel: string): string | null` (returns absolute path iff `resolve(root,rel)` starts with `resolve(root)+sep`, else null); `remoteMediaToDataUri(win, url): Promise<string|null>` (fetch inside the capture page via static JS → data URI; null on failure — never returns a remote URL).

- [ ] **Step 1: Write failing tests** covering: `guardExternalUrl('javascript:alert(1)')===null`, `guardExternalUrl('file:///etc/passwd')===null`, `guardExternalUrl('https://t.me/x')==='https://t.me/x'`; `csvCell('=HYPERLINK("x")')` starts with `'`; `csvCell('bio')` unchanged-but-quoted-safe; `escapeField('<b>&')==='&lt;b&gt;&amp;'`; `confineImportPath('/root','../../etc/passwd')===null`, `confineImportPath('/root','media/a.jpg')` inside root; `remoteMediaToDataUri` returns a `data:` string or null, never `http`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** per the interfaces (port the intent of quarantine `csvCell` at `main.cjs:1130` but ADD the formula-prefix guard the review flagged).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.**

### Task F3: X encrypt-at-rest data layer

**Files:** Create `src/main/x-listening/store.ts`; Modify `src/shared/types.ts` (+ `AppSettings.xListening`), `src/main/storage/json-fs.ts` (`mergeSettings`); Test `test/x-listening-store.test.ts`.

**Interfaces:**
- Consumes: `secure-fs` (follow `src/main/storage/scraping-cases.ts`), `HarvestedItem` (`src/shared/socmint/types.ts`).
- Produces: `xStore.saveItems(caseId, HarvestedItem[])`, `xStore.readItems(caseId)`, and per-artifact encrypted stores `notes`, `networks`, `archiveState` keyed by caseId. `AppSettings.xListening: { collect: { replies: boolean; reposts: boolean; comments: boolean }; archiveCycles: boolean }` (defaults all false).

- [ ] **Step 1: Failing tests** — items round-trip through `saveItems`/`readItems`; the on-disk file is **ciphertext** (assert the raw file bytes do NOT contain a known plaintext field value); `mergeSettings(defaultSettings, {} as any).xListening` yields the default block (upgrade guard).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the store on `secure-fs`; add the `xListening` `AppSettings` field + default + the mandatory `mergeSettings` line.
- [ ] **Step 4: Run — PASS.** Also `pnpm typecheck`.
- [ ] **Step 5: Commit.**

### Task X1: Module registry + shell (retire nothing yet)

**Files:** Create `src/renderer/modules/x-listening/XListeningModule.tsx`; Modify `register-builtins.tsx`, `src/shared/ipc-contracts.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`; Test `test/x-listening-module.test.tsx`.

**Interfaces:** Produces the `x-listening-station` module key + `window.api.xListening` typed surface (methods added per later tasks).

- [ ] **Step 1: Failing test** — `registerBuiltins()` registers a module with key `x-listening-station`, title `X Listening Station`, category `osint`/`Social Media`; rendering `XListeningModule` (createRoot+act, mock `window.api.xListening`) shows the connect affordance.
- [ ] **Step 2: FAIL.** **Step 3:** implement the shell + registry entry + IPC contract group + preload passthrough. **Step 4: PASS + typecheck.** **Step 5: Commit.**

### Task X2: Authenticated X session + challenge refusal

**Files:** Create `src/main/x-listening/ipc.ts` (connect channel), consume `capture-window.ts`; Test `test/x-listening-connect.test.ts`.

**Interfaces:** Consumes `createCaptureWindow`. Produces `xListening.connect()` opening a hardened window on `persist:x-listening` (NO proxy — clearnet) at `https://x.com/home`; `xListening.status()` deriving a `connected` boolean from the presence of the auth cookie WITHOUT copying/logging the token (port `main.cjs:236-242`); an `assertSignedInPage`-style check that on a verification/rate-limit/arkose page the capture **stops and reports blocked** (port `main.cjs:426-443`), never attempts a solve.

- [ ] Failing test → FAIL → implement → PASS → commit. Test asserts: connect uses partition `persist:x-listening` with no proxy; status never returns the raw token; a fixture page flagged as a challenge yields `{blocked:true}` and triggers no capture.

### Task X3: Visible-post capture → HarvestedItem

**Files:** `src/main/x-listening/extract.ts` (static JS + normalizer), `ipc.ts` (capture channel); Test `test/x-listening-extract.test.ts`.

**Interfaces:** Produces `X_POST_SCRIPT` (static string, no interpolation — port `main.cjs:382/427/489`) and `normalizePost(raw): HarvestedItem` mapping visible fields → a `HarvestedItem` stamped `provenance:'visible-capture', verified:false`; rounded metrics via `parseMetricText` stored as `{value, approx:true}` (fix the false-precision finding); media/avatar captured to local `data:` via `remoteMediaToDataUri` (NO remote URL stored — fix the beacon finding). Captured items persisted via `xStore.saveItems`.

- [ ] Failing tests on **pure `normalizePost`** with a captured-DOM fixture: verbatim text preserved + escaped where rendered; `metrics.likes.approx===true` for a `"1.2K"` source; `media[0].startsWith('data:')` and no field starts with `http`. → FAIL → implement (extract + normalize + persist to encrypted store) → PASS → commit. (The static-JS string is asserted to contain no `${` interpolation.)

### Task X4: Replies / reposts / third-party comments toggles

**Files:** extend `extract.ts` + `ipc.ts`; Test `test/x-listening-threads.test.ts`.

**Interfaces:** Consumes `AppSettings.xListening.collect`. Produces `normalizeReply`/`normalizeRepost`/`normalizeComment` → `HarvestedItem`s tagged by kind; capture gated on the collect toggles. Port the reply/repost/comment extraction from `main.cjs` (search its thread/`status` capture paths).

- [ ] Failing tests (pure normalizers + the gate: a toggle off → that kind is not captured) → FAIL → implement → PASS → commit.

### Task X5: Follower/following network extractor + export

**Files:** extend `extract.ts`, `ipc.ts`, `store.ts` (`networks`); Test `test/x-listening-network.test.ts`.

**Interfaces:** Produces `captureFollowers/captureFollowing` → the **actual visible `UserCell` accounts** (port `main.cjs:982-1011`; honest — never a scraped count-number), stored in the encrypted `networks` artifact store keyed by caseId + target; export via the app's existing exporter with `csvCell` guarding every cell.

- [ ] Failing tests: normalizer returns visible account rows (no fabricated count); export CSV cells are formula-guarded → FAIL → implement → PASS → commit.

### Task X6: Analyst notes

**Files:** `ipc.ts`, `store.ts` (`notes`); renderer notes panel; Test `test/x-listening-notes.test.ts`.

**Interfaces:** Produces `notes.save(caseId, findingId, text)` / `notes.read` on the encrypted `notes` store; the renderer note editor uses `confirm()` not `prompt()` (prompt is a no-op in Electron).

- [ ] Failing test (round-trip encrypted; ciphertext on disk) → FAIL → implement → PASS → commit.

### Task X7: Low-rate archive cycles

**Files:** `ipc.ts`, `store.ts` (`archiveState`); Test `test/x-listening-archive.test.ts`.

**Interfaces:** Produces a bounded, cancellable low-rate cycle (port `main.cjs` auto/archive path) writing incremental `HarvestedItem`s + `archiveState`; gated on `AppSettings.xListening.archiveCycles`; deterministic scheduling (no `Date.now()` in the tested decision — inject a clock).

- [ ] Failing test (a cycle appends items + advances state; off-toggle = no run; clock injected) → FAIL → implement → PASS → commit.

### Task X8: Exports (reuse app exporters)

**Files:** `ipc.ts`; Test `test/x-listening-export.test.ts`.

**Interfaces:** Produces JSON/PDF/DOCX export of the case's X items via the app's **existing** PDF/DOCX exporters (locate them; do NOT add `docx`/`pdfkit`); every scraped field escaped; CSV via `csvCell`.

- [ ] Failing test (export contains items; a `=cmd` bio is neutralized in CSV; a `<script>` bio is escaped in the doc) → FAIL → implement → PASS → commit.

### Task R1: Retire `x`, `ghostscrape`, twscrape sidecar

**Files:** Delete `src/renderer/modules/x/`, `src/renderer/modules/ghostscrape/`, `src/main/x/**`, `resources/twscrape-runner/**`; Modify `register-builtins.tsx` (remove imports + `x`/`ghostscrape` registrations), `package.json`/`electron-builder`/`scripts/` (remove twscrape fetch/build steps), any afterPack/asar verify referencing the sidecar; Modify `src/main/ipc/register.ts` (remove retired channels).

- [ ] **Step 1:** grep the repo for `twscrape`, `ghostscrape`, and the `x` module key; enumerate every reference. **Step 2:** remove them; ensure the import-graph sentinel + build config no longer reference the sidecar. **Step 3:** `pnpm typecheck` + `pnpm vitest run` green (delete/retarget tests of the retired modules). **Step 4:** boot-path check — the app registers `x-listening-station` and no dangling `x`/`ghostscrape` menu entries. **Step 5: Commit.**

### Task V1: Security-regression + seam + honesty suite

**Files:** Test `test/x-listening-security.test.ts`, `test/x-listening-seam.test.tsx`.

- [ ] **Security regression** — one assertion per checklist item: `assertTrustedSender` rejects a non-app frame; no `shell.openExternal` symbol reachable from the X module (grep-in-test); `confineImportPath` rejects traversal; every CSV export cell formula-guarded; no captured record field is a remote `http` media URL; a `<script>`-bearing fixture renders escaped (no injected node); no `demo-` records in a saved store.
- [ ] **Seam test** — the renderer `connect`/`capture` calls send every field `ipc.ts` requires (the v3.24.2 collect-path class: assert the renderer→main payload shape matches the handler's expected args).
- [ ] **Honesty test** — a `"1.2K"` metric is stored `approx:true` (not `1200`); a challenge fixture blocks capture; a missing profile field records "Not visible" not a guess.
- [ ] Run all green; `pnpm typecheck` clean. Commit.

---

## Self-Review

- **Spec coverage:** capture model (F1), security checklist (F2 + V1), encrypt-at-rest + settings (F3), module + retirement (X1/R1), X session + challenge-refusal (X2), post/reply/repost/comment capture (X3/X4), follower networks (X5), notes (X6), archive cycles (X7), exports (X8), honesty (X3 + V1), trust-domain quarantine (Global Constraints + R1). Telegram + Tor-fail-closed = **Plan B** (out of scope here, by design). WhatsApp untouched.
- **Placeholder scan:** port tasks cite exact quarantine source lines + concrete normalizer/test assertions; infrastructure tasks (F1–F3) carry full interfaces + test specs. No TBDs.
- **Type consistency:** `HarvestedItem` (shared type) used in F3/X3/X4/X5; `createCaptureWindow`/`runCapture`/`assertTrustedSender` (F1) consumed by X2/X3; `guardExternalUrl`/`csvCell`/`escapeField`/`confineImportPath`/`remoteMediaToDataUri` (F2) consumed by X3/X5/X8/V1; `xStore`/artifact stores (F3) consumed by X3–X7.
