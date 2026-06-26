# Searchlight / GeoINT / EyeSpy Refinements (Batch 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Ship the 8-item v3.21.0 dogfooding batch — Searchlight readability/naming, dep-free PDF export, GeoINT monitor remove button, a GeoINT Settings pane surfacing the AIS key, ADS-B backoff, and full Tor routing for CCTV viewing.

**Architecture:** Electron 33 / React 18 / TS strict / vitest (node env). Main process owns all gated egress; renderer streams over IPC. Pure logic is unit-tested; renderer glue is typecheck + build + manual smoke. `@shared/*` and `@main/*` aliases.

**Tech Stack:** Electron built-ins (`BrowserWindow.printToPDF`, `session.setProxy`, `<webview>` partitions), `hls.js`, `ws`. No new dependencies.

## Global Constraints

- Version `3.21.0`. No new npm deps. Commit trailers on every commit:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF`.
- Tor SOCKS port via `getBgTor()?.isBootstrapped() ? .socksPort() : null`; `null` ⇒ **refuse to load**, never clearnet fallback.
- AIS key stays in encrypted `secretStore` (`geoint.ais.key`); never logged/plaintext.
- Renderer makes no direct gated-feed network calls. No telemetry.
- Report BLOCKED rather than improvise; run each task's verify commands; commit per task.

---

### Task 1: Searchlight readability + naming

**Files:**
- Modify: `src/renderer/modules/searchlight/searchlight.css` (`.sl-sweep-toolbar` ~93, `.sl-sweep-input` ~114, `.sl-sweep-search` ~301)
- Modify: `src/renderer/modules/searchlight/panels/Dashboard.tsx:54-57`
- Modify: `src/renderer/modules/searchlight/panels/ReportsPanel.tsx` (HTML `<h1>` :71, TXT banner :133, JSON `tool` :113)
- Modify: `src/renderer/modules/searchlight/panels/SweepPanel.tsx:405` (button label + `title` :403)

**Interfaces:** Produces no new symbols — string/CSS only.

- [ ] **Step 1:** In `searchlight.css`, raise toolbar/input contrast on the midnight canvas: keep `.sl-sweep-toolbar` dark but make its input region unambiguously dark-purple (e.g. `background:#0e0a1a`), and bump the username input + result-filter search text contrast — set `.sl-sweep-input` `color:#d8c8ff` (was `#00e5ff`) on `background:#0a0814`, and `.sl-sweep-search` `color:#d8c8ff` `background:#0a0814` with a `::placeholder { color:#7a6aa0 }` rule for both. Border accents `#5d3a7d` (midnight-purple), focus `#7d5aad`.
- [ ] **Step 2:** `Dashboard.tsx:54-57` — replace the title node so it renders `SEARCHLIGHT` (drop "GHOST INTEL"; keep the `sl-dash-title-accent` styling on the word or restyle as a single accented word). Keep the `// INTELLIGENCE PLATFORM` eyebrow.
- [ ] **Step 3:** `ReportsPanel.tsx` — replace `GHOST INTEL USERNAME SWEEPER` in the HTML `<h1>` (:71) and the TXT banner (:133) with `SEARCHLIGHT`; change the JSON `tool` field (:113) from `'Ghost Intel Username Sweeper'` to `'Searchlight'`. Leave the `<title>`/filename `ghost_intel_` prefix as-is (back-compat for existing report filenames).
- [ ] **Step 4:** `SweepPanel.tsx:405` — button text `LOAD MAIGRET DB` → `LOAD CUSTOM DB`; update its `title` (:403) to `Import a custom data.json to extend the site catalog`.
- [ ] **Step 5:** Run `pnpm typecheck`. Expected: clean.
- [ ] **Step 6:** Commit `feat(searchlight): midnight-purple readability + Searchlight naming + Load Custom DB`.

---

### Task 2: PDF report export (dep-free)

**Files:**
- Create: `src/main/searchlight/export-pdf.ts`
- Modify: `src/main/ipc/register.ts` (register `searchlight:exportPdf`)
- Modify: `src/shared/ipc-contracts.ts` (channel const + signature)
- Modify: `src/preload/*` searchlight bridge (add `exportPdf`)
- Modify: `src/renderer/modules/searchlight/panels/ReportsPanel.tsx` (5th export button)
- Test: `test/searchlight-pdf.test.ts`

