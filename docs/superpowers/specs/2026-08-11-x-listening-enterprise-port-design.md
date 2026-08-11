# X Listening Station Enterprise v3.4.1 Port + Custom Bootscreen — Design

**Date:** 2026-08-11
**Status:** Approved — operator "let's go, full pipeline" (security review GO; Tor posture decided)
**Branch:** `feat/ui-polish-banners-jjlogin` (bundled release; WS1 banners already landed)

## Goal

Replace Ghost Intel 98's current X module wholesale with GhostExodus's **X Listening Station Enterprise v3.4.1** feature set — **rebuilt onto the app's existing hardened seams**, not ported verbatim — and add a **user custom-bootscreen** setting. Ships in one bundled release with the WS1 banner work.

## Guiding principle (from the port map + security review)

Do **NOT** port `electron/main.cjs` / `preload.cjs` / `enterprise.cjs` as-is. Rebuild the *feature set* onto the target's seams. This is what makes the port safe: rebuilding onto the app's hardened primitives satisfies most of the security checklist automatically —

- **Capture windows** → `createCaptureWindow` (`src/main/capture/capture-window.ts`): already nodeIntegration:false / contextIsolation:true / sandbox:true / webviewTag:false, deny-by-default `setWindowOpenHandler`, `will-navigate`+`will-redirect` host-allowlist guard, permission deny, proxy-before-load. (Kills Enterprise's raw `new BrowserWindow`, its missing will-navigate guard, and its CSP-hygiene items — the app's CSP governs, not Enterprise's `index.html`.)
- **Media/avatar fetch** → `remoteMediaToDataUri` (`security.ts`): host-**anchored** allowlist (twimg/x/twitter), returns `data:` never a remote URL. (Kills the Enterprise substring-match SSRF and the remote-`<img>` beacon; the img-src landmine can't exist — the module never emits a raw remote image ref.)
- **CSV** → `csvCell` (`security.ts`): RFC-4180 + formula-injection prefix guard. (Kills the Enterprise CSV `=+-@` injection.)
- **At-rest** → `secure-fs` (`secureReadFile/secureWriteFile/secureReadText`): AES-GCM at rest. (Kills the plaintext `station-state.json` / `evidence-media/` / `avatar-cache/`.)
- **IPC** → `safeHandleWithEvent` + `assertTrustedSender` (`register.ts`): every X handler sender-checks (a capture window can host hostile x.com).
- **External open** → the app's guarded `system.openExternal`; the module uses `shell.openExternal` nowhere.

The **explicit** port-specific work (not auto-satisfied) is: the **Tor posture**, the **honesty fixes** (demo markers, metric precision), the **campaigns→scraping-cases** mapping, and rebuilding the **renderer**.

## Tor posture (operator decision: Tor-default + acked clearnet opt-in)

The ported X module is **Tor-by-default**, routed through the app's single `getBgTor()` engine (NOT Enterprise's bundled `tor.exe`, which is dropped entirely):

- On capture, mirror `src/main/socmint/telegram-hunter/session.ts:44-74`: if `getBgTor()?.isBootstrapped()` is false → return `{ blocked: true }` (fail-closed, **no clearnet fallback while in Tor mode**); else build `socks = 127.0.0.1:${getBgTor().socksPort()}` and pass `createCaptureWindow({ …, proxy: { socks }, webRTCIPHandlingPolicy: 'disable_non_proxied_udp' })`; belt-and-braces re-assert `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` after load.
- **Clearnet opt-in:** a per-module toggle (`AppSettings.xListening.clearnet`, default **false**) lets the operator drop to clearnet — but only behind a **one-time real-IP acknowledgement** (reuse the app's existing clearnet-ack pattern, e.g. `ai-assistant/useClearnetLinkOpener` / the Host-Info clearnet toggle). When clearnet is on, capture passes **no proxy** and the UI shows a persistent "CLEARNET — real IP exposed to X" marker. WebRTC-disable stays applied regardless.
- This supersedes the prior v3.68.0 "X = clearnet quarantine" default. The Enterprise `tor:*` bundled-engine channels are **not** ported.

## Feature set (Enterprise → rebuilt into `x-listening`)

Rebuild these onto `HarvestedItem` (`src/shared/socmint/types.ts`) + per-case artifact sidecars under `scrapingCaseDir('x', id)` (all secure-fs), extending the current `XStore` pattern:

1. **Account monitoring / timeline capture** — visible posts/replies/reposts/comments via `runCapture(win, staticJs)`; normalize each into `HarvestedItem` (id=SHA-256(`x:profileId:statusId`), authorHandle, publishedAt, url via `isXUrl`, provenance.caseId). Enterprise's richer fields (`metrics`, `kind`, `parentPostId`, `evidenceHash`) that don't fit `HarvestedItem` live in a **new `x-posts.json` artifact sidecar** (same secure-fs pattern as `x-notes.json`).
2. **Historical archive building** — resumable low-rate cycles (`archive.nextOperationIndex`/`cyclesCompleted`), stored in the `archiveState` sidecar.
3. **Follower/following network mapping** — `XNetworkArtifact` (target + kind + accounts).
4. **Common-connection detection + collection health** — port `computeNetworkAnalysis` + `deriveCollectionHealth` (`enterprise.cjs`, already pure/no-electron) near-verbatim into a new **`x-listening/analysis.ts`**; derived-on-read, not persisted.
5. **Entity extraction (indicators)** — port `extractEntities` (mention/hashtag/email/url/domain/crypto/phone/org) into `analysis.ts`, derived-on-read.
6. **Evidence preservation** — port `sha256` + `canonicalPostEvidence` + `canonicalRelationshipEvidence` into **`x-listening/evidence.ts`**; keep `evidenceHash` on the post/relationship artifacts + media byte-hashes. **Honesty fix:** fold `metrics` into `canonicalPostEvidence` (Enterprise omits them, so counts could be altered post-collection without invalidating the hash).
7. **Media / avatar caching** — `remoteMediaToDataUri` for fetch; persist bytes via `secureWriteFile` under the case dir; **no remote URL ever stored**.
8. **Multi-campaign / case management** — Enterprise "campaigns" map to **self-managed scraping-case ids under the `x` namespace** (`scrapingCaseDir('x', id)`), NOT the app's core investigation `cases`. The module creates/switches/deletes its own X campaigns internally — **this is what removes the case requirement** (no core case needs to be bound). Per-campaign settings become `AppSettings.xListening.*` + per-case artifact scoping.
9. **Highlight presets / local search, analyst notes** — presets + notes sidecars (extend `XStore`).
10. **Exports (JSON / PDF / CSV)** — reuse the app's `itemsToJson`/`itemsToCsv`/`buildXItemsHtml`/`buildXItemsReport` + `csvCell`/`escapeField`; keep the **SHA-256 sidecar** behaviour on export.
11. **Demo data** — port `loadDemoData`, **honesty fix:** every demo record (posts AND follower/following relationships) gets `synthetic: true` / `source: 'demo'`, **enforced-excluded** from `computeNetworkAnalysis`, all exports, and evidence hashing (Enterprise leaves demo relationships unmarked → they leak into real network intel + hashed exports). A persistent "DEMO DATA LOADED" banner while present.
12. **Metric honesty** — `parseMetricText` ("1.2K"→1200) must **keep the raw string** (`metricsRaw`) alongside/instead of the derived integer, or mark derived counts approximate in schema/export/UI.

## Data model

- **Captured posts** → `HarvestedItem` store (dedup by id) + `x-posts.json` artifact sidecar (richer fields, `evidenceHash`, `metricsRaw`, `synthetic?`).
- **Relationships** → `XNetworkArtifact` sidecar (+ `evidenceHash`, `synthetic?`).
- **Notes / presets / archiveState / entities-cache** → per-case secure-fs sidecars (extend `XStore`).
- No monolithic `station-state.json`. Everything AES-GCM at rest.
- Campaign = an `x`-namespace scraping-case id; the module owns the campaign list.

## IPC + registration

- Expand `channels.xListening` in `src/shared/ipc-contracts.ts` from the current 12 to the needed set (monitoring, archive, network, analysis, entities, notes, presets, exports, campaigns, session, demo, media). Register in `registerXListeningIpc({ handle: safeHandleWithEvent })` at `register.ts:1764`; every handler `assertTrustedSender(e)` first.
- Push events (`state:changed` / `sweep:progress`) map onto the app's existing watcher/push seam (cf. investigation-graph `sendToWatchers`).
- Keep the stable seams: the `channels.xListening` contract block, the `registerXListeningIpc` wiring, the `registerModule(key:'x-listening-station', …)` line (`register-builtins.tsx:284`), and the `XStore` secure-fs sidecar pattern.

## Renderer

Rebuild `src/renderer/modules/x-listening/XListeningModule.tsx` (+ `panels/`) to carry Enterprise's tabs — **dashboard, live, sources, network, entities, changes, search, notes, exports, campaigns, system** — as a **case-scoped embedded module** (gets `caseId`/campaign from `spec.props`; self-manages campaigns). Do NOT port Enterprise's standalone `App()`/sidebar/Tor-box/`main.tsx`. Reuse the app's toolbar/list/dialog conventions. Tor state + the clearnet toggle + the DEMO/CLEARNET markers live in the module header.

## Retirement

Replace wholesale: `src/main/x-listening/{ipc,extract,store}.ts` and `src/renderer/modules/x-listening/{XListeningModule.tsx,panels/,x-listening.css}`. The Enterprise bundled-Tor engine, `station-state.json`, `index.html`/CSP, and standalone renderer are **not** ported.

## Preserve (do not regress — the tool's strengths)

The honesty core (no telemetry/beacon/updater); credential minimalism (auth cookies presence-checked only, never read/logged/transmitted; renderer sees only a boolean `sessionConnected`); the **DOM-scrape capture contract** (static `executeJavaScript`, no scraped-data interpolation — the reason a proxy covers every X byte); the fail-closed Tor discipline; evidence hashing; the conservative not-fabricating-inference discipline (e.g. never auto-labelling a not-seen-this-scan identity as an unfollow).

## WS2 — Custom bootscreen (folded into this release)

Let users set their own boot/login-screen image, mirroring the existing Desktop-background picker:
- `AppSettings.bootSplashImage: string | null` (default null) — a top-level scalar, so `mergeSettings`' base-spread heals old settings automatically (no data-loss trap).
- IPC `settings:pickBootSplash` cloned from `settings:pickWallpaper` (`register.ts:590`): file dialog → 8 MB-capped `data:` URI; factor the shared body into a `pickImageDataUri` helper to avoid duplication.
- Settings UI: a "Boot screen image: Choose… / Clear" row (mirror the wallpaper row).
- `src/renderer/shell/SplashScreen.tsx` (already reads `useSettings`) and `LockScreen.tsx` (add `useSettings`) use `settings.bootSplashImage || boot-splash.jpg`.

## Testing

- **Tor/leak:** capture fails closed when Tor not bootstrapped (Tor mode); `disable_non_proxied_udp` applied; clearnet toggle requires the real-IP ack and shows the marker; a mutation test proving no capture request fires clearnet while in Tor mode.
- **At-rest:** every sidecar + cached media written via secure-fs (no plaintext intel); a test asserting no `fs.writeFile` of intel data.
- **SSRF/media:** media fetch host-anchored (a `…?y=pbs.twimg.com/media` decoy is rejected); no remote URL stored.
- **CSV/export:** `=HYPERLINK(...)` bio is prefix-guarded; SHA-256 sidecar emitted.
- **Honesty:** demo posts AND relationships carry `synthetic:true` and are excluded from analysis/exports/hashing; `metricsRaw` preserved and folded into the evidence hash.
- **Seam:** renderer wires every IPC channel (no hollow UI — the v3.24.2 lesson); campaign create/switch works with no core case bound (case requirement gone).
- **Pure functions:** `computeNetworkAnalysis`/`deriveCollectionHealth`/`extractEntities`/`canonical*Evidence` unit-tested against fixtures.
- **Bootscreen:** `bootSplashImage` survives a settings upgrade; `pickBootSplash` caps 8 MB; splash/lock use the custom image when set, fall back when null.

## Out of scope

Enterprise's bundled `tor.exe` engine; its `main.tsx` standalone shell; its plaintext store; its `index.html`/CSP. No new runtime dependency (react/react-dom already present). No new egress beyond the X capture target (Tor by default).
