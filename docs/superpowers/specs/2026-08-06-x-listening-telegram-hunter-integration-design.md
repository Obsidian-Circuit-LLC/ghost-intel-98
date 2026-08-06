# X Listening Station + Telegram Hunter Integration — Design

**Date:** 2026-08-06
**Status:** Approved for planning
**Origin:** GhostExodus built three external Electron OSINT tools (X Listening Station v2.3.0, Telegram Hunter v1.5.1, and a combined CYBERVS DOMINATVS Intelligence Station v2.0.1). Operator directed replacing Ghost Intel 98's X + SOCMINT-Telegram collectors with them. A 3-pass adversarial security/charter review cleared them **GO, as a PORT** (not a raw graft) with a defined hardening/Tor/encrypt-at-rest checklist. See [[x-listening-station-queued]] memory + review task outputs (`aaadcc09`/`aa24c0af`/`ab4616c7`).

## Goal

Port the **full feature set** of GhostExodus's X Listening Station and Telegram Hunter into Ghost Intel 98 — hardened to the app's renderer↔main trust boundary, encrypt-at-rest, and (for Telegram) Tor-fail-closed — replacing the existing X and SOCMINT-Telegram collectors, while preserving the tools' honesty-by-design behaviour and losing none of GhostExodus's features.

## Scope

**Retire:**
- The `x` module (`src/renderer/modules/x/`, `src/main/x/` — twscrape sidecar client, session-test, ghostscrape). This drops the **twscrape sidecar** entirely (and its Windows-VM build burden + `resources/twscrape-runner/` bundling + PyInstaller pipeline).
- The `ghostscrape` module (`src/renderer/modules/ghostscrape/`, `src/main/x/ghostscrape/`).
- Both retire their registry entries in `src/renderer/modules/register-builtins.tsx` (keys `x`, `ghostscrape`, ~lines 289–290).

**Replace in place:**
- SOCMINT's **Telegram engine** (`src/main/socmint/collector.ts` GramJS/mtcute path + `tor-identity.ts`) → Telegram Hunter's authenticated-Telegram-Web capture, Tor-fail-closed. SOCMINT's module shell, IPC, store, ranking, and **WhatsApp** (`whatsapp-*.ts`) are **unchanged**.

**Add:**
- A new **X Listening Station** module (`key: 'x-listening-station'`, category `osint`/`Social Media`), main-process capture under `src/main/x-listening/`.

**Trust domains (unchanged split):** X = **clearnet quarantine** (a separate trust domain, no Tor/Telegram link — enforced by the existing import-graph sentinel). Telegram = **Tor fail-closed**. WhatsApp = unchanged.

## Architecture

### Capture-session model (both tools)

Adopt the X Listening Station's proven main-process model (the review's hardening exemplar), NOT Telegram Hunter's renderer-owned `<webview>`:

- Each capture surface is a **main-process hardened `BrowserWindow`** on a named persistent partition: `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, no `webviewTag`, `webSecurity:true`.
- The window loads the authenticated site (x.com / web.telegram.org); the user signs in directly. Capture is via **static `executeJavaScript`** reading only the rendered DOM (no interpolation of user input into the script; scraped values flow out as return data only).
- Main owns every window. `setWindowOpenHandler` denies by default; navigations re-validated against a hostname allowlist. **No `shell.openExternal`** on scraped URLs — captured links render inert (or open only inside a same-domain, same-proxy in-app window).
- Every `ipcMain.handle` is wrapped in a **sender check** (port XLS's `assertTrustedSender`); the remote capture window has no preload and cannot reach fs/shell/purge IPC. A `will-navigate` deny-guard protects the host window.

### Telegram Tor-fail-closed (the anonymity requirement)

The Telegram capture partition is proxied through the bundled Tor SOCKS **before the page attaches/loads**:
- `session.fromPartition(part).setProxy({ proxyRules: 'socks5://127.0.0.1:<torPort>', proxyBypassRules: '' })` applied and awaited before the window navigates.
- `webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` — closes the STUN/UDP leak a SOCKS proxy does not stop (the highest-risk deanon vector).
- **Fail-closed gate:** capture window is not created/loaded until the bundled Tor reports bootstrapped (`bgconn` `isBootstrapped()` / `TOR_UNAVAILABLE`); a dead Tor port yields connection-refused, never a direct fallback. `socks5://` gives Chromium remote DNS (socks5h); empty bypass list; no system-proxy fallback.
- Per-profile partitions each independently receive the proxy + WebRTC policy before attach.
- X's partition is a **separate, un-proxied** partition, leaving X clearnet-quarantined automatically.

### Modules (renderer)

- **X Listening Station** — new module; UI ported from `src/main.tsx` (React) of XLS v2.3.0, adapted to Ghost Intel's shell/window system and `window.api` IPC. Retires `x` + `ghostscrape`.
- **SOCMINT** — existing module; the Telegram tab/engine is rewired to the Telegram Hunter capture path; WhatsApp tab unchanged. (Telegram Hunter's standalone UI is folded into SOCMINT's existing Telegram surface, not a separate module.)

## Data model (hybrid — approved)

- **Captured items** (X posts / replies / reposts / comments; Telegram messages / profiles / members) normalize into Ghost Intel's **encrypted case store** as **HarvestedItem-family records**, unified with the rest of OSINT, scoped to the active case, each stamped **visible-capture / unverified** provenance.
- **Tool-specific artifacts** get **per-tool encrypted stores scoped to the case**, ported out of the tools' plaintext JSON into the app's encrypt-at-rest layer: X analyst notes, X follower/following networks, X archive-cycle state; Telegram keyword-watch rules, member-intelligence sets, imported Telegram-export sets, dedup index, targets/notes.
- **Session partition residual (approved: document, no regression):** the Chromium persistent partition writes its own Cookies/LevelDB SQLite that JSON-level encryption does not cover. It lives under the app data dir with the same protection today's X/Telegram sessions already receive — **no regression from current posture** — documented as a known residual, with an OS-keystore/encrypted-container hardening path noted for later.

