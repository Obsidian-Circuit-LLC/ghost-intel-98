# Plan B — Telegram Hunter into SOCMINT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SOCMINT's mtcute Telegram engine with a full-parity port of GhostExodus's Telegram Hunter v1.5.1 — an authenticated Telegram Web session captured in the shared hardened window, **Tor-fail-closed**, encrypt-at-rest — leaving SOCMINT's shell and WhatsApp untouched.

**Architecture:** Reuse the Plan-A foundation (`src/main/capture/capture-window.ts` `createCaptureWindow` with its `proxy` param, `src/main/capture/security.ts`, the encrypt-at-rest store pattern). The Telegram capture window runs on a Tor-proxied partition (proxy applied and WebRTC-locked before load, gated on Tor bootstrap, no fallback). Captured items normalize into the encrypted case store as `HarvestedItem`s; Telegram-specific artifacts (members, keyword-watch, imports, dedup) go in per-tool encrypted stores. The SOCMINT module UI is rewired to drive the new engine.

**Tech Stack:** Electron main (hardened `BrowserWindow`, `session.setProxy`, `setWebRTCIPHandlingPolicy`), `getBgTor()` (`src/main/bgconn/tor-singleton.ts` → `isBootstrapped()`, `socksPort`), `HarvestedItem` (`src/shared/socmint/types.ts`), `secure-fs`, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-x-listening-telegram-hunter-integration-design.md`. Source (read-only quarantine): `/tmp/claude-0/-dcs98/956dbabe-6cc6-4375-9e68-f4a21d90048d/scratchpad/quar-tghunter/telegram-hunter` (`src/main.js`, `src/renderer.js`, `src/preload.js`).
- **Reuse the Plan-A foundation** (already on main): `createCaptureWindow({partition,url,allowHosts,proxy})`, `guardExternalUrl`/`csvCell`/`escapeField`/`confineImportPath`/`remoteMediaToDataUri` (host-restrict to web.telegram.org/t.me for Telegram), the settle-before-scrape pattern, `assertTrustedSender`, `ensureUuid` on caseId. **Do not re-derive them.**
- **TELEGRAM = TOR FAIL-CLOSED:** the capture partition proxy = `socks5://127.0.0.1:${getBgTor().socksPort}` applied and awaited BEFORE the guest loads; `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` on the webContents; capture is NOT created until `getBgTor()?.isBootstrapped()` is true (else return a clear TOR-not-ready result, NEVER a clearnet fallback); empty proxy bypass; a dead Tor port = connection-refused, never direct. Per-profile partitions each get proxy+WebRTC before attach.
- **NO new dependency.** No egress except web.telegram.org / t.me OVER TOR + the Tor SOCKS. No telemetry.
- **ENCRYPT-AT-REST** via `secure-fs`; caseId validated with `ensureUuid`. Capture window hardened (nodeIntegration:false/contextIsolation:true/sandbox:true/webviewTag:false); IPC via `safeHandle` + `assertTrustedSender`; scheme-guarded `system.openExternal` only.
- **HONESTY (preserve — the source already does this):** Telegram account-creation date recorded UNAVAILABLE, never inferred; visible-only capture; missing fields "Not visible"; phone captured only when the logged-in account sees it; displayName must NEVER fall back to @handle; provenance:"visible-capture", verified:false. No remote media inlining (avatars → local `data:`). No demo data.
- **SEAM DISCIPLINE (Plan-A lesson):** every main handler MUST be reachable from the SOCMINT renderer with a seam test asserting the UI invokes it with the correct payload (a handler passing its own unit test is NOT proven reachable — the v3.24.2 + Plan-A hollow-renderer class).
- Commit convention: onna-bugeisha-dev-team author, `--no-verify`, `-c`, explicit-path add, NO AI trailers. Implementers commit ONLY on the feature branch; controller merges. Tests: Vitest; React 18 createRoot+act (NO @testing-library); `vi.mock('electron')`; typecheck `src/**` only.

---

## File Structure

- `src/main/socmint/telegram-hunter/session.ts` — **new**: Tor-fail-closed Telegram capture window (uses `createCaptureWindow` + proxy + WebRTC lock + bootstrap gate).
- `src/main/socmint/telegram-hunter/extract.ts` — **new**: static capture payloads + pure normalizers (message/member/profile → `HarvestedItem` + artifacts).
- `src/main/socmint/telegram-hunter/collector.ts` — **new**: `TelegramHunterCollector implements SocmintCollector`, replacing `makeMtcuteCollector`.
- `src/main/socmint/telegram-hunter/store.ts` — **new**: encrypt-at-rest Telegram artifact stores (members, keyword-watch, imports, dedup) + import parser (`confineImportPath`-guarded).
- `src/main/socmint/ipc.ts` — modify: route the Telegram channels to the new collector; keep WhatsApp channels.
- `src/renderer/modules/socmint/**` — modify: the Telegram tab UI drives the new engine (+ seam tests); WhatsApp tab untouched.
- **Delete/retire:** the mtcute Telegram engine path in `src/main/socmint/collector.ts` (`makeMtcuteCollector`, `MtcuteClientLike`) + `tor-identity.ts` if superseded; keep `SocmintCollector` interface + `store.ts` + `whatsapp-*.ts`.
- Tests: `test/tg-hunter-*.test.ts(x)`.

