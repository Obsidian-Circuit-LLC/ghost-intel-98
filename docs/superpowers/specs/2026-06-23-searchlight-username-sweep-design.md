# Searchlight — Username-Sweep OSINT Module — Design

**Date:** 2026-06-23
**Status:** Approved (design); spec under review
**Module key:** `searchlight`

## Goal

Port the standalone "Ghost Intel Username Sweeper" app into Ghost Intel 98 as a
self-contained core module named **Searchlight**: sweep a username across a
large site database, verify/interpret hits, and work the results through a
dashboard, results view, relationship graph, whiteboard, reports, and its own
case system — all under the platform's encrypt-at-rest and Tor-first egress
posture.

## Operator decisions (2026-06-23)

1. **Scope:** Full port as a separate, self-contained module (its own case
   model + all panels), *not* folded into the platform's existing cases/graph.
2. **Persistence:** Through the platform's encrypted vault (secure-fs), never
   plaintext localStorage. Own namespace under `dataRoot()/searchlight/`.
3. **Egress:** **Tor by default**, with a per-sweep clearnet opt-out; both paths
   gated behind a new master network opt-in.
4. **Aesthetic:** Win98 window chrome / toolbar / dialogs, with dark canvases
   for the sweep/graph/whiteboard work areas.
5. **Regex pre-filter:** Dropped entirely (not sandboxed). See Security.
6. **Dependencies:** Exactly one new dependency (`react-rnd`); icons inlined.
7. **Panels:** Keep all panels including the whiteboard.

## Global constraints

- Egress only when `settings.searchlight.networkEnabled === true` (default
  `false`). App-layer enforced in the main process before any probe.
- Tor is the default transport. If the Tor instance is not ready, a Tor sweep
  **fails with a clear error** — it must **never silently fall back to
  clearnet**. Clearnet is only used when the operator explicitly opts a sweep
  out.
- The renderer never performs network I/O. All probing happens in the main
  process behind SSRF/public-host guards.
- `webSecurity` and TLS `rejectUnauthorized` stay **on**. (The upload disabled
  both; we do not replicate that.)
- No untrusted `RegExp` compiled or executed on the main thread.
- No telemetry, no analytics, no phone-home.
- Tests are vitest, `environment: node`. Pure logic lives in
  `src/shared/searchlight/` and is unit-tested. Renderer is verified by
  typecheck + `electron-vite` build + a manual smoke list.

## Architecture

A new core module registered through the existing runtime registry. Unlike the
upload (which fired one IPC round-trip per site from the renderer), the **sweep
executes in the main process**: the renderer issues a single `startSweep` call,
a main-process service owns the concurrency pool and transport, and results
stream back over a push channel — mirroring the GeoINT live-feeds pattern.

```
renderer SweepPanel
  → api.searchlight.startSweep(username, siteIds, { useTor })   (IPC invoke)
  → main: gate check → sweep pool → probe() per site (Tor SOCKS | clearnet)
  → main: webContents.send('searchlight:onResult', SweepResult)  (stream)
  → renderer: store update + UI; on completion → api.searchlight.saveCase(...)
  → main: secureWriteFile under dataRoot()/searchlight/  (encrypted at rest)
```

## Components & files

### Shared (pure, unit-tested) — `src/shared/searchlight/`

- `types.ts` — `MaigretSiteEntry`, `SiteCatalogEntry`, `SweepResult`,
  `SearchJob`, `SearchlightCase`, `GraphNode`, `GraphEdge`, `WhiteboardFile`,
  `WhiteboardNote`. Mirrors the upload's `shared/types.ts`, trimmed to what the
  port uses.
- `sites.ts` —
  - `parseMaigretData(json): MaigretSiteEntry[]` — parse a Maigret-format
    object (bundled DB or imported `data.json`).
  - `buildProbeUrl(username, site): { url, probeUrl }` — `{username}` template
    substitution with `encodeURIComponent`. **No regex pre-filter.**
  - `toCatalog(sites): SiteCatalogEntry[]` — lightweight `{ name, category,
    tags, checkType }` projection for the picker UI.
  - `validateImportedSites(raw): { sites, rejected }` — see Security.
- `interpret.ts` — `interpretResult(site, raw, targetUrl): { found, confidence,
  status }` — lifted from the upload's `interpretResult`, made pure. Adds a
  `status: 'found' | 'not_found' | 'blocked' | 'error' | 'unknown'` so
  Tor-blocked responses (403/429/challenge) are distinguishable from genuine
  not-founds.

