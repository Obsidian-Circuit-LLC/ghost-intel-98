# X Listening Station Enterprise v3.4.1 Port + Bootscreen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Rebuild Enterprise v3.4.1's feature set onto Ghost Intel 98's hardened seams (replacing the current X module), Tor-default with acked clearnet opt-in, + a custom-bootscreen setting.

**Architecture:** Feature rebuild, NOT a verbatim port. Reuse `createCaptureWindow`/`security.ts`/`secure-fs`/`safeHandleWithEvent`+`assertTrustedSender`/`HarvestedItem`+per-case secure-fs sidecars. Port only the pure logic (evidence/analysis/entities) near-verbatim from `enterprise.cjs`. Tor via the app's `getBgTor()` seam (drop Enterprise's bundled tor.exe).

**Tech Stack:** Electron main (TS), React 18 (createRoot+act, no @testing-library), Vitest, secure-fs AES-GCM.

## Global Constraints

- **SOURCE** (read-only, rebuild from): `/tmp/claude-0/-dcs98/956dbabe-6cc6-4375-9e68-f4a21d90048d/scratchpad/xls-enterprise-quar/` — `electron/main.cjs` (3134L), `electron/enterprise.cjs` (pure helpers), `src/main.tsx` (renderer), `docs/NETWORK-COLLECTION.md`.
- **Full design:** `docs/superpowers/specs/2026-08-11-x-listening-enterprise-port-design.md` (read it — feature list, Tor posture, data model, security invariants).
- **Reuse (do NOT reinvent):** `src/main/capture/capture-window.ts` (`createCaptureWindow`, `runCapture`, `assertTrustedSender`), `src/main/capture/security.ts` (`csvCell`, `escapeField`, `confineImportPath`, `remoteMediaToDataUri`, MEDIA_HOST_ALLOWLIST), `src/main/storage/secure-fs.ts`, `src/main/x-listening/store.ts` (`XStore` sidecar pattern — extend it), `src/shared/socmint/types.ts` (`HarvestedItem`, `dedupItems`).
- **Tor seam (canonical consumer to mirror):** `src/main/socmint/telegram-hunter/session.ts:44-74` — `getBgTor()?.isBootstrapped()` fail-closed, `proxy:{socks:'127.0.0.1:'+socksPort()}`, `webRTCIPHandlingPolicy:'disable_non_proxied_udp'`.
- **IPC:** every X handler via `safeHandleWithEvent` (`register.ts:276`) and `assertTrustedSender(e)` first. Typed channels in `src/shared/ipc-contracts.ts` `channels.xListening`.
- **Encrypt-at-rest:** ALL intel (posts/relationships/notes/presets/archive/entities/media) via secure-fs under `scrapingCaseDir('x', id)`. NEVER `fs.writeFile` intel data. No monolithic `station-state.json`.
- **Honesty (charter):** demo records get `synthetic:true`/`source:'demo'` enforced-excluded from analysis + exports + evidence hashing; `metricsRaw` kept and folded into `canonicalPostEvidence`; media stored as `data:`/local bytes only (never a remote URL); conservative non-fabricating inference preserved.
- **No new dependency, no telemetry, no bundled tor.exe.** Egress = X capture target only (Tor by default).
- **Commit persona:** `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`, `--no-verify -c`, explicit-path add, NO AI trailers. Branch `feat/ui-polish-banners-jjlogin`.
- **No-hollow-UI rule ([[socmint-collect-path-wiring-v3.24.2]]):** every IPC channel the renderer needs must be wired end-to-end with a seam test.

---

## PHASE 1 — Backend foundation

