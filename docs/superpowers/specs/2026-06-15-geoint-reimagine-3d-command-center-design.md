# DCS98 GeoINT Reimagine — 3D globe + command-center + EyeSpy unlimited (design)

**Source:** GhostExodus concept batch (2026-06-15) + operator decisions same day.
**Companion spec (data layers):** `docs/superpowers/specs/2026-06-15-geoint-threat-map-design.md` — the feed parsers / gating / ACLED gate / KEV sidebar. That spec's data half is engine-independent and is incorporated by reference; this spec covers the engine, the command-center UI, the blip restyle, and EyeSpy unlimited cams.
**Prior-art:** `~/.claude/research-wiki/prior-art/geoint-threatmap-feeds.md` (+ gdeltcloud.com assessed 2026-06-15: third-party commercial GDELT reseller, key-gated, country/admin1 granularity).
**Status:** Draft for operator review. Part of the single combined release on `feat/beta10-shell-bgmail-ui` (beta.10 batch + EyeSpy refresh already implemented).

---

## Operator decisions (2026-06-15)

- **Engine:** **MapLibre GL JS**, **globe (3D) projection by default**, with a **user toggle to a flat view**. Flat is delivered as MapLibre's flat/mercator projection (same tiles, one engine) — NOT a second map library. (Retaining the *legacy Leaflet* as the flat mode is the higher-maintenance alternative; flagged for the operator, default is MapLibre-handles-both.)
- **Tiles/terrain:** reuse the gated raster tiles GeoINT already fetches (Google `mt0`, Esri `arcgisonline` satellite/labels — `GeoIntModule.tsx:31/36/43/44`) draped over **open elevation/terrain** (e.g. a free terrain-RGB DEM source). **No Google Maps Platform API key, no billing, no new provider.** All behind the existing off-by-default `settings.geoint.networkEnabled` gate.
- **Pin layers:** USGS earthquakes (free), GDACS (free), GDELT official GEO 2.0 (free, **default GDELT source**), GDELT-via-gdeltcloud.com (**optional**, user key), NASA FIRMS (user MAP_KEY), **UCDP (free, keyless, CC BY 4.0 — the DEFAULT conflict-events layer)**, ACLED (user creds + EULA-acceptance gate — **optional** alternative conflict source for weekly recency). Cloudflare Radar **excluded**.
- **CISA KEV:** non-map advisory sidebar.
- **Command-center right rail:** built this release.
- **Blip restyle + EyeSpy unlimited cams:** built this release.
- **Scope:** everything in one combined release.

---

## 1. Engine migration — Leaflet → MapLibre GL

**Goal:** replace the Leaflet map with a MapLibre GL map that defaults to a globe and can toggle to flat, while preserving every existing GeoINT capability.

**What must be preserved (regression budget):** the `GeoItem` → marker pipeline; popups (article link); the offline ~61.7k-city gazetteer geocoder + search→flyTo+search-pin; the timeline scrubber + story-mode playback; corroboration glow; save-event→case; the 2D/Satellite/labels tile choices; the off-by-default network gate.

**Approach:**
- New `src/renderer/modules/geoint/MapGL.tsx` (MapLibre map component) replacing `MapPane.tsx`'s Leaflet internals behind the same props/interface where possible, so `GeoIntModule` wiring changes minimally. Markers become MapLibre markers/symbol layers; popups become MapLibre popups; `flyTo`/`setView` map to MapLibre camera APIs.
- **Projection toggle:** a "Globe / Flat" control. `map.setProjection({type:'globe'})` (default) ⇄ flat mercator. Camera, markers, popups, and layers must behave in both.
- **Tiles:** add the existing raster tile URLs as MapLibre raster sources; **terrain** via a raster-DEM source + `setTerrain` (confirm a free/open terrain-RGB endpoint at plan time — verification debt; if none is acceptably licensed/keyless, ship globe-without-exaggerated-terrain, i.e. a smooth globe, and add terrain later).
- **Marker scale:** MapLibre symbol layers handle thousands of points far better than Leaflet DOM markers — relevant once 5+ live layers are on.