### Main — `src/main/searchlight/`

- `site-db.ts` — loads the bundled Maigret DB from an `extraResources` blob
  (read in main; not bundled into the renderer JS), merges validated
  user-imported sites read via secure-fs. Exposes `fullSites()` and
  `catalog()`. Has a `_resetForTest()` hook.
- `probe.ts` — `probe(targetUrl, { fetchBody, headers, useTor }):
  Promise<RawCheckResult>`:
  - HEAD when `fetchBody` is false (status/response_url checks); GET capped at
    64 KB when true (message checks).
  - **Tor path:** dials `127.0.0.1:<socksPort>` reusing the SOCKS-dialing
    mechanism already used by the chat transport (`src/main/chat/transport-tor.ts`).
    The exact accessor for the live SOCKS port is resolved during planning; if
    no Tor SOCKS port is available the call rejects with a `TOR_UNAVAILABLE`
    error.
  - **Clearnet path:** `safeFetch` (SSRF guard + redirect re-validation).
  - Public-host/SSRF guard applied on both paths; private/loopback targets
    rejected.
  - Maps network errors to typed codes (`DNS_ERROR`, `SSL_ERROR`, `TIMEOUT`,
    `CONNECTION_REFUSED`, `CONNECTION_ERROR`, `TOR_UNAVAILABLE`).
- `sweep.ts` — `startSweep(jobId, username, siteIds, { useTor })`,
  concurrency pool (default 8 Tor / 16 clearnet), cooperative
  `cancelSweep(jobId)`, streams each `SweepResult` via
  `webContents.send('searchlight:onResult', payload)` and a terminal
  `searchlight:onSweepDone`. Reads `settings.searchlight.networkEnabled` and
  returns immediately (no probes) when off. Tears down active sweeps on
  renderer reload / window close (main-side lifecycle hooks).
- `store.ts` — `listCases()`, `saveCase()`, `loadCase(id)`, `deleteCase(id)`,
  `exportCase(id)`, `importCase(json)` via `secureWriteFile`/`secureReadFile`
  under `dataRoot()/searchlight/cases/<id>.json` + a `searchlight/index.json`
  manifest. Has a `_resetForTest()` hook.

### IPC

- `src/shared/ipc-contracts.ts` — add a `searchlight` channel group:
  `catalog`, `startSweep`, `cancelSweep`, `importSites`, `listCases`,
  `saveCase`, `loadCase`, `deleteCase`, `exportCase`, `importCase`, and the push
  channels `onResult` / `onSweepDone`.
- `src/main/ipc/register.ts` — `safeHandle(...)` registrations for each,
  network-gated where they egress. Input validation mirrors existing handlers
  (`ensureUuid`, string/shape guards). Imported-site payloads validated via
  `validateImportedSites`.
- `src/preload/index.ts` — `window.api.searchlight.*` methods plus
  `onSweepResult(cb)` / `onSweepDone(cb)` subscriptions (`ipcRenderer.on`,
  returning an unsubscribe).

### Renderer — `src/renderer/modules/searchlight/`

- `SearchlightModule.tsx` — root; Win98 toolbar + tab host
  (Dashboard / Sweep / Graph / Whiteboard / Reports / Cases).
- `store.ts` — in-memory zustand store; persistence flushed through
  `window.api.searchlight.*` to secure-fs (debounced), hydrated on case open.
  **No `persist`-to-localStorage.**
- Panels ported from the upload and reskinned (Win98 chrome, dark canvas):
  `SweepPanel.tsx` (username input, site/category scope, Tor/clearnet toggle,
  progress, live results, filters, CSV export), `GraphView.tsx` (SVG graph,
  drag/zoom/pan, auto-import found results), `Whiteboard.tsx` (react-rnd cards +
  sticky notes, file drop), `ReportsPanel.tsx` (HTML/CSV/JSON/TXT export),
  `CasesPanel.tsx` (create/rename/delete, `.gic` import/export),
  `Dashboard.tsx`.
- Styles scoped under `.sl-*`; dark-canvas CSS variables local to the module.

### Registration (5-point pattern)

- `src/renderer/state/store.ts` — add `'searchlight'` to `ModuleKey`.
- `src/renderer/shell/Icon.tsx` — add a `SearchlightGlyph` in `glyphNodeFor()`.
- `src/renderer/shell/Desktop.tsx` — add `{ module: 'searchlight', label:
  'Searchlight' }` to `desktopShortcutDefaults`.