---

### Task TF1: Tor-fail-closed Telegram capture window

**Files:** Create `src/main/socmint/telegram-hunter/session.ts`; Test `test/tg-hunter-session.test.ts`.

**Interfaces:** Consumes `createCaptureWindow` (Plan A), `getBgTor()`. Produces `openTelegramCapture(partition: string): Promise<{ blocked: true; reason: string } | { win: Electron.BrowserWindow }>` — returns blocked if `!getBgTor()?.isBootstrapped()`; else calls `createCaptureWindow({ partition, url:'https://web.telegram.org/k/', allowHosts:['web.telegram.org','t.me'], proxy:{ socks:'socks5://127.0.0.1:'+getBgTor().socksPort } })`, then `win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')`.

- [ ] **Step 1: Failing tests** (`vi.mock('electron')` + a mock `getBgTor`): not-bootstrapped → `{blocked:true}` and NO window created; bootstrapped → `createCaptureWindow` called with the socks proxy in `proxy.socks` and `allowHosts` = telegram hosts, proxy awaited BEFORE any load, and `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` called on the webContents; a dead/zero socksPort still routes only to the SOCKS rule (no direct).
- [ ] **Step 2: FAIL. Step 3:** implement. **Step 4: PASS + typecheck. Step 5: Commit.**

### Task TF2: Telegram artifact store + import (path-traversal-guarded)

**Files:** Create `src/main/socmint/telegram-hunter/store.ts`; Modify `src/shared/types.ts` (`AppSettings.socmint.telegram` engine fields) + `json-fs.ts` `mergeSettings`; Test `test/tg-hunter-store.test.ts`.

**Interfaces:** Produces encrypt-at-rest artifact stores (`members`, `keywordWatch`, `imports`, `dedup`) keyed by caseId (secure-fs, ensureUuid caseId), and `parseTelegramExport(root: string, json: unknown): ImportedItem[]` that resolves every media path via `confineImportPath(root, rel)` (Plan A) — anything outside the root is REJECTED (fixes the LFI). Items land as `HarvestedItem`s.

- [ ] **Step 1: Failing tests** — artifact stores round-trip as ciphertext (assert raw bytes lack a plaintext field); `parseTelegramExport` on a malicious export with `media:'../../../../etc/passwd'` returns that item with the media DROPPED (never an out-of-root absolute path); `mergeSettings` upgrade guard for the telegram engine block. → FAIL → implement → PASS+typecheck → Commit.

### Task TG1: Message capture → HarvestedItem (settle + Tor)

**Files:** Create `src/main/socmint/telegram-hunter/extract.ts` (+ message capture in `collector.ts`); Test `test/tg-hunter-messages.test.ts`.

**Interfaces:** Produces `TG_MESSAGE_SCRIPT` (static, no `${}` interpolation — port `renderer.js` `extractionScript`) + `normalizeMessage(raw): HarvestedItem` (visible-only, provenance stamped, media → local `data:` via host-restricted `remoteMediaToDataUri`). Capture navigates to the active chat, **settles** (the SPA async-render wait — Telegram Web is client-rendered, same race Plan A hit), gates on a challenge/lock check, then scrapes.

- [ ] **Step 1: Failing tests** on pure `normalizeMessage` (verbatim text escaped, `data:`-only media, provenance stamp) + a settle-before-scrape assertion + the static-script-no-`${}` guard (assert the source holds no template-substitution). → FAIL → implement → PASS → Commit.

### Task TG2: Member intelligence (visible group/channel members)

**Files:** extend `extract.ts`, `store.ts` (`members`); Test `test/tg-hunter-members.test.ts`.

**Interfaces:** Produces `captureMembers` → the visible member `UserCell`s (honest — no hidden/total count), stored in the encrypted `members` artifact store; port `renderer.js` member extraction.

- [ ] Failing test (visible members only; no fabricated total) → FAIL → implement → PASS → Commit.

### Task TG3: Visible profile fields (honesty-critical)

**Files:** extend `extract.ts`; Test `test/tg-hunter-profile.test.ts`.

**Interfaces:** Produces `normalizeProfile(raw)` capturing name/username/bio/links/status + phone ONLY when visible; **account-creation date = null with label "Unavailable — Telegram does not expose it" (NEVER inferred)**; displayName NEVER falls back to @handle; missing fields "Not visible."

- [ ] Failing tests: a no-display-name fixture records absent (not @handle); account-creation is null/unavailable; phone absent when not shown. → FAIL → implement → PASS → Commit.

### Task TG4: Keyword watch + dedup

**Files:** extend `store.ts` (`keywordWatch`, `dedup`), `collector.ts`; Test `test/tg-hunter-keyword.test.ts`.

