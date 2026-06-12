# EyeSpy Grid — Country/State/City tree + live tile grid + node-scoped import

**Date:** 2026-06-12
**Status:** Design approved (operator answered the three forking decisions)

## Goal

Turn EyeSpy from a flat stream list + single-pane viewer into a location-organised camera wall:
a left sidebar **Country → State/Region → City** tree with rolled-up camera counts, a **search box**
that filters tree and grid, and a **tile grid** of the selected node's cameras with live (capped) tiles
and an "+ Add feed" tile. Importing a feed list can be **scoped to the selected node**, stamping its
location onto feeds that lack geo.

## Why this is cheap now

The data model already carries the geo it needs and the import pipeline already populates it. This is a
**view-layer build over existing, on-disk data** — no schema change, no migration.

- `CameraStream` (`src/shared/post-mvp-types.ts:105`) already has `country? region? city? lat? lon? source?`.
- `feed-import.ts` already maps geo columns from CSV headers; `streams.ts` `pickGeo()` persists only
  well-formed geo to `streams.json`.
- The only backend change is threading an optional location **stamp** into the existing `streams:import`.

This was the EyeSpy roadmap item parked behind "a stream-corpus pull, with one schema-forethought call
first." That schema call already landed; the corpus is now being pulled (UK 128 / US 256…), so it un-parks.

## Approved decisions

1. **Grid tiles — live, capped + lazy.** Visible tiles stream live; a hard cap of **9 concurrent live
   players**; tiles are lazy-mounted via `IntersectionObserver`. Tiles that are off-screen, or on-screen
   but over the cap, render a static poster placeholder with a "▶ click to play" affordance. Clicking any
   tile opens it large in an overlay viewer. Rationale: London alone is 64 cameras — mounting 64 live
   HLS/MJPEG decoders would choke the app, and worse over Tor.