**Interfaces:**
- Produces: `exportSweepPdf(html: string, suggestedName: string): Promise<{ ok: boolean }>` (main); `sanitizePdfFilename(name: string): string` (pure, exported for test). IPC channel `searchlight:exportPdf` with arg `{ html: string; filename: string }`.

- [ ] **Step 1 (test first):** `test/searchlight-pdf.test.ts` — assert `sanitizePdfFilename('a/b\\c:*?.pdf')` strips path/illegal chars to a safe `*.pdf` basename; assert it always ends in `.pdf` and is non-empty.
- [ ] **Step 2:** Run the test → FAIL (module missing).
- [ ] **Step 3:** Create `export-pdf.ts`:
  - `sanitizePdfFilename(name)` — strip `[\\/:*?"<>|]` and control chars, collapse whitespace, default to `searchlight-report`, ensure single `.pdf` suffix.
  - `exportSweepPdf(html, suggestedName)` — create a hidden `BrowserWindow({ show:false, webPreferences:{ sandbox:true, nodeIntegration:false, contextIsolation:true, javascript:false } })`; `await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))`; `const buf = await win.webContents.printToPDF({ printBackground:true })`; `win.destroy()`; `dialog.showSaveDialog({ defaultPath: sanitizePdfFilename(suggestedName) })`; if not cancelled, `await fs.promises.writeFile(filePath, buf)`; return `{ ok:true }` (or `{ ok:false }` on cancel). Wrap in try/finally so the window is always destroyed.
- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5:** Wire IPC: add `exportPdf: 'searchlight:exportPdf'` to the searchlight channels in `ipc-contracts.ts` with type `(a:{html:string;filename:string}) => Promise<{ok:boolean}>`; `safeHandle(channels.searchlight.exportPdf, (...a) => exportSweepPdf(a[0].html, a[0].filename))` in `register.ts`; expose `exportPdf` in the preload searchlight bridge.
- [ ] **Step 6:** `ReportsPanel.tsx` — add a 5th entry to the export grid array: `{ format:'pdf', label:'PDF REPORT', icon:'⎙', desc:'Printable document' }`; extend the `exportAs` union and `map` so `pdf` builds `generateHTML(name, allResults)` and calls `await window.api.searchlight.exportPdf({ html, filename: \`searchlight_${slug}_${ts}.pdf\` })` instead of `blobDownload`.
- [ ] **Step 7:** Run `pnpm typecheck` + the new test. Expected: clean/PASS.
- [ ] **Step 8:** Commit `feat(searchlight): dep-free PDF report export via printToPDF`.

---

### Task 3: GeoINT monitored-situations remove button

**Files:**
- Modify: `src/renderer/modules/geoint/CommandRail.tsx` (monitored list render ~188-209)

**Interfaces:**
- Consumes: existing `removeMonitor(id: string)` passed into CommandRail from `GeoIntModule.tsx` (already wired to `window.api.geoint.removeMonitor`). Confirm the prop name in CommandRail's props; if `removeMonitor` is not already a prop, thread it through from `GeoIntModule.tsx` alongside the existing pin/unpin props.

- [ ] **Step 1:** In the monitored-situations `<li>` render, add a small trailing `<button className="..." title="Remove from monitor" onClick={() => removeMonitor(item.id)}>×</button>` styled to match the rail's existing small-button look (reuse an existing close/× class if present, e.g. the feed-row `×` styling).
- [ ] **Step 2:** Ensure removing the last item leaves the empty-state copy intact (no crash on empty list).
- [ ] **Step 3:** Run `pnpm typecheck`. Expected: clean.
- [ ] **Step 4:** Commit `feat(geoint): per-row remove button in Monitored Situations`.

---

### Task 4: GeoINT Settings pane + AIS key field

**Files:**
- Modify: `src/renderer/modules/settings/SettingsModule.tsx` (SectionKey :17, SECTIONS :25-38, pane router ~107-120, new `GeoINTPane`)

**Interfaces:**
- Produces: `GeoINTPane({ s, patch })` following `SearchlightPane`'s signature. Consumes existing IPC `window.api.geoint.setLayerKey(id,key)` / `window.api.geoint.hasLayerKey(id)`.

