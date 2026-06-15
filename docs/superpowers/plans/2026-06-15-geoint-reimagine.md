# GeoINT Reimagine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Phased; engine first, stabilize, then layers/rail. Steps use `- [ ]`.

**Goal:** Migrate GeoINT to a MapLibre GL globe (3D default + flat toggle) and build the threat-layer roster, CISA KEV sidebar, command-center rail, blip restyle, and EyeSpy unlimited cams — one combined release on `feat/beta10-shell-bgmail-ui`.

**Specs:** `docs/superpowers/specs/2026-06-15-geoint-reimagine-3d-command-center-design.md` (+ `-threat-map-design.md` for layer data; ACLED dropped). **Prior-art (endpoints/licences/verification-debt):** `~/.claude/research-wiki/prior-art/geoint-threatmap-feeds.md`.

**Conventions:** branch `feat/beta10-shell-bgmail-ui`; `pnpm typecheck` + `pnpm test` green before each commit; no `--no-verify`; feature commits no `Co-Authored-By`. Charter: every fetch behind `settings.geoint.networkEnabled` + SSRF `safeFetch`; `strictNum`/`inRange` on every parser; honest provenance labels; no telemetry.

**Existing code to preserve (the regression budget — `src/renderer/modules/geoint/`):** `MapPane.tsx` (Leaflet), `GeoIntModule.tsx` (state/wiring, story `STORY_ADVANCE_MS`), `TimelineBar.tsx`, `StoryControls.tsx`, `SaveEventDialog.tsx`, the `GeoItem` shape, the offline gazetteer geocoder, search→flyTo+search-pin, corroboration glow, save-event→case. Two open PRs (#10/#11) touch MapPane/GeoIntModule — reconcile/rebase awareness before heavy edits.

---

## PHASE 1 — Engine migration (R1–R4): do first, stabilize before layering anything on

### Task R1: maplibre-gl dependency + MapGL globe skeleton
**Files:** `package.json`; create `src/renderer/modules/geoint/MapGL.tsx`; `GeoIntModule.tsx` (mount behind a temporary `useMapGL` flag so the Leaflet `MapPane` stays the default until parity).
- [ ] Add `maplibre-gl` (verify a version with **globe projection** support — globe landed in MapLibre GL JS v5.0; use current stable ≥5) to dependencies; import its CSS. Confirm it builds under electron-vite (renderer dep, bundled — not externalized).
- [ ] `MapGL.tsx`: a component that mounts a `maplibre-gl` `Map` into a ref div with `projection: { type: 'globe' }`, an empty raster style placeholder, `attributionControl: true`, world center/zoom. Clean up the map on unmount.
- [ ] Mount `MapGL` in `GeoIntModule` ONLY when a local `useMapGL` boolean is true (default false) so nothing regresses yet; a dev toggle flips it for parity work.
- [ ] Test: a lightweight mount/smoke test (jsdom + a mocked `maplibre-gl` Map — MapGL is WebGL so assert the component mounts and calls `new Map` with globe projection, rather than rendering GL headlessly).
- [ ] Commit: `feat(geoint): add maplibre-gl + MapGL globe skeleton (behind flag)`.

### Task R2: projection toggle + raster tiles + terrain
**Files:** `MapGL.tsx`, `GeoIntModule.tsx` (tile-source wiring already exists: `DEFAULT_TILE_URL` Google, `ESRI_SAT_URL`, labels).
- [ ] Build the MapLibre style with raster sources for the EXISTING gated tiles (Google `mt0` 2D, Esri `World_Imagery` satellite, Esri labels overlays) — same URLs/attribution GeoIntModule already uses; only fetched when `networkEnabled` (style sources added/removed on the gate, mirroring `MapPane.tsx:112`).
- [ ] Projection toggle control: **globe (default) ⇄ flat** via `map.setProjection`. Camera/markers behave in both.
- [ ] Terrain: add a raster-DEM source + `map.setTerrain` IF a keyless/openly-licensed terrain-RGB endpoint is confirmed (verification debt — check at impl time). If none acceptable, ship a smooth globe (no exaggerated terrain) and note it; do NOT add a keyed/paid terrain provider.
- [ ] Test: projection toggle updates state; tile sources are absent when `networkEnabled` is false (gate parity).
- [ ] Commit: `feat(geoint): MapGL globe/flat toggle + gated raster tiles (+terrain if open)`.

### Task R3: port markers / popups / flyTo / search-pin to MapGL
**Files:** `MapGL.tsx` (+ a small marker/popup helper).
- [ ] Render `GeoItem[]` as MapLibre markers (or a symbol layer for scale). Marker color/size from the existing category/severity classifier.
- [ ] Popup = the clean white box (title + an **"open"** link) — the restyle target; reuse for all items.
- [ ] `flyTo`/`setView` by id (story/search/focus reuse this), `focusId` opens that marker's popup — parity with `MapPane.tsx` focus effect.
- [ ] Search-pin (PR #10 pattern) + the offline geocoder integration unchanged (geocoder is engine-independent; only the pin render moves to MapGL).
- [ ] Test: marker add/remove from a GeoItem list; focusId opens the right popup; flyTo called with the item's coords (mock the Map).
- [ ] Commit: `feat(geoint): port markers/popups/flyTo/search-pin to MapGL`.

### Task R4: port timeline + story-mode + corroboration; retire Leaflet
**Files:** `GeoIntModule.tsx`, `MapGL.tsx`, delete `MapPane.tsx` once parity verified.
- [ ] Timeline scrubber + 5s story-mode (`STORY_ADVANCE_MS`) drive MapGL camera/focus (the timer logic is engine-independent; only the camera calls change).
- [ ] Corroboration glow on MapGL markers.
- [ ] Flip `useMapGL` to the default; **manual parity pass** (markers, popup link, satellite/labels, search-pin, timeline, story-mode, save-event→case) — checklist in the PR. Remove `MapPane.tsx` (Leaflet) and the `leaflet` dep if nothing else uses it.
- [ ] Test: existing GeoINT suites still green; story/timeline state transitions unit-tested where pure.
- [ ] Commit: `feat(geoint): timeline/story/corroboration on MapGL; retire Leaflet MapPane`.

**Phase-1 gate:** full parity + green tests + a manual smoke pass before Phase 2. If any feature can't reach MapLibre parity affordably, escalate (don't silently drop it).

---

## PHASE 2 — Threat layers + KEV (R5–R8): build on the stabilized engine

### Task R5: pluggable layer framework + USGS (proves the framework)
- Main: `src/main/geoint/threat-layers/usgs.ts` (`fetch(opts) → GeoItem[]`; USGS GeoJSON, **coords `[lon,lat,depth]` — swap**; `strictNum`/`inRange`). IPC `geoint:fetchThreatLayer(layerId, opts)` (gated like existing geoint handlers; layer-id allowlist in `validate.ts`). Renderer: a layer-control panel (toggle + attribution) + render the returned GeoItems as a MapGL layer.
- Tests: USGS parser on a fixture (lon-first, range guard, MAX cap); gate refuses when networkEnabled false; layer-id allowlist.

### Task R6: free pin layers — GDACS, GDELT, UCDP
- `gdacs.ts` (GeoRSS via shared XMLParser; alertlevel→severity), `gdelt.ts` (GEO 2.0 PointData GeoJSON; `category:'chatter'`, labeled), `ucdp.ts` (GED API JSON, CC BY — surface citation attribution). Per-parser fixture tests + gate tests. Confirm each endpoint/fields against prior-art + primary docs first (verification debt).

### Task R7: optional keyed layers — FIRMS, gdeltcloud, war-tracker
- `firms.ts` (CSV, user `MAP_KEY`; confirm columns), `gdeltcloud.ts` (user key; disclose third-party), `war-tracker.ts` (free, `lat`/`lng` confirmed, style by `confidence`, label unverified; attribute via canonical `url`). Settings: `geoint.firmsMapKey`, `geoint.gdeltcloudKey` (secretStore for the paid key). Keyed layers gated in the IPC handler (refuse without key) + "needs key" UI state. Tests: parsers + key-gate refusal.

### Task R8: CISA KEV advisory sidebar
- `kev.ts` (KEV JSON → `KevEntry[]`; no coords). A non-map sidebar/ticker panel (cve/vendor/product/dateAdded/ransomware flag); refresh; click→source. Parser test; assert it never yields map pins.

---

## PHASE 3 — Rail, humanitarian, EyeSpy, restyle (R9–R11 + blip)

### Task R9: command-center right rail
- Panels fed only by data we have: **Global Threat View** (category/layer filter + density summary; compact globe accent), **Monitored Situations** (corroboration clusters), **Visual Imagery** (existing satellite/labels toggles), **Breaking News Feed** (user RSS + GDELT, category-tagged, click→flyTo). No fabricated live metrics; each panel states its data source.

### Task R10: ReliefWeb humanitarian layer
- `reliefweb.ts` (disasters endpoint; country-centroid markers + report **links**, NOT report bodies; appname param — decide operator-registered vs user-supplied appname). Link-out licence honored. Tests + gate.

### Task R11: EyeSpy unlimited cameras
- `wall.ts`: slot model fixed-9 array → variable-length list. `Wall.tsx`: scrollable grid, configurable columns (default 3), rows grow. Preserve refresh (`refreshNonce`), expand, clear. Variable-length persistence round-trip test.

### Blip restyle
- Folded into R3 (popup) + R5/R6 (categorized colored dots by classifier; severity→size). Verify uniform across feed items + threat-layer pins.

---

## PHASE 4 — Combined release (the existing F1/F2 tasks, now covering everything)

### F2 (red-team): local-shell exec surface + ALL GeoINT egress (tiles, terrain, every layer endpoint, FIRMS/gdeltcloud keys, ReliefWeb appname) + no-leak (netns) verification + coordinate-integrity. Fix findings, re-review.
### F1 (release): version bump (decide beta.10 vs a larger bump given the scope), README, combined release notes covering the whole batch + the GeoINT reimagine. Unsigned-installer SHA filled post-build.

---

## Self-review
- **Coverage:** every spec item maps to a task (engine R1–R4; layers R5–R7; KEV R8; rail R9; ReliefWeb R10; EyeSpy R11; restyle in R3/R5/R6; release F1/F2). ACLED intentionally absent (dropped).
- **Placeholders:** Phase-1 tasks are concrete; Phase-2/3 tasks are reference+test-driven (each parser confirmed against prior-art/primary docs at impl — flagged, not fabricated). The exploratory MapLibre porting is specced by "preserve existing behavior X" rather than invented code, deliberately.
- **Risk:** the engine migration is the dominant risk and is gated (parity pass) before anything builds on it. Terrain source is a flagged verification-debt fallback (smooth globe).