2. **Import target — into the selected node.** With a tree node selected, "Import here" stamps that node's
   `country/region/city` onto each imported feed **only where the feed itself supplies none** (CSV/JSON geo
   always wins). With no node selected (or the "All" root), import is global (today's behaviour).
3. **Tree depth — Country → State/Region → City, variable depth.** UK feeds sit Country→City (no region
   level rendered when region is absent); US feeds sit Country→State→City. Counts roll up. Streams missing
   country fall into a top-level **"Ungeocoded"** bucket so nothing ever disappears.

## Architecture

Pure logic is separated from React so it is unit-testable headlessly (house style; no live DOM needed).

### New files

- `src/renderer/modules/eyespy/tree.ts` — **pure.** Build/search/count the location hierarchy.
  - `type TreeNode = { key: string; label: string; level: 'country'|'region'|'city'; count: number;
    children: TreeNode[]; streamIds: string[] }` (a node's `streamIds` = every stream at or below it).
  - `buildTree(streams: CameraStream[]): TreeNode[]` — group by `country → region → city`; omit the region
    tier for a stream whose `region` is blank (its city hangs directly under the country); bucket
    country-less streams under a synthetic `Ungeocoded` country node. Deterministic ordering: by label,
    locale-independent (`localeCompare` with a fixed `'en'` + `{ numeric:true }`), `Ungeocoded` always last.
  - `filterTree(nodes: TreeNode[], q: string): TreeNode[]` — prune to branches whose node label OR any
    descendant stream matches `q` (case-insensitive substring over label/city/region/country/url); empty
    `q` returns the input unchanged.
  - `streamsForNode(streams, node)` / `matchStream(stream, q)` helpers.
- `src/renderer/modules/eyespy/LocationTree.tsx` — sidebar. Renders `TreeNode[]`, collapsible rows with a
  per-node count badge, a selected highlight, and a search `<input>` on top. Calls `onSelect(node | null)`.
- `src/renderer/modules/eyespy/CameraGrid.tsx` — tile grid for the selected node's streams.
  - Owns the **live-player budget**: a `Set` of at-most-9 `streamId`s currently allowed to be live, chosen
    from the tiles reported visible by an `IntersectionObserver`, most-recently-visible first.
  - Each `Tile` is live iff `visible && budget.has(id)`, else a poster. An "+ Add feed" tile is the last cell.
  - Clicking a tile → `onExpand(stream)`.
- `src/renderer/modules/eyespy/useLivePlayerBudget.ts` — small hook encapsulating the cap + visibility set
  (kept out of the component for a focused unit test of the eviction logic).

### Changed files

- `src/renderer/modules/eyespy/EyeSpyModule.tsx` — recompose: left = `LocationTree`; right = `CameraGrid`
  (or a large overlay `Viewer` when a tile is expanded). The add/edit **form moves into a small modal/panel**
  toggled by the "+ Add feed" tile and by a tree-row "edit" action; `purge`/global-import stay on a header
  bar. `selected` state changes from "a stream" to "a tree node" + an optional "expanded stream".
- `Viewer` (same file) — **extracted unchanged** for reuse by both the expanded overlay and the live tile.
  A new `poster` boolean prop short-circuits to the static placeholder (no decoder mounted).
- `src/shared/ipc-contracts.ts` — `streams.import` channel unchanged in name; its payload gains an optional
  `stamp`.
- `src/preload/index.ts` + `src/preload/api.d.ts` — `import(stamp?: { country?: string; region?: string;
  city?: string })`.
- `src/main/ipc/register.ts` (`streams:import` handler) — accept `stamp`; pass to `feedToUpsert`.
- `src/main/services/feed-import.ts` — `feedToUpsert(feed, stamp?)` applies stamp fields only where the feed
  lacks them. (CSV/JSON geo wins.) Pure; unit-tested.

## Data flow

1. `EyeSpyModule` loads `streams.list()` → `buildTree` → `LocationTree`.
2. Search text → `filterTree` re-renders the tree and narrows the grid's stream set.
3. Select a node → `CameraGrid` shows `streamsForNode`; `IntersectionObserver` + budget decide which ≤9 go live.
4. "Import here" → `streams.import({ country, region, city })` of the selected node → re-`list()` → re-`buildTree`.
5. Click a tile → overlay `Viewer` (full-kind playback, reusing the existing per-kind logic).

## Error / empty states

- No streams at all → grid shows the "+ Add feed" tile and an empty-tree hint ("Import a feed list or add a stream").
- Node with cameras but a dead URL → existing per-kind `Viewer` behaviour (HLS error, broken `<img>`); a tile
  that errors falls back to its poster with a small "stream error" note. No change to network/permission posture.
- Over-cap tiles are **not** an error — they are intentional posters; a small "9 live · N more — click to play"
  caption sets expectations.

## Charter / security posture (unchanged)

No discovery, scanning, probing, or enumeration is added — the grid only renders URLs the user already
imported or typed. No new network egress, no telemetry. Live tiles use the **same** decoders the single
viewer already uses (hls.js / `<img>` / `<video>`), just more of them under a hard cap. The cap is also a
resource-safety guard (bounded concurrent connections), which matters more when feeds are Tor-routed.

## Testing

Pure logic gets node unit tests (vitest), no live DOM:

- `tree.test.ts` — `buildTree`: UK two-level vs US three-level; rolled-up counts; `Ungeocoded` bucket;
  deterministic ordering. `filterTree`: prunes empties, matches on city/region/country/url, empty-query identity.
- `useLivePlayerBudget.test.ts` — never exceeds 9 live; evicts least-recently-visible first; re-admits on
  re-visibility; deterministic given a fixed visibility sequence.
- `feed-import.test.ts` (extend) — `feedToUpsert` applies the stamp only to geo-less feeds; CSV geo overrides
  the stamp; no stamp ⇒ today's output byte-for-byte.

Manual (operator/GhostExodus on Windows): import an archive into "London", confirm the tree shows
`United Kingdom › London (N)`; select it, confirm ≤9 live tiles + posters; search "dallas" prunes the tree;
click a tile → large viewer.

## Out of scope (explicitly)

Map view (lat/lon are stored but the Leaflet view stays in GeoINT), thumbnail caching/snapshots service,
paid-tier lockdown (separate roadmap item), RTSP in-app playback.
