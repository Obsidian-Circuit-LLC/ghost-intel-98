# WebSDR Viewer (from "SDR Eaves-Dropper" v0.1.11) — Hardened Port into Ghost Intel 98 — Design (finalized)

**Date:** 2026-08-14 (supersedes the 2026-08-12 DRAFT on `feat/websdr-viewer-port` — that draft predated the operator's clearnet-default egress decision and the X-Listening "keep his aesthetic" look precedent).
**Status:** Finalized for build.
**Source:** `SDREavesDropperbyGhostExodussourcev0.1.11.zip`, SHA-256 `2b0574091e9f5afdd9828113d1a87017d5270a730edb1b7d43f20a4928ccf082`, quarantined read-only at scratchpad `sdr-eavesdropper-quar/sdr-eaves-dropper/`.
**Related:** [[websdr-viewer-hardened-port]], [[cctv-over-tor-ga98cctv-proxy]], [[dcs98-csp-framesrc-plugin-invariant]], [[xls-enterprise-v3.4.1-port]].

## What the source actually is (factual review)

Despite the "Eavesdropper/SIGINT" branding, the source is **not** signal interception and has **no radio capability**. It is a **desktop manager + embedded browser for public internet SDR *websites*** (WebSDR / KiwiSDR / OpenWebRX / generic). No SDR hardware, **no transmit**, **no private-comms decoder**. `electron/main.ts` (123 lines) loads a public receiver's website into an Electron `WebContentsView` overlaid on the app window, drives that page's own controls by injecting DOM JavaScript (`executeJavaScript`), ships 851 public KiwiSDR URLs (`electron/kiwiDirectory.ts`), and records the receiver view to local `.webm` + free-text notes. No telemetry. **Monitoring public WebSDR is ordinary lawful use** — no interception-legality gate.

## Function-exactly-as-built inventory (his behavior we reproduce)

From `main.ts` IPC + `App.tsx` + `styles.css` (v0.1.5→v0.1.11):
- Receiver directory CRUD (types WebSDR/KiwiSDR/OpenWebRX/Generic; name/url/location/notes/favorite), seeded with 851 public KiwiSDR receivers (`directorySeedVersion` idempotent seed).
- Embedded receiver in a `WebContentsView` overlay (`receiver:load/hide/visible/bounds`); dialogs temporarily detach the view (v0.1.6) so modals aren't hidden behind it.
- Online/offline status check (`net.fetch` GET).
- Common control bar: frequency input + step buttons, mode buttons (AM/SAM/USB/LSB/CW/FM…), volume slider + mute — driven by his DOM-heuristic injection (`execControl`: match freq/mode/volume inputs by id/name/class/placeholder regex; `setAudioMuted` for mute). Incompatible pages remain fully usable via their native controls.
- Frequency presets (freq+mode+receiver).
- Listening notes (title + receiver/freq/mode context + free text, per-note edit/delete).
- Recording archive: capture the receiver view (`getMediaSourceId`) to `.webm`, list/play/annotate/export/reveal/delete.
- Customizable left **Station Menu**: sections All Feeds / Favorites / Presets / Add Feed / Customize; built-in items rename/reorder/show/hide + custom shortcuts to saved receivers.
- Receiver search filter; favorites; full-width top banner artwork; renderer/preload failure screen.
- `external:open` (open receiver in the system browser).

## Egress posture — the app's ONE narrow exception (operator decision 2026-08-14)

**CLEARNET-DEFAULT + warned Tor opt-in toggle.** His SDR streams live public WebSDR audio (WebSocket); forced through Tor it is often too laggy or Tor-exit-blocked to be usable — Tor-default would make it look broken out of the box, i.e. NOT functioning as built. So the WebSDR viewer is the **narrow exception** to GI98's Tor-default egress: it connects clearnet by default (works out of the box) with Tor as an opt-in toggle behind a one-time warning. Justification: public feeds, no private-comms capture, materially lower deanon stakes than authenticated X capture. **Contrast:** X Listening stays Tor-DEFAULT (real deanon risk). This dissolves the old Phase-0 Tor-audio feasibility gate — Tor is never forced on the audio path, so its usability is the user's opt-in call, not a build blocker.

Everything *invisible-to-function* still hardens (below). Only the egress DEFAULT relaxes.

## Global Constraints (bind every task)

1. **Egress:** the receiver `WebContentsView` uses a dedicated `persist:websdr` session. DEFAULT = direct clearnet (no proxy). A per-session **Tor toggle** routes that session through the app's Tor SOCKS (`session.setProxy` at the app's bg-Tor SOCKS endpoint) behind a one-time warning that Tor may break live audio; the toggle state persists (secure-fs). No global app egress changes; only this module's receiver session is affected. A visible marker always shows the current path (CLEARNET / TOR).
2. **Isolation (NOT CSP-on-remote):** the receiver page is a REMOTE interactive site we do not control — we CANNOT impose a strict CSP on it without breaking its own scripts/WebSocket, so containment is by isolation, not CSP rewriting. The `WebContentsView` runs `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, `webSecurity:true`, `allowRunningInsecureContent:false`, in the dedicated `persist:websdr` partition, with: a **permission request handler that hard-denies** everything (camera/mic/geolocation/notifications/USB/serial/etc. — a WebSDR needs none), a `setWindowOpenHandler` that **denies** new windows and only `openExternal`s a `normalizeUrl`-validated (http/https-only) URL, and a `will-navigate`/`will-redirect` guard. OUR OWN GI98 renderer surfaces keep the app's existing strict CSP unchanged — we never broaden the main renderer CSP/frame-src ([[dcs98-csp-framesrc-plugin-invariant]]); the receiver is a main-process-managed privileged overlay, not a renderer iframe/webview.
3. **Encrypt-at-rest:** the receiver directory, presets, notes, station-menu config, egress-toggle state, and recordings route through GI98 secure-fs (AES-GCM), NOT plaintext JSON/`.webm` beside the exe. Nothing that shouldn't survive uninstall does. (His `readDb`/`writeDb` plaintext + `.webm` `filePath` in userData are replaced.)
4. **URL validation:** every receiver URL passes `normalizeUrl` (http/https-only, `new URL` parse) at the trust boundary — on save, load, status, and external-open. Untrusted renderer input never reaches `new RegExp`/path building.
5. **Script injection retained but confined:** keep his freq/mode/volume DOM-heuristic injection verbatim in behavior (JSON-encoded payload via `executeJavaScript`), executed ONLY into the `persist:websdr` receiver view, never elsewhere.
6. **Determinism/supply-chain:** in-tree GI98 code (no separate `latest`-pinned package graph); any new dep pinned + lockfiled. IDs/timestamps via the app's injected seams in tested paths.
7. **Look = HIS green console as a FIXED theme (not the app theme).** Per the X-Listening precedent ("keep his aesthetic, don't reimagine it") reproduce his dark-green radio-intelligence look — `#07110b`/`#020805` bg, `#d7ffe1` text, `#52d876`/`#5cff81`/`#42d66a` greens, `#e8d65d` amber accents, Consolas/Segoe. Implement as a `--ga98-sdr-*` token namespace remapped under a `.sdr-root` wrapper to a FIXED dark-green console **identical in classic + QUIET AMETHYST** (mirrors X-Listening's `.xls-root`/`--ga98-xls-*`). Token-only — no raw colour literals (no-straggler guard green). The full-width banner artwork is bundled as a local asset (data/asset ref, never remote).
8. **No telemetry/egress** beyond the user-chosen receiver + (if toggled) Tor exit-verify.
9. **ADHD-friendly UX:** one-click connect, always-visible online/offline + CLEARNET/TOR state, visible recording state (pulsing indicator), plain language.
10. **assertTrustedSender + arg-shape validation** on every new IPC handler (the app's seam discipline).

## Architecture

New GI98 built-in module `websdr`: `src/main/websdr/*` (directory store, receiver-view manager, control injection, status, recordings, egress toggle, IPC) + `src/renderer/modules/websdr/*` (station-menu sidebar, control bar, receiver-view host with bounds reporting, notes, recording archive, dialogs, failure screen) + `src/renderer/modules/websdr/websdr.css`. Registered in `register-builtins.tsx` under the **OSINT** category (operator asked for the OSINT menu). The receiver `WebContentsView` is created/positioned by main from renderer-reported bounds (his `receiver:bounds` pattern), detached while GI98 modals are open (his v0.1.6 fix). The 851-URL KiwiSDR directory is imported as verified-pure JSON and seeded once into the secure-fs store.

## Feature parity list (source → GI98 seam → hardening → acceptance)

- **R1 Receiver directory** (CRUD + 851-seed). → secure-fs store, idempotent `directorySeedVersion`. → Accept: add/edit/remove/favorite persist encrypted; seed once on first run; `normalizeUrl` rejects non-http(s).
- **R2 Load a receiver** in the `persist:websdr` overlay. → `openReceiver`; clearnet default, Tor toggle sets session proxy; marker reflects path. → Accept: a receiver loads clearnet by default; toggling Tor re-routes the session and warns; the path marker is always correct.
- **R3 Control bar** (freq+steps, mode buttons, volume+mute) via confined DOM injection. → Accept: controls drive a compatible receiver; incompatible pages stay usable; injection runs only in the receiver partition.
- **R4 Status check** (online/offline) over the active egress path. → Accept: status reflects reachability on clearnet or (if toggled) Tor.
- **R5 Presets** (freq+mode+receiver). → secure-fs. → Accept: save/apply/remove persist encrypted.
- **R6 Notes** (context + free text, edit/delete). → secure-fs. → Accept: notes persist encrypted, searchable.
- **R7 Recording archive** (capture view → media; list/play/annotate/export/reveal/delete). → encrypted-at-rest store, explicit export via save-dialog, visible recording state. → Accept: a recording saves ENCRYPTED (verify `ENCX` envelope on disk, plaintext absent); export writes a plaintext `.webm` only to a user-chosen path; nothing plaintext survives uninstall.
- **R8 External-open + window-open** — `normalizeUrl`-guard `external:open`; `setWindowOpenHandler` denies new windows and only `openExternal`s a validated URL. → Accept: no remote page can trigger an unguarded external open or spawn a window.
- **R9 Station Menu** (customizable sidebar: All Feeds/Favorites/Presets/Add Feed/Customize; rename/reorder/show/hide built-ins + custom receiver shortcuts). → secure-fs config. → Accept: customizations persist encrypted; a hidden/renamed/reordered item round-trips.
- **R10 Failure screen** (renderer/preload fault → readable screen, not a blank window). → Accept: a forced module-load fault shows the failure surface.

## Testing

- Seam tests (main): secure-fs round-trip for directory/presets/notes/menu-config/recordings; `normalizeUrl` rejects non-http(s) + path-injection; egress toggle sets/clears the session proxy; permission handler hard-denies; `setWindowOpenHandler` deny + guarded openExternal; injection confined to the receiver session; recording persisted encrypted (ENCX on disk).
- Renderer (jsdom): station-menu customize round-trip; control-bar actions call the right IPC; bounds reporting; recording-state + CLEARNET/TOR markers; failure screen.
- Headless-Chrome computed-style: `.sdr-root` renders his fixed green console IDENTICALLY under classic + amethyst; no-straggler + typecheck + full suite green.

## Out of scope (never add)

Transmit; any private-comms decoder; broadening the main renderer CSP/frame-src; reverting any GI98 security invariant; imposing a strict CSP on the remote receiver page (would break it — isolation contains it instead).

## Decomposition (build phases → staged workflow)

- **Phase 1:** module scaffold + `websdr` types + secure-fs stores (directory/presets/notes/menu/recordings/egress-state) + 851-seed + IPC skeleton with assertTrustedSender + `normalizeUrl`. (R1)
- **Phase 2:** receiver-view manager — `persist:websdr` overlay, bounds/visible/detach-on-modal, clearnet-default + Tor-toggle session proxy + marker, permission hard-deny + window-open/nav guards, status check. (R2/R4/R8)
- **Phase 3:** control bar + confined injection (R3), presets (R5), notes (R6), recording-archive encrypted (R7).
- **Phase 4:** station-menu sidebar (R9) + failure screen (R10) + his green fixed-theme reskin (`--ga98-sdr-*`/`.sdr-root`) + banner asset + OSINT registration + whole-branch adversarial review.
