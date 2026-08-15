# Ghost Social Media Manager v2.5 — Hardened Port into Ghost Intel 98 — Design (finalized)

**Date:** 2026-08-15.
**Status:** Finalized for build.
**Source:** GhostExodus "Ghost Social Media Manager 2.0" (v2.5), zip SHA-256 `97d1b5ef334df2a839921c85dcf8d3bf39fd50755a035b9ae104edf26f7dcfc9`, quarantined read-only at scratchpad `social-mgr-quar/ghost-social-media-manager/`.
**Related:** [[next-release-manifest]], the SDR/WebSDR port ([[websdr-viewer-hardened-port]]) — same WebContentsView-overlay lifecycle lesson applies, MULTIPLIED (many per-account views).

## What the source is (factual review)

An **API-free, campaign-oriented social-media workstation** (Electron+React+TS). It uses **NO platform API keys/OAuth** — the user logs into each social site normally inside an embedded Chromium view, and each Campaign/account pair gets its own persistent Electron session partition (`persist:ghost-<campaign>-<account>`). It reads follower/following stats by opening the profile in a hidden Chromium window on the same authenticated partition (per-platform DOM adapters), composes and fans a post out to many accounts, and (v2.5) runs a **scheduled queue** that can auto-publish. App state is stored in an **AES-256-GCM vault** unlocked by a user password (scrypt-derived key, N=16384). No telemetry.

Platforms: X/Twitter, Instagram, TikTok, Facebook, Messenger, LinkedIn, YouTube, Bluesky, custom. Adapters live under `electron/adapters/` (DOM readers, repairable independently).

## Function-exactly-as-built inventory (his behavior we reproduce)

From `electron/main.ts`, `electron/core/{PublishingService,JobQueue,ProfileStatsService,GhostCore}.ts`, `electron/adapters/index.ts`, `src/App.tsx`, `src/styles.css`:
- **Vault** (AES-256-GCM + scrypt): setup (password → key + recovery key), unlock (password OR recovery key), lock; recovery-wrapped-key file. KEEP his crypto — it is solid.
- **Campaigns + accounts** sidebar; per-account `persist:` session partition; add/edit/remove account; custom platforms.
- **Embedded browser**: open an account's site in a cached `WebContentsView` (`browser:openAccount`), toolbar (back/forward/reload/address), resize/bounds, nav, cache mode (live/suspended), delete-account-data.
- **Dashboard**: account cards + follower/following stats; refresh stats via hidden window on the same partition (`ProfileStatsService`, per-platform adapters).
- **Composer**: write once, fan out to selected destination accounts. Manual publish = `PublishingService.publish` → PREPARE the post in each account's authenticated view (fills the composer) and STOP — the human reviews and clicks the platform's own Publish button. (v2.4.1 non-modal cross-post status.)
- **Compose Live Account Wall** (v2.3): a grid of live per-account `WebContentsView`s (`browser:showComposeGrid`) so the user drives several accounts side by side; draggable cards.
- **Scheduled Queue** (v2.5): a job editor (text + date + destinations) + queue list with status (running/complete/failed/partial/paused) + an "engine" indicator; the queue tick calls `PublishingService.autoPublish` → prepare + **`clickPublish`** (auto-clicks the platform Publish/Post button) on due jobs. THIS is the auto-post hazard (below).
- **Inbox** — STUBBED (returns empty); leave stubbed.
- **History**, **Settings** (cache mode, custom platforms), splash, auth pages, recovery display.

## Egress posture — clearnet-default + optional Tor toggle (operator decision 2026-08-14)

Logged-in social posting over Tor triggers platform lockouts/checkpoints, so this tool is (like WebSDR) a **narrow egress exception**: the per-account `persist:` sessions connect **clearnet by default**, with an **optional per-account Tor toggle** behind a one-time warning that Tor will likely break logged-in sessions. Toggle state persists in the vault state. A visible CLEARNET/TOR marker per active view. No global app egress change. (X Listening stays Tor-default; real deanon risk there.)

## Auto-post safety rails (operator decision 2026-08-14) — SAFETY-CRITICAL