### Task 1: Expand the xListening store (secure-fs artifact sidecars)
**Files:** rewrite `src/main/x-listening/store.ts`; test `test/x-listening-store.test.ts`.
**Produces:** `XStore` extended with sidecars — `posts` (`XPostArtifact[]`: HarvestedItem-superset with `metrics`,`metricsRaw`,`kind`,`parentPostId`,`evidenceHash`,`synthetic?`,`mediaRefs` local), `networks` (`XNetworkArtifact`), `notes` (`XNote`), `presets` (`XPreset`), `archiveState` (`XArchiveState`), `entitiesCache`. `prodXStore()` wires secure-fs paths under `scrapingCaseDir('x', id)`. Consumed by all later tasks.
- [ ] TDD: round-trip each sidecar encrypted; dedup posts by id; a plaintext-write assertion (no `fs.writeFile` of intel). Commit.

### Task 2: Pure evidence + analysis + entity functions (port from enterprise.cjs)
**Files:** `src/main/x-listening/evidence.ts`, `src/main/x-listening/analysis.ts`; tests `test/x-listening-evidence.test.ts`, `test/x-listening-analysis.test.ts`.
**Produces:** `sha256(obj)`, `canonicalPostEvidence(post)` (**fold `metrics` in** — Enterprise omits them), `canonicalRelationshipEvidence(rel)`; `computeNetworkAnalysis(profiles,relationships)` (identities, overlapScore, pairwise common*, graph nodes/edges), `deriveCollectionHealth(runs)`, `extractEntities(text)`. Port near-verbatim from `enterprise.cjs:3-231`.
- [ ] TDD: fixture-based unit tests; **demo/synthetic records excluded** from `computeNetworkAnalysis`; evidence hash changes when metrics change. Commit.

### Task 3: Capture session + Tor posture (getBgTor seam, Tor-default + acked clearnet)
**Files:** `src/main/x-listening/session.ts` (new); modify `src/shared/types.ts` (`AppSettings.xListening.clearnet:boolean` default false + `mergeSettings` already deep-merges the `xListening` block); test `test/x-listening-tor.test.ts`.
**Produces:** `connectXSession(caseId)` / `getXStatus` / `clearXSession` using `createCaptureWindow({partition:'persist:x-listening', url:X_HOME_URL, allowHosts:['x.com','twitter.com'], ...tor})`. Tor logic mirrors `telegram-hunter/session.ts`: if `settings.xListening.clearnet===false` → require `getBgTor()?.isBootstrapped()` (else `{blocked:true}`, no fallback) + `proxy:{socks}` + `webRTCIPHandlingPolicy:'disable_non_proxied_udp'`; if clearnet===true → no proxy, still WebRTC-disable, and the caller must have passed the one-time real-IP ack.
- [ ] TDD: fails closed when Tor not bootstrapped in Tor mode; WebRTC policy applied; **mutation test: no capture fires clearnet while clearnet===false**. Commit.

### Task 4: Timeline capture → HarvestedItem + post artifact
**Files:** `src/main/x-listening/extract.ts` (static in-page scripts — adapt from Enterprise `readVisibleTimelineItems`/`assertSignedInPage`), `src/main/x-listening/capture.ts`; test `test/x-listening-capture.test.ts`.
**Produces:** `captureTimeline(win, profile)` via `runCapture(win, staticJs)` → normalize each post into `HarvestedItem` (id=SHA-256(`x:profileId:statusId`), authorHandle, publishedAt, url via `isXUrl`, provenance.caseId) + a richer `XPostArtifact` (metrics + **metricsRaw** kept, kind, parentPostId, evidenceHash via Task 2). Static JS only — no scraped-data interpolation.
- [ ] TDD (mock the capture page returning fixture DOM rows): posts normalize correctly; metricsRaw preserved; evidenceHash set; dedup on re-capture. Commit.

### Task 5: Campaigns as self-managed x-namespace scraping cases (removes case requirement)
**Files:** `src/main/x-listening/campaigns.ts`; test `test/x-listening-campaigns.test.ts`.
**Produces:** `listCampaigns/createCampaign/switchCampaign/updateCampaign/deleteCampaign` operating on `x`-namespace scraping-case ids (`scrapingCaseDir('x', id)`) — the module owns its campaign list; **no core investigation case need be bound**. Per-campaign artifact scoping.
- [ ] TDD: create/switch/delete a campaign with NO core caseId bound; artifacts scoped per campaign; delete removes the campaign's media dir. Commit.