## Security checklist (from the review — all mandatory before merge)

1. **Sender-checked IPC** on every handler (port XLS `assertTrustedSender`); host window `will-navigate` deny-guard.
2. **`shell.openExternal`** removed or `https?`-only scheme-guarded (parse with `new URL`, reject else); same validation before any in-app `loadURL(scrapedUrl)`.
3. **Import path-traversal confinement** — Telegram Desktop export media paths resolved and asserted to stay within the chosen root (`resolved.startsWith(root+sep)`); reject/skip outside. Closes the LFI-into-UI/exports.
4. **CSV formula-injection prefix-guard** — any cell whose first char ∈ `= + - @ \t \r` is neutralized (leading `'`/space) before quote-wrap, both X and Telegram exports.
5. **Never inline remote media** — capture avatars/media to local `data:` thumbnails at collect time (as the combined app's X module already does); a stored remote URL must never reach an `<img src>` (honors the app's existing no-remote-media invariant). A committed test asserts no remote-src `<img>/<video>`.
6. **Escape all scraped content** — every captured field escaped where rendered (React JSX auto-escape on the X side; strict `esc()` discipline on any innerHTML path) + a test that fails on an unescaped scraped field.
7. **Metrics honesty** — rounded engagement counts (`"1.2K"`) stored verbatim or flagged approximate, never as false-precision integers.
8. **Drop demo-data co-mingling** — no synthetic records in the live case store.
9. **No `new RegExp(<untrusted>)`** — literal-match untrusted rules (keyword-watch terms already regex-escaped; keep it).

## Honesty (preserve as-is, map to app stamps)

The tools' honesty core is sound and stays: Telegram account-creation date recorded **unavailable, never inferred**; active **refusal to bypass** X verification/rate-limit challenges (stop, don't solve); **visible-DOM-only** capture with missing fields labeled "Not visible." Captured records carry Ghost Intel's **unverified / visible-capture** provenance stamp, consistent with the GeoINT honesty work.

## Feature parity (full — both tools)

**X Listening Station:** authenticated X session (connect/reopen, isolated hardened clearnet window); target-source management; visible-post capture; **replies / reposts / third-party comments** collection toggles; **follower/following network** extraction + export; **analyst notes** on findings; **low-rate archive cycles**; export to JSON/PDF/DOCX (reuse the app's existing exporters where possible; `docx`/`pdfkit` may be redundant).

**Telegram Hunter (inside SOCMINT):** authenticated Telegram Web session (isolated **Tor-fail-closed** partition, per-profile); active-chat **message capture**; group/channel **member intelligence** (visible members); visible **profile fields** (name/username/bio/links/status/phone-when-shown; account-age unavailable); **imported Telegram Desktop JSON**; **keyword watch**; dedup; local targets/notes/archive search; export case JSON + messages/members/profiles CSV (formula-guarded).

## Dependencies

No new runtime dependency is expected — Ghost Intel already ships PDF/DOCX-class exporters; reuse them rather than adding `docx`/`pdfkit`. Any new dependency requires operator approval. No new network egress beyond the capture targets (x.com/twimg clearnet-quarantined; web.telegram.org over Tor). No telemetry.

## Retirement / migration

- Delete the `x` and `ghostscrape` renderer modules + `src/main/x/**` (incl. sidecar client). Remove their registry entries and the twscrape sidecar bundling (`resources/twscrape-runner/**`, the fetch/build wiring, `scripts/` sidecar steps) — and update any afterPack/asar verification that referenced them.
- Existing **HarvestedItem** case data already collected by the retired modules **persists** (it lives in the case store, not the module UI); only the collection UIs/engines change. No destructive migration of user data.
- SOCMINT settings: the Telegram sub-config migrates to the new engine's shape via `mergeSettings` (add fields, deep-merge — the recurring hazard); WhatsApp settings untouched.

## Testing

- **Pure unit tests** for every extractor/normalizer (DOM-field → record) and the export/CSV-guard/escaping helpers.
- **Renderer↔main seam tests** — assert the renderer sends every field the capture handler requires (the v3.24.2 collect-path class of bug: a collector passing its own unit tests is NOT proven wired).
- **Tor-fail-closed leak test** — the Telegram partition refuses when Tor is not bootstrapped (mutation-style: flip the gate, assert no direct connection), the proxy is applied before load, and WebRTC UDP is disabled; assert no non-Tor egress on the Telegram path.
- **Encrypt-at-rest tests** — captured items + per-tool stores are ciphertext on disk; the documented session-partition residual is asserted to be no worse than current posture.
- **Security-regression suite** — one test per checklist item (sender-check, openExternal scheme-guard, import path-traversal reject, CSV prefix-guard, no-remote-media, no-unescaped-field, no-demo-in-store).
- **Honesty tests** — account-age renders unavailable; a challenge page stops capture; rounded metrics are not stored as exact.

## Success criteria

- `x`, `ghostscrape`, and the twscrape sidecar are gone; a single **X Listening Station** module delivers their combined capability with full XLS-v2.3.0 feature parity, clearnet-quarantined.
- SOCMINT's Telegram engine is Telegram Hunter, **Tor-fail-closed with no WebRTC/DNS leak**, full Telegram-Hunter feature parity; WhatsApp unaffected.
- Captured intel is encrypt-at-rest in the case store; tool-specific artifacts encrypt-at-rest per case.
- Every security-checklist item is fixed and test-guarded; honesty behaviour preserved.
- No new dependency, no new egress beyond the capture targets, no telemetry.