His scheduled queue auto-CLICKS Publish on LIVE accounts with no per-post human gate — a wrong/early post to real audiences is unrecoverable. Reproduce the scheduler, but rail it:
1. **Default-OFF master "Arm auto-posting" switch.** The queue tick may PREPARE jobs, but `autoPublish`'s `clickPublish` (the actual Publish-button click) only fires when auto-posting is ARMED. Disarmed (the default) ⇒ scheduled jobs never auto-click Publish; they surface as "ready — arm auto-posting or publish manually".
2. **One-time confirm on arm.** Arming shows a clear confirm dialog naming the risk (Ghost will click Publish on live accounts automatically) before enabling.
3. **Persistent "AUTO-POSTING ARMED" indicator** whenever armed, visible on the Queue page + a global marker, so the state is never ambiguous.
Manual Composer publish (prepare-only, human clicks) is UNCHANGED — it was already safe.

## Global Constraints (bind every task) — hardening

1. **KEEP his AES-256-GCM + scrypt vault crypto** (password-derived key, N=16384/r=8/p=1, aes-256-gcm, recovery-wrapped key). Do NOT weaken it. Persist vault files in the module's GI98 data dir.
2. **Recovery key — NO plaintext to Desktop.** His `vault:saveRecoveryKey` auto-writes the key PLAINTEXT to `~/Desktop/…Recovery-Key.txt`. REPLACE with a user-initiated save-dialog to a user-chosen path + an explicit warning; never auto-drop it on Desktop. (Displaying it on-screen for the user to record is fine; silently writing a discoverable plaintext file is not.)
3. **`favicon:fetch` host-anchored.** His handler GETs an arbitrary `rawUrl` (SSRF-class). Restrict to the account/site's own host (or drop the affordance); never an arbitrary attacker-supplied host.
4. **`shell:openExternal` scheme-guarded.** His handler opens any url/scheme unguarded. Guard to http/https only (reuse the app's scheme-guard).
5. **Window-open + navigation guards.** His `setWindowOpenHandler` does `loadURL(url)` on ANY popup url — a remote page can drive the view anywhere. DENY new windows; on window.open, only navigate within the SAME site, else `openExternal` a scheme-guarded URL; add a `will-navigate`/`will-redirect` guard. Per-account views keep contextIsolation:true, nodeIntegration:false, sandbox:true (his defaults — keep).
6. **CSP** on the GI98 main renderer surface (the module UI). Do NOT impose a CSP on the remote social pages (breaks them — isolation contains them, as in the SDR port). NEVER broaden the main renderer frame-src.
7. **assertTrustedSender + arg-shape validation** on EVERY IPC handler (his have none).
8. **Determinism / supply-chain:** in-tree GI98 code; no separate `"latest"`-pinned package graph; any new dep pinned + lockfiled.
9. **Overlay lifecycle (the SDR lesson, MULTIPLIED).** Every per-account `WebContentsView` (embedded browser, compose-grid cards, hidden stats windows) composites ABOVE all DOM. Each must be shown ONLY while THIS GI98 module window is the focused, non-minimized, uncovered surface, bounds-tracked to its host region, detached while a GI98 modal is open, and TORN DOWN on module unmount (window close). A stray native view floating over the desktop/other windows is a release blocker. Hidden stats windows must always be closed after scraping.
10. **Look = his TEAL console as a FIXED theme (not the app theme).** Reproduce his dark-teal look (`#070b0d`/`#091013` bg, `#d7e3e3` text, `#52ddb9`/`#55dfba`/`#48dcb4` teal-greens, Inter) as a `--ga98-gsm-*` token namespace under a `.gsm-root` wrapper, FIXED and identical in classic + amethyst (mirror X-Listening's `.xls-root` / WebSDR's `.sdr-root`). Token-only — no raw colour literals (no-straggler green).
11. **Menu:** register under the **Creativity** category in the Access menu (operator).
12. **No telemetry / no egress** beyond the user-chosen accounts + (if toggled) Tor.
13. **Stubbed stays stubbed:** Inbox returns []; media is name/type-only, NEVER uploaded (do not add upload).

## Architecture

New GI98 built-in module `ghost-social`: `src/main/ghost-social/*` (vault, secure state store, per-account view manager, publishing service + auto-post arm gate, job queue/scheduler, profile-stats service, platform adapters, favicon/openExternal-guarded IPC) + `src/renderer/modules/ghost-social/*` (auth/unlock, campaigns sidebar, dashboard, composer, live account wall, scheduled queue, history, settings, embedded browser host, dialogs) + `ghost-social.css`. The per-account views are main-managed `WebContentsView`s positioned from renderer-reported bounds, governed by the shared overlay-lifecycle discipline (constraint 9). Registered under Creativity.

## Feature parity list (source → GI98 seam → hardening → acceptance) — abbreviated (see inventory)

- **G1 Vault** — his AES-256-GCM+scrypt, in the module data dir. Recovery key via save-dialog (G-harden #2), never Desktop plaintext. Accept: setup/unlock(password|recovery)/lock round-trip; recovery-key export goes ONLY to a user-chosen path.
- **G2 Campaigns/accounts + per-account persist: sessions.** Accept: add/edit/remove; each account isolated to its own partition.
- **G3 Embedded browser view** (open/nav/resize/cache) under the overlay-lifecycle discipline + window-open/nav guards. Accept: view loads the account site; hides on blur/minimize/modal; torn down on unmount; window.open cannot drive it off-site.
- **G4 Dashboard stats** via hidden same-partition window + adapters; window always closed after. Accept: a stat refresh opens+closes a hidden view; adapters read the visible counts.
- **G5 Composer fan-out** — manual publish PREPARES only (human clicks). Accept: publish fills each destination's composer and stops; status is non-modal.
- **G6 Compose Live Account Wall** — grid of per-account views, all under the lifecycle discipline. Accept: multiple views host + track their cards; all hide/tear-down together.
- **G7 Scheduled Queue + auto-post RAILS** (safety-critical). Accept: with auto-posting DISARMED (default), a due job never auto-clicks Publish; arming requires the one-time confirm; the ARMED indicator shows whenever armed; armed, a due job runs autoPublish→clickPublish.
- **G8 Egress toggle** per-account clearnet-default + Tor opt-in + warning + marker.
- **G9 Hardening** — favicon host-anchor, openExternal scheme-guard, CSP, assertTrustedSender (G-harden #3/#4/#6/#7).
- **G10 UI + his teal fixed theme + Creativity registration + Inbox-stub/History/Settings.**

## Testing

- Main seam tests: vault setup/unlock/lock + recovery-key path is a save-dialog (never Desktop); the AUTO-POST ARM GATE (disarmed ⇒ clickPublish NOT invoked; armed ⇒ invoked) — the safety-critical test; favicon host-anchor rejects a foreign host; openExternal rejects non-http(s); window-open/nav guard rejects off-site; per-account partition isolation; hidden stats window closed after scrape; assertTrustedSender on handlers.
- Renderer (jsdom): overlay lifecycle — every view hides on blur/minimize and tears down on unmount (the SDR regression class, for the browser view AND the compose-grid); the ARMED indicator renders; recovery-key export calls the save-dialog; Composer prepare-only.
- Headless computed-style: `.gsm-root` renders his teal console identically under classic + amethyst; no-straggler + typecheck + full suite green.

## Out of scope (never add)

Media UPLOAD (media stays name/type-only); a real Inbox (stays stubbed []); platform APIs/OAuth; broadening the main renderer CSP/frame-src; imposing CSP on remote social pages; weakening the vault; auto-posting without the arm gate.

## Decomposition (build phases → staged workflow)

- **Phase 1:** module scaffold + his vault (G1, secure recovery-key save-dialog) + secure state store + types + IPC skeleton (assertTrustedSender) + platform defaults/adapters port.
- **Phase 2:** per-account view manager (G2/G3) — persist: partitions, clearnet-default + Tor toggle (G8), the OVERLAY LIFECYCLE discipline (constraint 9: hide on blur/minimize/cover, bounds-track, detach-on-modal, teardown-on-unmount), window-open/nav guards, favicon host-anchor, openExternal scheme-guard, cache mode.
- **Phase 3:** publishing service (G5 prepare-only) + scheduled queue/job-queue + **the AUTO-POST ARM GATE + rails** (G7) + profile-stats service (G4, hidden-window-closed).
- **Phase 4:** renderer UI — auth/unlock, campaigns, dashboard, composer, live account wall (G6), scheduled queue + ARMED indicator, history, settings, embedded browser host + markers; his teal fixed theme (`.gsm-root`/`--ga98-gsm-*`); Creativity registration; Inbox stub. Then whole-branch adversarial review (correctness/overlay-lifecycle · hardening+auto-post-safety · fidelity-vs-his).