**Risk (stated plainly):** this is a rewrite of the working, feature-rich GeoINT map module (incl. two open PRs touching `MapPane`/`GeoIntModule` — reconcile/rebase those first). The migration is the single largest regression risk in the release. Mitigations: keep `GeoItem`/parsers untouched; port feature-by-feature with the existing behaviors as the spec; manual parity pass (markers, popup link, search-pin, timeline, story-mode) before merge. If MapLibre parity for any one feature proves too costly, escalate rather than silently dropping it.

## 2. Pin layers + layer control

Per the companion data-layer spec, plus two additions. First, **UCDP** is the **default conflict-events layer** (free, keyless, per-point, CC BY 4.0 — redistribution permitted with citation; surfaces the required publication attribution in-UI); **ACLED** becomes an *optional* gated alternative for users wanting its weekly recency. UCDP largely retires the ACLED legal risk for the common case — most users get a clean conflict layer with no EULA gate. Second, the **GDELT layer has two selectable sources** — official GEO 2.0 (default, free, keyless, per-point) and **gdeltcloud.com** (optional, behind the user's own gdeltcloud key; structured Events/Entities; country/admin1 granularity; routes queries through a commercial third party — disclosed in the layer's setup UI). The user-key tier is now: gdeltcloud (optional), FIRMS, ACLED.

A **layer-control panel** (left or in the rail) toggles each layer; keyed/gated layers show a "needs key / needs setup" state and their attribution + (for ACLED/gdeltcloud) a one-line disclosure of the third-party/licence posture.

### Source roster (open & pluggable)

Each layer is a self-contained `fetch+parse → GeoItem[]` module + a toggle + an attribution string — so the roster is **open**: new verified sources slot in as drop-in layer modules without touching the engine. Confirmed roster (tiers; full details + verification debt in the prior-art file):

- **Authoritative pins, free/no-key:** USGS earthquakes (CC0/public domain), GDACS disasters (GeoRSS), **UCDP** conflict events (CC BY 4.0 — default conflict layer, verified/validated, annual + monthly candidate).
- **Live signal (chatter), free/no-key:** GDELT GEO 2.0 (news-mention locations — noisy, labeled).
- **Optional, user-key / third-party (opt-in, disclosed):** NASA FIRMS fires (free MAP_KEY), ACLED conflict (myACLED creds + EULA gate — optional alt to UCDP), gdeltcloud.com (paid GDELT reseller), war-tracker.com (free social-OSINT chatter + AIS maritime — labeled unverified).
- **Humanitarian context (link-out, appname-gated):** ReliefWeb (UN OCHA — country-centroid disaster markers + report links; report bodies NOT redistributed per its licence).
- **Non-map advisory:** CISA KEV sidebar.
- **Excluded:** Cloudflare Radar (aggregate, not points).

**Framing model (GhostExodus):** GDELT = live signal · UCDP = verified conflict validation/history · ReliefWeb = humanitarian context. Every layer surfaces its provenance + an honest authority label (authoritative / chatter / unverified-OSINT) so the user never mistakes social-OSINT for verified data. Because the roster is pluggable, the engine + layer-framework build does NOT block on a final source list — additional feeds are added incrementally as layer modules.

## 3. CISA KEV advisory sidebar

Per the companion spec — a non-map panel/ticker of recent KEV entries (CVE, vendor, product, dateAdded, ransomware flag). No pins.

## 4. Command-center right rail

A right-hand rail of stacked panels (from the concept), each fed by data the app already has — no new external dependencies beyond the layers above:

- **Global Threat View** — a small globe/overview with tabs (Threat Heatmap / Conflict / Cyber / Live Attack / Malware). v1: the tabs filter which pin layers/categories are shown on the main map + a density/heat summary; the mini-globe is a compact camera-linked view or a static accent (decide at plan; keep v1 honest — don't fake live data we don't have).
- **Monitored Situations** — incident clusters / "situation" list derived from the corroboration engine (≥2 sources same place+time → a situation), with counts. Reuses existing corroboration.
- **Visual Imagery** — quick toggles for the existing satellite/thermal/aerial tile choices already in GeoINT (no new providers v1).
- **Breaking News Feed** — categorized headlines from the user's existing RSS/feed sources + GDELT, color-tagged by the existing category classifier (conflict/cyber/protest/disaster/crime/politics). Clicking an item flies the map to its location (reuses geocode + flyTo).

