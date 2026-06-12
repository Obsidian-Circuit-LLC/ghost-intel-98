# GeoINT "intelligence map" — wow bundle (design)

**Date:** 2026-06-12
**Status:** Design — for operator review before planning
**Scope:** Five additive enhancements to the *existing* GeoINT module, shippable in the next release
bundle. NOT the full weekend reimagining — these are keepers any redesign would retain (richer data,
smarter markers, time, story). Ideas artifact: `docs/superpowers/ideas/2026-06-12-geoint-wow.md`.

## Goal

Turn GeoINT from a map that drops dots into a **local-first intelligence map**: feeds self-locate,
self-classify by category/severity, brighten when corroborated across sources, can be replayed over time,
and can be briefed as a shareable story. All offline-first, network off by default, no telemetry.

## Why now / what's broken

GeoINT already geocodes RSS/Atom items against a bundled gazetteer (`feeds.ts:locate` → `located:
'gazetteer'`), but the gazetteer (`resources/geoint/gazetteer.json`) is **only 250 country names**. So an
article that names a *city* matches nothing → `located: 'none'` → no marker. This is the tester's "feeds
aren't showing up." Fixing the data fixes the bug **and** is feature #1.

## The five features

### 1. Richer offline gazetteer (auto-geocode that actually works) — DATA + main

- Regenerate `resources/geoint/gazetteer.json` from a real **world cities** dataset (currently
  `scripts/gen-gazetteer.cjs` emits countries only). Target: countries + capitals + **major world cities**
  (~15–25k entries, e.g. GeoNames `cities15000`). The existing longest-name-wins geocoder
  (`geocode.ts:makeGeocoder`) is unchanged — it just has far more to match.
- Keep the per-feed DoS bounds (`MAX_FEED_ITEMS`, `MAX_FIELD`); the geocoder pre-sorts once and the
  per-item sweep stays linear in entries — confirm timing on ~25k entries (still milliseconds per item;
  the regex is built per-entry once at load, not per-item).
- **DATASET DECISION (operator):** GeoNames `cities15000` is **CC-BY 4.0** → permissive but requires
  attribution (DCS98 already attributes OSM/Esri, so add a one-line "Places © GeoNames (CC-BY)" to the
  GeoINT attribution). Alternatives: `cities5000` (~50k, bigger), or a hand-curated permissive set. The
  build script fetches + SHA-pins the source at build time (mirrors `fetch-tor`/`fetch-piper`), and the
  generated JSON is committed/bundled — no runtime fetch. **License must be confirmed before bundling.**
- Disambiguation: when two cities share a name, longest-name-wins doesn't help; pick the **higher-population**
  entry (the dataset carries population). Deterministic. A wrong auto-pin is still correctable via the
  existing manual `setItemLocation` (pick mode) — auto-geocode is best-effort and labelled approximate.

### 2. Severity / category classification → marker color + icon — main + renderer

- Add to `GeoItem` (`src/shared/post-mvp-types.ts`): `category?: string; severity?: 'low' | 'medium' | 'high'`.
- A small **literal-keyword classifier** in main (new `src/main/geoint/classify.ts`), applied during feed
  parse (in `feeds.ts`, after building each item). Default rulesets bundled in code: a handful of
  categories (e.g. `conflict`, `cyber`, `protest`, `disaster`, `crime`, `politics`) each with a literal
  keyword list, and a severity heuristic (high-signal terms → `high`). **Literal substring matching only —
  never `new RegExp` on feed text** (the untrusted-input/ReDoS rule; the gazetteer regex is safe because it
  matches *our* escaped bundled names, not feed-controlled patterns). Items matching nothing → no category
  (neutral marker).
- Renderer (`MapPane.tsx`): replace the single 📍 `divIcon` with a **category-colored** marker (a small
  colored dot/glyph per category) sized/intensified by severity. A legend chip row in the GeoINT left pane.
  Keep it Win98-flat.

### 3. Corroboration "resonance" — renderer (derived, pure)