- [ ] **Step 1:** Add `'geoint'` to the `SectionKey` union and a `{ key:'geoint', label:'GeoINT', glyph:'🌍' }` entry to `SECTIONS` (place after `'searchlight'` or grouped sensibly).
- [ ] **Step 2:** Add `{section === 'geoint' && <GeoINTPane s={s} patch={patch} />}` to the pane router.
- [ ] **Step 3:** Implement `GeoINTPane`:
  - A `<fieldset><legend>GeoINT</legend>` block.
  - **AIS key:** local state `aisKeyDraft`, `hasKey` (load via `useEffect`→`window.api.geoint.hasLayerKey('ais')`). A `type="password"` input + **Save** button calling `await window.api.geoint.setLayerKey('ais', aisKeyDraft.trim())` then re-checking `hasLayerKey`; show `✓ key stored` when present. Helper copy: "AISStream.io key for the Live Ships feed. Stored encrypted; never leaves this machine. The ADS-B aircraft feed needs no key."
  - Leave room (comment marker `{/* CCTV-over-Tor toggle added in Task 6 */}`) so Task 6 drops its toggle into this pane.
- [ ] **Step 4:** Run `pnpm typecheck`. Expected: clean.
- [ ] **Step 5:** Commit `feat(settings): GeoINT pane surfacing the AIS API key`.

---

### Task 5: ADS-B backoff + readable status

**Files:**
- Modify: `src/main/services/livefeeds/adsb.ts`
- Create: `src/shared/livefeeds/adsbBackoff.ts` (pure)
- Modify: renderer ADS-B status surface (find the `fetchAdsb` caller/error handler — `LiveFeedsPanel.tsx` or the GeoINT module warning toast) to map the typed error to readable copy.
- Test: `test/adsb-backoff.test.ts`

**Interfaces:**
- Produces: `backoffDelaysMs(): number[]` → `[500, 1500, 4000]` (exported, pure); `classifyAdsbError(status: number): 'rate-limited' | 'unavailable'` (429 → `'rate-limited'`, else `'unavailable'`); error class/shape `AdsbError extends Error { kind: 'rate-limited' | 'unavailable'; status: number }`.