**Honesty constraint:** every panel surfaces data the app genuinely has (the user's feeds, the live layers, the corroboration engine). No panel fabricates a "live" metric we don't actually compute. Panels that would need data we don't have are scoped down to what we do have, and that's stated in-UI.

## 5. Blip + popup restyle

Markers become **categorized colored dots** (the existing conflict/cyber/protest/disaster/crime/politics classifier drives color; severity drives size), and popups become the **clean white box** from the concept: article/title text + an **"open"** link, minimal chrome. Applied uniformly across feed items and threat-layer pins.

## 6. EyeSpy — unlimited cameras

Remove the hard 3×3 = 9 cap. The Wall becomes a **scrollable grid** that grows with the number of cameras: a configurable column count (default 3) with rows added as needed and vertical scroll. The per-tile header/controls, the snapshot `refreshNonce` refresh (just shipped), expand-on-double-click, and clear-slot are preserved. `wall.ts` slot model changes from a fixed-length 9 array to a variable-length list. Confirm the wall persistence/serialization handles variable length.

## 7. Network / charter

- All map tiles, terrain, and layer fetches remain behind `settings.geoint.networkEnabled` (off by default) + SSRF-revalidating `safeFetch`. MapLibre tile/terrain egress is **parity** with today's gated Leaflet egress (same Google/Esri hosts) plus an open terrain host (confirm + add to the gated path).
- New user-key sources (gdeltcloud, FIRMS, ACLED) fetch only with the user's own key, only when enabled; keys for ACLED/gdeltcloud stored in `secretStore` (FIRMS MAP_KEY is low-sensitivity — decide secretStore vs settings at plan).
- No telemetry / no phone-home. Per-source attribution surfaced. Coordinate-integrity (`strictNum`/`inRange`) on every parser. CSP: no `frame-src` broadening (the existing Google Street View embed already has its allowance; MapLibre renders in-canvas, no iframe).

## 8. Testing

- Engine: a render/smoke test of `MapGL` (globe + flat projection mount); marker add/remove; popup content; flyTo. (Map GL is canvas/WebGL — headless coverage is limited; a parity checklist + manual pass covers what unit tests can't.)
- Layers: per-provider parser unit tests with fixtures (incl. gdeltcloud JSON), gating tests (no fetch when networkEnabled false; keyed layers refuse without key/acceptance), coordinate-integrity.
- Rail: the news-feed categorization + click-to-flyTo; the situations derivation from corroboration.
- EyeSpy: variable-length wall (add >9, scroll, persist/restore); existing refresh/expand/clear still work.

## 9. Phased build (one branch, one release)

1. **Engine migration** (MapLibre globe+flat, port existing features to parity) — biggest/riskiest; do first and stabilize.
2. **Pin layers + layer control + KEV sidebar** (the data half) — on the new engine.
3. **Blip restyle** — on the new engine (why it waited).
4. **Command-center rail** — panels fed by layers/feeds/corroboration.
5. **EyeSpy unlimited cams** — independent; can land any time.
6. **Combined red-team (F2)** — local-shell exec surface + all GeoINT egress (tiles, terrain, 6 layer endpoints, gdeltcloud/FIRMS/ACLED keys) + ACLED licence posture + no-leak verification.
7. **Version bump + release notes (F1)** — one combined release.

## 10. Risks

- **MapLibre migration regression** — the dominant risk; mitigated by preserving the data layer and a feature-parity checklist + manual pass. Reconcile the two open `MapPane`/`GeoIntModule` PRs before starting.
- **Terrain source** — no keyless open terrain confirmed yet (verification debt); fallback is a smooth globe without exaggerated terrain.
- **Command-center rail honesty** — scope each panel to data we actually have; no fabricated live metrics.
- **ACLED licence** — operator-accepted, gated, recorded (companion spec).
- **Provider verification debt** — FIRMS CSV columns, ACLED OAuth, GDACS/GDELT/gdeltcloud terms, rate limits — confirm against primary docs before coding each parser.
- **Scope** — this is the largest release the project has attempted; staged build + per-phase review keeps it controllable.