### Task 6: IPC wiring for Phase-1 surface
**Files:** expand `src/shared/ipc-contracts.ts` `channels.xListening`; rewrite `src/main/x-listening/ipc.ts` (`registerXListeningIpc({handle})`); modify `register.ts:1764` wiring stays; preload `api.d.ts`; test `test/x-listening-ipc-seam.test.ts`.
**Produces:** channels for session/status/clear, timeline capture, campaigns, analysis/health/entities (derived), notes/presets read/write. Each handler `assertTrustedSender(e)` first, via `safeHandleWithEvent`. Push `state:changed`/`sweep:progress` on the app watcher seam.
- [ ] TDD: seam test — each channel invokable; sender-check rejects a non-file origin; typecheck. Commit.

---

## PHASE 2 — Backend features

### Task 7: Follower/following network capture → XNetworkArtifact
**Files:** extend `extract.ts` (relationship scroll/accumulator — adapt Enterprise `scrapeRelationshipRows`/in-page accumulator, `NETWORK-COLLECTION.md`), `capture.ts`; test.
- [ ] TDD: relationships ingested + evidenceHash; conservative (no auto-unfollow inference); dedup by (profileId,relationship,username). Commit.

### Task 8: Historical archive cycles (resumable, low-rate)
**Files:** `src/main/x-listening/archive.ts`; test. **Produces:** `runArchiveStep(caseId)` advancing `archiveState.nextOperationIndex`/`cyclesCompleted` (adapt Enterprise `runArchiveCycle`), rate-bounded.
- [ ] TDD: step advances + persists cursor; resumes from cursor; respects the step/max-pass bounds. Commit.

### Task 9: Media/avatar caching (host-anchored, secure-fs, no remote URLs)
**Files:** `src/main/x-listening/media.ts`; test.
**Produces:** fetch via `remoteMediaToDataUri(win, url, MEDIA_HOST_ALLOWLIST)` (host-**anchored** — rejects `…?y=pbs.twimg.com/media` decoys), persist bytes via `secureWriteFile` under the case dir + byte-`sha256`. The artifact stores a local ref, never a remote URL.
- [ ] TDD: decoy host rejected; stored ref is local (no `http`); bytes encrypted; media evidence hash. Commit.

### Task 10: Notes + presets + local search
**Files:** `src/main/x-listening/notes-presets.ts` (or fold into ipc.ts); test.
- [ ] TDD: note add/update/remove; preset save/remove/run (highlight matches over posts). Commit.

### Task 11: Exports (JSON/PDF/CSV + SHA-256 sidecar, formula-guarded)
**Files:** `src/main/x-listening/exports.ts` (reuse `itemsToJson`/`itemsToCsv`/`buildXItemsHtml`/`buildXItemsReport` from the old ipc.ts + `csvCell`/`escapeField`); test.
- [ ] TDD: CSV `=HYPERLINK(...)` bio prefix-guarded; scraped fields HTML-escaped in PDF HTML; each export writes a SHA-256 sidecar; **synthetic/demo records excluded from exports**. Commit.

### Task 12: Demo data with honesty markers
**Files:** `src/main/x-listening/demo.ts` (adapt Enterprise `loadDemoData`); test.
**Produces:** demo posts AND relationships all carry `synthetic:true`/`source:'demo'`, **enforced-excluded** from `computeNetworkAnalysis`, exports, and evidence hashing. Renderer shows a persistent DEMO banner.
- [ ] TDD: demo relationships marked synthetic; excluded from analysis + exports + hashing. Commit.

---

## PHASE 3 — Renderer rebuild + retire old module