**Interfaces:** Produces keyword-watch rules (LITERAL match — no `new RegExp(untrusted)`; port the source's regex-escaped highlight) + a dedup index; both encrypt-at-rest.

- [ ] Failing test (a keyword rule with regex metachars matches literally, no ReDoS; a duplicate item dedupes) → FAIL → implement → PASS → Commit.

### Task TG5: SOCMINT engine swap + renderer wiring (SEAM)

**Files:** Create `src/main/socmint/telegram-hunter/collector.ts` (`TelegramHunterCollector implements SocmintCollector`); Modify `src/main/socmint/ipc.ts` (route Telegram channels to it), `src/renderer/modules/socmint/**` (Telegram tab drives the new engine); Delete the mtcute engine (`makeMtcuteCollector` in `collector.ts`); Test `test/tg-hunter-seam.test.tsx`, `test/tg-hunter-collector.test.ts`.

**Interfaces:** `TelegramHunterCollector` satisfies the existing `SocmintCollector` interface (`src/main/socmint/collector.ts:40`) so SOCMINT's store/rank/filter/IPC are reused unchanged; WhatsApp collector untouched.

- [ ] **Step 1: Failing SEAM test** — render the SOCMINT Telegram tab (createRoot+act, mock `window.api`), assert it invokes connect/capture/members/export via the new engine with the correct payload (NOT a hollow shell — the Plan-A lesson). Plus a collector unit test that `TelegramHunterCollector` implements every `SocmintCollector` method.
- [ ] **Step 2: FAIL. Step 3:** implement the collector + IPC routing + renderer wiring; remove `makeMtcuteCollector`/`MtcuteClientLike`. **Step 4: PASS + typecheck. Step 5: Commit.**

### Task TG6: Exports (reuse app exporters, CSV-guarded)

**Files:** `collector.ts`/`ipc.ts`; Test `test/tg-hunter-export.test.ts`.

**Interfaces:** Case JSON + messages/members/profiles CSV via the app's existing exporters; every cell through `csvCell` (formula-guarded); every field escaped.

- [ ] Failing test (a `=cmd` bio neutralized in CSV; a `<script>` bio escaped) → FAIL → implement → PASS → Commit.

### Task TG-R: Retire the mtcute engine

**Files:** Modify `src/main/socmint/collector.ts` (remove `makeMtcuteCollector`, `MtcuteClientLike`), retire `tor-identity.ts` if superseded, remove any mtcute dependency wiring; Modify tests referencing the removed engine.

- [ ] Grep for `mtcute`/`makeMtcuteCollector` refs; remove them (keep `SocmintCollector`, `store.ts`, WhatsApp). Confirm `@mtcute/*` is removed from `package.json` deps if now unused. `pnpm typecheck` + `pnpm vitest run` green. Commit.

### Task TG-V: Verification suite (Tor-leak + seam + honesty + security)

**Files:** Test `test/tg-hunter-security.test.ts`, `test/tg-hunter-tor.test.ts`.

- [ ] **Tor-fail-closed leak test** — capture refuses when `getBgTor().isBootstrapped()` is false (mutation-style: flip the gate, assert no window/no capture); proxy is applied before load; `disable_non_proxied_udp` set; no non-Tor egress path exists (grep the Telegram module for any direct `net`/`fetch`/`loadURL` bypassing the proxied session).
- [ ] **Seam test** — the Telegram tab reaches every feature (capture/members/profile/keyword/import/export).
- [ ] **Honesty** — account-creation unavailable; displayName ≠ @handle; visible-only.
- [ ] **Security** — caseId ensureUuid on every Telegram handler; import path-traversal rejected via `confineImportPath` (wired, not dead); media host-restricted to telegram hosts; CSV formula-guarded; no remote-media `<img src>`; no new dep/egress.
- [ ] Run all green + typecheck. Commit.

---

## Self-Review

- **Spec coverage:** Tor-fail-closed (TF1 + TG-V), encrypt-at-rest + import-LFI-fix (TF2), message/member/profile capture (TG1/TG2/TG3), keyword/dedup (TG4), SOCMINT engine swap + renderer seam (TG5), exports (TG6), mtcute retirement (TG-R), honesty + security + Tor-leak verification (TG-V). WhatsApp explicitly untouched. Foundation reused from Plan A (not re-derived).
- **Plan-A lessons folded in:** renderer seam test (TG5) so no hollow UI; `ensureUuid` caseId (Global + TG-V); settle-before-scrape (TG1) for the Telegram SPA; media host-restriction; `confineImportPath` actually WIRED to the real import sink (TF2/TG-V), not dead.
- **Type consistency:** `SocmintCollector` (existing) implemented by `TelegramHunterCollector` (TG5); `HarvestedItem` used in TF2/TG1/TG2/TG3; `createCaptureWindow`/`confineImportPath`/`remoteMediaToDataUri`/`csvCell` (Plan A) consumed by TF1/TF2/TG1/TG6; `getBgTor()` consumed by TF1/TG-V.
