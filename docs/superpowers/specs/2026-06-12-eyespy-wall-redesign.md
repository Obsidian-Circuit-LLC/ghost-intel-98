# EyeSpy v2 — finder + curated 3×3 wall (match the concept template)

**Date:** 2026-06-12
**Status:** Design — for GhostExodus/operator review before planning
**Supersedes the relevant UI of:** `2026-06-12-eyespy-grid-design.md` (the beta.3 grid). The tree/search/geo
data layer from that build is kept; the **auto-filling grid is replaced** by a curated wall.

## Why this revision

beta.3 made the right-hand grid **auto-fill with every camera at/below the selected tree node**. Pointing
it at a 500-feed archive (which imported with no geo, so all of it sits in "Ungeocoded") rendered the
whole lot at once — GhostExodus's "cluster-fuck." The concept mockup he wants copied is the opposite: a
left **finder** and a right **3×3 wall of feeds the user placed deliberately**, with an "Add new feed"
tile in the empty slot. The data layer (geo on `CameraStream`, the tree, search, node-scoped import) is
already in place and correct; this revision changes the **interaction and the styling**, not the schema.

## Operator/GhostExodus decisions (locked)

1. **Add flow:** click a wall square to make it **active**, then **right-click a feed → "Add to active
   square"** drops it in (falls back to the next empty square if none is active).
2. **Wall layout:** **fixed 3×3** (nine slots).
3. **Persistence:** **multiple named walls** — save/name/switch ("London ops", "Dallas").
4. **Import buttons:** the redundant **"Import here" / "Import feeds"** pair collapses to **one contextual
   Import button** (see below).

## The two surfaces

### Left — Finder (browse the library; never streams)

Matches the mockup's left rail.

- **Countries / Cities tabs.** *Countries* = the existing Country→State/City tree. *Cities* = a flat,
  searchable, alphabetised list of every city with its count (a fast path when you know the city but not
  the country).
- **Search box** over both — filters the tree/list by label / city / region / country / url. *Refinement
  GhostExodus asked for:* search returns a **flat, global ranked result list regardless of tree position**,
  each hit showing its location, rather than only narrowing the current node.
- **Flag + count per node.** Country rows show an **emoji flag** (🇬🇧/🇺🇸…) derived offline from a
  country-name→ISO-3166 map (no asset or network fetch). Counts roll up as today.
- **Feed rows** under the selected node / matching the search are a plain list (label + kind + location).
  **Right-click a feed row →** context menu:
  - **Add to active square** (or next empty if none active) — the primary flow.
  - **Play full-screen** — enlarge in place.
  - **Set location…** — assign country/region/city to this feed (and to a multi-selection), so a bare
    archive can be filed into the tree after the fact.
  - **Delete.**
- **Right-click a tree node →** *"Fill wall from here"* — load that node's first 9 feeds into the wall in
  one click (the browse case, on demand — never the default).
- **Bottom bar:** **Refresh** and the **single contextual Import button** (below).

### Right — The wall (curated; the only thing that streams)

Matches the mockup's 3×3.

- **Fixed 3×3 = nine slots.** Slots start **empty**. An empty slot renders the **"＋ Add new feed"**
  affordance (clicking it opens the add-stream form, as in the mockup's 9th tile).
- A filled slot shows the live feed with a **top bar** (timestamp — and provider/label if present) and a
  **bottom label** (the feed name), matching the mockup tiles. Reuses the existing per-kind `Viewer`.
- **Active slot** is highlighted; clicking a slot makes it active. Each filled slot has a small **×** to
  clear it (returns it to the empty "＋" state). Per-tile delete-the-stream stays available via the
  finder's right-click (clearing a slot ≠ deleting the feed from the library).
- Because the wall is **nine slots**, the live-player budget (cap 9) is never exceeded by construction —
  the cluster-fuck is structurally impossible.

### Named walls

- A **Wall** = `{ id, name, slots: (streamId | null)[9], createdAt, updatedAt }`.
- A wall selector in the header (New / Open / Rename / Delete), mirroring the OSINT graph's investigation
  pattern. The app opens the **last-used wall**, or a fresh "Untitled wall" if none.
- Persisted to `walls.json` via the same `secure-fs` path `streams.json` already uses. A wall stores only
  **stream ids**; if a referenced feed was deleted, that slot renders empty with a faint "feed removed"
  note (no crash).

## The contextual Import button (kills the redundant pair)

One button, in the finder's bottom bar:

- **"All cameras" / Cities tab / no location node selected →** label **"Import…"** — today's global import,
  no location stamp.
- **A location node selected (e.g. London) →** label **"Import to London…"** — imports and **stamps** that
  node's country/region/city onto feeds lacking geo (file-provided geo still wins). This is the old
  "Import here" behaviour, now self-explaining.

`streams:import(stamp?)` already supports this (shipped in beta.3); only the button label/visibility logic
changes. Remove the second button entirely.

## Visual / template fidelity

Match the mockup within the existing Win98 (`ga98-*`) shell:
- Left rail: tabs, search, flag+count tree, bottom Refresh/Import.
- Header strip: title, an **Add stream** action, settings — styled like the mockup's top bar.
- Main: dark feed area, clean 3×3 tiles with the timestamp/label headers and the "＋ Add new feed" tile.

**Phase-2 (explicitly out of this pass)** — the mockup's extra chrome that GhostExodus's locked decisions
don't require: the multiple **grid-layout toggle icons** (he chose fixed 3×3), the **record** button,
per-feed **notes** ("New note / Show notes"), and per-tile **provider logos**. Note them; don't build them
now.

## Data flow

1. Load `streams.list()` → `buildTree` → finder tree; `walls.list()` → wall selector; open last wall.
2. Finder: select a node / type a query → filters the **feed list** (no streaming).
3. Right-click feed → "Add to active square" → write `streamId` into the active slot of the current wall →
   persist the wall → that slot goes live.
4. Contextual Import → `streams:import(nodeStamp)` → refresh tree (new feeds appear in the finder).
5. "Set location…" → `streams.upsert` the geo onto the feed(s) → tree re-categorises immediately.

## Charter / security (unchanged)

No discovery, scanning, probing, or enumeration. No new egress; flags are offline emoji, not fetched
favicons. The wall only streams feeds the user placed; the 9-slot ceiling bounds concurrent connections
(matters over Tor). No telemetry.

## Testing

Pure logic gets node unit tests; React stays thin:
- **wall store** round-trip through a mock secure-fs (save/load/list/rename/delete; missing-stream slot
  renders empty, no throw).
- **assignToActiveSlot(wall, slotIndex|null, streamId)** pure helper — fills the active slot, else the
  first empty; full wall is a no-op with a signal.
- **contextual import label/stamp** — root → no stamp + "Import…"; node → stamp + "Import to <node>…".
- **country→flag** mapping — known names map to the right emoji; unknown/Ungeocoded → no flag, no throw.
- **Cities-tab list + global search** — flat, sorted, deduped; search returns cross-tree hits with location.

## Open question for GhostExodus

The mockup's tiles show a **live timestamp overlay** ("Fri 12 Jun | 12:50:11"). For HLS/MJPEG that's the
*wall-clock at render*, not a true stream timecode (we can't trust the feed's own clock). Fine to show
local wall-clock as "as-of" time, or drop it? (Leaning: show local time labelled "as of", so it's honest.)