### Task 13: XListeningModule shell (campaign dock, session/Tor/clearnet/demo markers)
**Files:** rewrite `src/renderer/modules/x-listening/XListeningModule.tsx` shell + `x-listening.css`; test.
**Produces:** case-scoped module (campaign from `spec.props`); header with campaign dock (self-managed), the X-session box, the **Tor state + clearnet toggle (one-time real-IP ack) + CLEARNET/DEMO markers**. Reuse app toolbar/list/dialog conventions.
- [ ] TDD: renders; clearnet toggle triggers the ack; markers show. Commit.

### Task 14: Tabs — dashboard / live / sources / network / entities
**Files:** `XListeningModule.tsx` panels; test.
- [ ] TDD: live shows captured posts; network shows the analysis graph; entities list; each wired to real IPC (no hollow UI). Commit.

### Task 15: Tabs — changes / search / notes / exports / campaigns / system + full seam
**Files:** `XListeningModule.tsx` panels; test. Retire `panels/NotesPanel.tsx` if superseded.
- [ ] TDD: every remaining tab wired to its IPC channel; a whole-module seam test asserts no channel is unreachable. Commit.

### Task 16: Retire the old backend + verify registration
**Files:** delete legacy `src/main/x-listening/{old paths}` fully superseded; confirm `registerModule(key:'x-listening-station', …)` (`register-builtins.tsx:284`) points at the rebuilt module; drop any now-unused imports; `pnpm typecheck` + full suite.
- [ ] Verify: no dangling refs; suite green; the old 12-channel surface fully replaced. Commit.

---

## PHASE 4 — WS2 custom bootscreen

### Task 17: bootSplashImage setting + pickBootSplash IPC
**Files:** `src/shared/types.ts` (`AppSettings.bootSplashImage:string|null` default null), `src/shared/ipc-contracts.ts` (`settings:pickBootSplash`), `src/main/ipc/register.ts` (clone `pickWallpaper@590` into a shared `pickImageDataUri` helper + the new handler), preload `index.ts`+`api.d.ts`; test `test/bootsplash-setting.test.ts`.
- [ ] TDD: `bootSplashImage` survives a settings upgrade (old settings.json → default null appears); `pickBootSplash` caps 8 MB + rejects non-image. Commit.

### Task 18: Settings UI + Splash/Lock use the custom image
**Files:** `src/renderer/modules/settings/SettingsModule.tsx` (Choose…/Clear row mirroring the wallpaper row), `src/renderer/shell/SplashScreen.tsx` (`settings.bootSplashImage || splash`), `src/renderer/shell/LockScreen.tsx` (add `useSettings`, same); test.
- [ ] TDD: splash/lock use the custom image when set, fall back to `boot-splash.jpg` when null; Clear resets. Commit.

---

## Self-Review (author)
- **Spec coverage:** every feature-list item (monitoring/archive/network/analysis/entities/evidence/media/campaigns/presets/notes/exports/demo) has a task; Tor posture (T3), honesty fixes (T2 metrics-in-hash, T11/T12 demo-excluded, T4 metricsRaw), encrypt-at-rest (T1/T9), no-remote-media (T9), campaigns-remove-case-requirement (T5), bootscreen (T17-18). ✓
- **Phasing:** P1 foundation → P2 features (depend on P1 stores/pures) → P3 renderer (depends on P1/P2 IPC) → P4 bootscreen (independent). Run as staged ultracode workflows; adjudicate between phases; whole-branch adversarial review before merge.
- **Retirement is LAST (T16)** so the new backend is proven before the old is deleted.
- **Security:** most of the review checklist is satisfied by the seams (createCaptureWindow, remoteMediaToDataUri, csvCell, secure-fs, assertTrustedSender); the explicit fixes are the honesty (T2/T4/T11/T12) + Tor (T3) tasks. The whole-branch review must re-verify the leak-close + honesty invariants.