- `src/renderer/modules/register-builtins.tsx` — add a `SearchlightAdapter`
  and a `registerModule({ key: 'searchlight', title: 'Searchlight', glyph:
  '🔎', component: SearchlightAdapter, builtin: true, defaultWidth: 1100,
  defaultHeight: 720 })`.
- `ModuleHost` needs no change (registry lookup).

### Settings & packaging

- `src/shared/types.ts` — add `searchlight: { networkEnabled: boolean;
  torConcurrency: number; clearnetConcurrency: number }` to `AppSettings`, with
  `networkEnabled: false` default (and sane concurrency defaults).
- `package.json` — add the Maigret DB to `build.extraResources` (e.g.
  `resources/searchlight` → `searchlight`); add the `react-rnd` dependency.

## Data flow & error handling

- Per-probe failures are isolated; one failed/blocked site never aborts the
  sweep. Errors classify into the typed set above; `interpretResult` maps them
  to `status`.
- `cancelSweep` is cooperative: the pool stops scheduling and marks the job
  `cancelled` once in-flight probes drain.
- Vault-locked state is handled by the existing `safeHandle` gate (storage IPC
  throws `EVAULTLOCKED`).
- Gate-off `startSweep` returns a no-op result and emits no probes.
- Tor-not-ready on a Tor sweep surfaces `TOR_UNAVAILABLE` to the UI; the sweep
  does not silently downgrade to clearnet.

## Security

- **Dropped regex pre-filter.** The upload compiled each site's `regexCheck`
  (and any imported `data.json`'s) via `new RegExp(...)` to pre-filter
  usernames. That executes attacker-influenced patterns on the event loop
  (ReDoS → app freeze). We remove the pre-filter entirely; every selected site
  is simply probed. (Minor extra probes; large safety win.)
- **`validateImportedSites`** rejects entries lacking an `https` URL containing
  `{username}`, type-checks fields, caps total sites (e.g. 5000), and strips
  unknown keys. Imported sites are stored encrypted via secure-fs.
- Renderer performs no network I/O; `webSecurity`/`rejectUnauthorized` stay on.
- SSRF/public-host guard on both transports; loopback/private targets rejected
  even via Tor.
- No secrets required for the sweep (no API key). The `secretStore` is not used
  by v1.

## Dependencies

- **Add:** `react-rnd` (whiteboard drag/resize).
- **Replace from upload:** `uuid` → `crypto.randomUUID`; `electron-store` →
  secure-fs; `framer-motion` → CSS transitions; `jspdf` + `jszip` → keep
  HTML/CSV/JSON/TXT reports; `react-router-dom` → internal tab state.
- **Reuse existing:** `papaparse`, `mammoth`.
- Icons inlined as SVG (no `lucide-react`).

## Testing

- `test/searchlight-interpret.test.ts` — every `checkType`, presence/absence
  strings, confidence, and `blocked`/`error`/`unknown` classification.
- `test/searchlight-sites.test.ts` — `parseMaigretData`, `buildProbeUrl`
  (encoding, template), `toCatalog`, and `validateImportedSites` including
  rejection of a malicious `data.json` (no `{username}`, non-https, oversized,
  junk fields).
- `test/searchlight-egress.test.ts` — no network when `networkEnabled` is
  false; Tor-vs-clearnet dispatch selection; `TOR_UNAVAILABLE` does not fall
  back to clearnet; cancel mid-sweep stops scheduling.
- `test/searchlight-store.test.ts` — encrypted case round-trip through a mocked
  secure-fs (mirrors `geoint-sources` / `secrets-vault-layer` test style).
- Renderer: `pnpm typecheck` + `electron-vite` build clean; manual smoke —
  run a small sweep (Tor + clearnet), confirm results stream + filter, push a
  found result to the graph, drop a file on the whiteboard, export each report
  format, save/load/export/import a `.gic` case.

## Phasing (one plan, sequential tasks)

1. Shared pure modules (`types`, `sites`, `interpret`) + tests.
2. Main `site-db` + `probe` (Tor/clearnet) + `sweep` + egress tests.
3. Main `store` (encrypted cases) + tests; IPC contracts + handlers + preload.
4. Renderer module scaffold + registration (5-point) + settings + Sweep panel.
5. Graph panel.
6. Whiteboard panel.
7. Reports + Cases panels; Dashboard; packaging (extraResources, dep); polish.

## Out of scope (v1)

- API-keyed sites / `secretStore` usage.
- Auto-reconnect or scheduled/recurring sweeps.
- Cross-linking Searchlight cases into the platform's core case system (the two
  case systems remain independent by decision 1).