- A pure function (new `src/renderer/modules/geoint/corroborate.ts`): given the located items, group by
  **spatial proximity** (within R km — haversine; R ≈ 25 km default) **and time window** (within T hours —
  T ≈ 48h default, using `published`), counting **distinct `sourceId`s**. An item corroborated by ≥2
  distinct sources gets a confidence level (`count`).
- Render: corroborated markers get a **ring / halo + brighter** (more sources → brighter); single-source
  stays plain. A tooltip "corroborated by N sources." No schema change (derived each render from the
  snapshot; memoize like the beta.5 `items` fix).
- This is a reusable OSINT primitive (corroboration), computed entirely locally.

### 4. Timeline scrubber — renderer

- A horizontal **time slider** under the map: domain = [min, max] of item `published` (items without a
  date are always shown / pinned to "now"). The map renders only items at/under the scrubber time (or
  within a trailing window). A **play** button animates the scrubber forward (events appear over time).
- Pure renderer state over the existing `items`; feeds the same marker layer (filtered set). Memoized.

### 5. Story-mode playback — renderer

- **Select** a set of events (a corroboration cluster, a category filter, an AOI, or a manual pick) →
  **Play story**: step chronologically through them — `flyTo` each, open its popup (the white box +
  article link), pause ~N seconds, advance. A small controls bar (play / pause / prev / next / speed).
- Reuses the existing `flyTo` recenter + marker popups. v1 is **on-screen playback** (he screen-records to
  share with his mates — the stated use). A "save as case report" export is a later add (out of scope v1).

## Data flow

1. `geoint.refresh()` → `feeds.ts` parses items → **gazetteer-geocodes** (now city-rich) → **classifies**
   (category/severity) → `snapshot()` returns enriched `GeoItem[]`.
2. Renderer builds `items` (memoized), runs **corroboration** (derived), renders category-colored,
   severity-sized, corroboration-haloed markers — filtered by the **timeline scrubber**.
3. **Story mode** sequences a selected subset over the map.

## Data-model changes

- `GeoItem` += `category?: string; severity?: 'low' | 'medium' | 'high'` (back-compat: optional; older
  snapshots without them render neutral).
- No new IPC channels (classification rides the existing `refresh`/`snapshot`; everything else is renderer).

## Charter / security

- **Offline-first:** the bigger gazetteer + the classifier rulesets are **bundled**, no geocoding/classification
  service. Network stays **off by default** (feeds only fetch when `geoint.networkEnabled`).
- **No telemetry, no mass-targeting** — this monitors public feeds the user added.
- **No ReDoS:** the new classifier is literal-substring only. The gazetteer regex matches escaped *bundled*
  names (safe); per-feed work stays bounded by the existing caps.
- **Attribution:** add the cities-dataset attribution (CC-BY) to the GeoINT attribution line.
- **Determinism:** gazetteer longest-name + population tiebreak; corroboration is a pure function with fixed
  R/T; no `Math.random`. (The timeline "play" uses a timer — display only.)

## Testing

- `gen-gazetteer` output: count + schema + a few known cities present + dedupe/population tiebreak.
- `classify.ts` (pure): known headlines → expected category/severity; no-match → undefined; literal-only
  (a feed string with regex metacharacters can't blow up).
- `corroborate.ts` (pure): two sources same place+time → corroborated; same source twice → not; outside
  R/T → not; haversine sanity.
- Timeline filter (pure helper): items ≤ t; undated handling.
- Manual (operator/GhostExodus): enable network, add an RSS source, Refresh → city articles now pin and
  are colored by category; corroborated events glow; scrub the timeline; play a story.

## Out of scope (this bundle)

Geo entity graph, pheromone heat-trails, density topography, anomaly flares, geofence/AOI alerts, the
offline-LLM geo-reasoner, query grammar, story-export-to-case-report — parked for the weekend reimagining
(idea vault in `docs/superpowers/ideas/2026-06-12-geoint-wow.md`).