- [ ] **Step 1 (test first):** `test/adsb-backoff.test.ts` — assert `backoffDelaysMs()` is a fixed ascending array; `classifyAdsbError(429)==='rate-limited'`; `classifyAdsbError(503)==='unavailable'`.
- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3:** Create `adsbBackoff.ts` with the two pure functions + the `AdsbError` shape.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** In `adsb.ts`, wrap the `safeFetch` in a retry loop: for each delay in `backoffDelaysMs()`, if `res.ok` return parsed; if `res.status` is retryable (429 or ≥500) wait the delay (`await new Promise(r=>setTimeout(r,d))`) and retry; on final failure throw `new AdsbError(classifyAdsbError(res.status), res.status)`. Preserve `networkEnabled` gate, host pin, `safeFetch`, `readTextCapped`.
- [ ] **Step 6:** In the renderer ADS-B error surface, map an `AdsbError`/message containing the kind to a readable status: rate-limited → "ADS-B rate-limited — retrying", unavailable → "ADS-B feed unavailable". Replace the raw `Error invoking remote method … HTTP 429` warning text. (The IPC error surfaces as a string message; match on `'rate-limited'`/`'429'` if the typed kind isn't preserved across the bridge.)
- [ ] **Step 7:** Run `pnpm typecheck` + the new test + `pnpm test`. Expected: clean/PASS.
- [ ] **Step 8:** Commit `feat(geoint): ADS-B retry-with-backoff + readable rate-limit status`.

---

### Task 6: CCTV-over-Tor — setting, helpers, toggle

**Files:**
- Modify: `src/shared/types.ts:403-419` (add `cctvOverTor` to `geoint` block) and the geoint **defaults** (~:573 — set `cctvOverTor:false`)
- Create: `src/shared/cctv/tor.ts` (pure helpers)
- Modify: `src/renderer/modules/settings/SettingsModule.tsx` `GeoINTPane` (add the toggle at the Task-4 marker)
- Test: `test/cctv-tor.test.ts`

**Interfaces:**
- Produces: `torProxyRules(port: number): string` → `socks5://127.0.0.1:${port}`; `resolveCctvSession(o: { enabled: boolean; torPort: number | null }): { ok: true; partition: 'persist:cctv-tor'; proxyRules: string } | { ok: false; reason: 'DISABLED' | 'TOR_UNAVAILABLE' }`; `cctvPlayerUrl(o: { kind: string; url: string }): string` (builds an internal player URL with `encodeURIComponent` on `url` and a whitelisted `kind`). These are consumed by Tasks 7 and 8.

- [ ] **Step 1 (test first):** `test/cctv-tor.test.ts` — `torProxyRules(9050)==='socks5://127.0.0.1:9050'`; `resolveCctvSession({enabled:false,torPort:9050}).ok===false` with reason `'DISABLED'`; `resolveCctvSession({enabled:true,torPort:null})` → `reason:'TOR_UNAVAILABLE'`; `resolveCctvSession({enabled:true,torPort:9050})` → `ok:true, partition:'persist:cctv-tor'`; `cctvPlayerUrl({kind:'hls',url:'https://h/a?b=c&d'})` encodes the url and rejects an unknown kind (throws or coerces to `'http'`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Create `src/shared/cctv/tor.ts` with the three pure functions. Whitelist `kind ∈ {hls,http,mjpeg,mp4}` for the player; `webpage`/`youtube` are handled outside the player by Task 8.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Add `cctvOverTor: boolean` to the `geoint` settings type with a doc comment, and `cctvOverTor:false` to the defaults object.
- [ ] **Step 6:** In `GeoINTPane`, at the Task-4 marker, add a labelled checkbox bound to `s.geoint.cctvOverTor` via `patch({ geoint: { ...s.geoint, cctvOverTor: e.target.checked } })`, with copy: "Route CCTV streams through Tor (off by default). When on, a camera that can't be reached over Tor will not load rather than expose your IP. Live video over Tor may be slow."
- [ ] **Step 7:** Run `pnpm typecheck` + `pnpm test`. Expected: clean/PASS.
- [ ] **Step 8:** Commit `feat(geoint): cctvOverTor setting + pure Tor-session helpers`.

---

### Task 7: CCTV-over-Tor — main session proxy + internal player + IPC

**Files:**
- Create: `src/main/geoint/cctv-tor.ts` (applies the partition proxy)
- Create: `resources/cctv-player/player.html` (bundled internal player; reads `?kind=&url=` from its own query string, runs hls.js/img/video, isolated partition, restrictive self-CSP)
- Modify: `src/main/ipc/register.ts` (IPC `geoint:cctvTorStatus` → returns `resolveCctvSession({enabled, torPort})` result after applying proxy; reuse `searchlightSocksPort`)
- Modify: `src/shared/ipc-contracts.ts` (channel + signature)
- Modify: preload geoint bridge (`cctvTorStatus`)
- Modify: `electron-builder` `extraResources` (ensure `resources/cctv-player/**` ships)

**Interfaces:**
- Consumes: `resolveCctvSession`, `torProxyRules` from `@shared/cctv/tor`; `searchlightSocksPort()`.
- Produces: `applyCctvTorProxy(enabled: boolean): Promise<{ ok: boolean; reason?: 'DISABLED'|'TOR_UNAVAILABLE' }>` — on `ok`, has called `session.fromPartition('persist:cctv-tor').setProxy({ proxyRules })`; IPC `geoint:cctvTorStatus` returns the same shape. The renderer calls this before mounting a Tor webview.

- [ ] **Step 1:** Create `cctv-tor.ts`: `applyCctvTorProxy(enabled)` reads `settingsStore` for `cctvOverTor` (or trusts the `enabled` arg = setting), gets `searchlightSocksPort()`, calls `resolveCctvSession({enabled, torPort})`; if `ok`, `await session.fromPartition('persist:cctv-tor').setProxy({ proxyRules: r.proxyRules })` and return `{ok:true}`; else return `{ok:false, reason}`. When disabled, also clear the partition proxy (`setProxy({ proxyRules:'direct://' })`) defensively.
- [ ] **Step 2:** Create `resources/cctv-player/player.html` — a standalone doc: parse `location.search` for `kind` + `url` (decode once); guard `url` must be `https?://`; render hls.js (bundled copy referenced locally or via a tiny inlined loader — NO external CDN), `<img>`, or `<video>` per kind; set a `<meta http-equiv="Content-Security-Policy">` allowing `media-src/img-src/connect-src https: http:` but `script-src 'self'` and `default-src 'none'`. No IPC, no node. (If inlining hls.js is impractical, copy the existing `node_modules/hls.js/dist/hls.min.js` into `resources/cctv-player/` at build and reference it relatively.)
- [ ] **Step 3:** Register IPC `geoint:cctvTorStatus` → `applyCctvTorProxy(a[0].enabled)`; add channel const + signature; expose in preload.
- [ ] **Step 4:** Add `resources/cctv-player` to electron-builder `extraResources` (and confirm it's reachable from the renderer as a `file://` or app-resource URL the webview can load).
- [ ] **Step 5:** Run `pnpm typecheck`. Expected: clean. (Proxy/webview behaviour is smoke-verified.)
- [ ] **Step 6:** Commit `feat(geoint): main-side Tor session proxy + bundled CCTV player + IPC`.

---

### Task 8: CCTV-over-Tor — EyeSpy Viewer Tor branch

**Files:**
- Modify: `src/renderer/modules/eyespy/Viewer.tsx`

**Interfaces:**
- Consumes: `window.api.geoint.cctvTorStatus({enabled})`; `cctvPlayerUrl` from `@shared/cctv/tor`; the `geoint.cctvOverTor` setting via `useSettings`.

- [ ] **Step 1:** In `Viewer`, read `cctvOverTor` from settings. When **off**, keep the entire existing render path unchanged.
- [ ] **Step 2:** When **on** (and not a `poster`): on mount, `await window.api.geoint.cctvTorStatus({ enabled:true })`. If `!ok`, render a `TOR NOT READY` placeholder (mirror the EyeSpy/Searchlight Tor-unavailable styling) and **do not** load the stream.
- [ ] **Step 3:** When `ok`, render a `<webview partition="persist:cctv-tor" src={...}>` instead of the direct hls.js/img/video. For `kind ∈ {hls,http,mjpeg,mp4}` point `src` at the bundled player (`cctvPlayerUrl({kind, url})` resolved against the app-resource path for `resources/cctv-player/player.html`). For `kind:'webpage'` point the webview directly at `stream.url` (it inherits the Tor-proxied partition). For `kind:'youtube'` keep the existing nocookie-iframe path but note it is **not** Tor-routed (document this limitation in a comment; YouTube embeds can't share the partition) — when `cctvOverTor` is on, prefer showing the `TOR NOT READY`/"not Tor-routable" note for youtube rather than silently going clearnet.
- [ ] **Step 4:** Ensure cleanup: unmount/teardown destroys the webview; toggling the setting off restores the direct path.
- [ ] **Step 5:** Run `pnpm typecheck` + `pnpm test` (full). Expected: clean/PASS.
- [ ] **Step 6:** Commit `feat(eyespy): route CCTV viewing through Tor-proxied webview when enabled`.

---

### Task 9: Version + docs (no merge/publish)

**Files:**
- Modify: `package.json` (`3.20.0` → `3.21.0`)
- Create: `RELEASE_NOTES_v3.21.0.md`
- Modify: `README.md` (Status entry, version strings, install line, test count)

**Interfaces:** none.

- [ ] **Step 1:** Bump `package.json` version to `3.21.0`.
- [ ] **Step 2:** Draft `RELEASE_NOTES_v3.21.0.md` covering W1–W6 (note: no Maigret change — already bundled; AIS already worked, ADS-B was the failure; CCTV-Tor full-routing + its latency caveat; PDF dep-free). Leave SHA/size placeholders (filled at release time, operator-gated).
- [ ] **Step 3:** Update README Status (new v3.21.0 entry above v3.20.0), version strings, install line, and test count after the suite is green.
- [ ] **Step 4:** Run `pnpm typecheck` + `pnpm test`. Expected: clean/PASS.
- [ ] **Step 5:** Commit `release: v3.21.0 — Searchlight/GeoINT/EyeSpy batch 2 (docs only; merge/publish gated)`.

---

## Self-review notes
- **Spec coverage:** W1→T1, W2→T2, W3→T3, W4→T4, W5→T5, W6→T6/T7/T8, W7→T9. The "bake in Maigret" item is intentionally a no-op (already bundled; smaller re-send rejected) and is documented, not implemented.
- **Dependency order:** T4 creates the GeoINT pane before T6 adds its toggle; T6 defines the pure helpers before T7/T8 consume them. Strictly sequential — never parallelise implementers (shared tree).
- **Type consistency:** `resolveCctvSession` reason strings (`'DISABLED'|'TOR_UNAVAILABLE'`), `partition:'persist:cctv-tor'`, and `AdsbError.kind` (`'rate-limited'|'unavailable'`) are used identically across tasks.
- **Risk:** T7/T8 (CCTV-Tor webview + player) is the largest, least headlessly-testable piece; pure helpers are tested, glue is operator-smoke. Flag for a tuning pass.
