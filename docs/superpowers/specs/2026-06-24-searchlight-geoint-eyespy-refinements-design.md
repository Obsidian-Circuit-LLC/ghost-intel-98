# Searchlight / GeoINT / EyeSpy Dogfooding Refinements — Design

**Date:** 2026-06-24
**Branch:** `feat/searchlight-geoint-refinements`
**Origin:** Operator (GhostExodus) dogfooding feedback batch against live OSINT casework.

This spec covers a 12-item feedback batch spanning four surfaces: Searchlight (core OSINT
module), GeoINT, EyeSpy, and shared app chrome. Each workstream below produces independently
testable software. No release is in scope — implementation only, on the feature branch.

## Operator decisions (binding)

- **Favicons:** bundle at build time (fully offline, zero runtime egress). *Not* a runtime
  fetch, *not* a third-party proxy (Google `s2`/DuckDuckGo are rejected — they leak the target
  site list).
- **Custom sites:** persist to the existing encrypted custom-sites store; add an on-demand
  "Export sites.json" that dumps a plaintext copy. Encrypt-at-rest is preserved.
- **Coordinates → master CCTV:** export-on-demand. Add lat/long to EyeSpy Add-Stream; cameras
  live in EyeSpy's encrypted store; the existing "Export CCTV…" writes them into the master
  tree. No bound external file mutated on every add.

## Global constraints (apply to every task)

- No telemetry, no phone-home, no new network egress channels. Favicons add **zero** runtime
  egress (bundled snapshot).
- Searchlight sweeps stay **main-process only**; the renderer makes no network calls. The
  Tor-default / `networkEnabled`-gated / no-silent-clearnet-fallback invariants are unchanged.
- Encrypt-at-rest via secure-fs for all new persisted state (custom sites, pinned monitors).
- Untrusted input sanitised at the trust boundary (imported sites, custom URLs, coordinate
  entry coerced/validated before persist).
- No `new RegExp(untrustedInput)` on the main thread; `MaigretSiteEntry` keeps no `regexCheck`
  field (ReDoS removed at the type level — the full Maigret DB carries `regexCheck`; it is
  dropped on ingest, as today).
- CSP unchanged. Favicons render as `data:` images under `img-src` (verify `img-src data:` is
  allowed; it is the standard for the existing data-URI avatars).
- Determinism in build artifacts: favicons ship as a **committed snapshot**
  (`resources/searchlight/favicons.json`), regenerated on demand by a script — mirrors the
  bundled-TLE-snapshot pattern. `package`/`package:win` consume the committed file; no
  build-time network.
- Commit trailers: every commit ends with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` /
  `Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF`.

---

## Workstream A — Full Maigret database (engine resolution)

**Problem.** Searchlight bundles a curated ~1,433-site subset. The operator supplied the full
Maigret `data.json` (3,166 sites). **1,372 of those sites are "engine-backed":** they declare
`"engine": "<name>"` and inherit their check logic (`checkType`, `presenseStrs`, `absenceStrs`,
`ignore403`) from a top-level `engines` map (`engine404`, `engineRedirect`, `XenForo`, `phpBB`,
…). The current parser (`src/shared/searchlight/sites.ts`) ignores `engine` and would mis-probe
all 1,372 (no presence/absence strings, `checkType` defaulting to `status_code`) → systematic
false "not found".

**Design.**
- Replace `resources/searchlight/maigret_sites.json` with the full Maigret `data.json` (the
  `{sites, engines, tags}` envelope). Keep the `engines` block in the bundled file.
- Extend `parseMaigretData(json)` to **resolve engine references**: when a site has
  `engine: <name>` and `engines[<name>].site` exists, merge the engine's `.site` fields as
  **defaults** beneath the site's own fields (site overrides engine; engine fills the gaps).
  Resolution happens before `coerceEntry`, so the coerced entry already carries the resolved
  `checkType`/`presenseStrs`/`absenceStrs`. `engines` itself never becomes site entries.
- Keep the existing `disabled` filter (the full DB marks many entries `disabled: true`).
- `regexCheck` continues to be dropped (not read into `MaigretSiteEntry`).
- `ignore403`: if an engine/site sets it, a 403 reads as the site's not-found/あり semantics
  rather than `blocked`. Thread an optional `ignore403` boolean through `MaigretSiteEntry` and
  honour it in `interpretResult` (a 403 on an `ignore403` site is interpreted by content rather
  than auto-classified as `blocked`). This is the only change to interpretation.

**Error handling.** A malformed/absent `engines` map degrades gracefully — a site whose engine
can't be resolved coerces from its own fields (today's behaviour). No throw.

**Tests** (`test/searchlight-sites.test.ts`, node): an engine-backed fixture site resolves its
`absenceStrs`/`checkType` from a fixture `engines` map; a site overriding an engine field keeps
its own value; a site with an unknown engine falls back to its inline fields; `disabled` sites
are excluded; `engines`/`tags` keys never appear as sites; total resolved count matches expected.

---

## Workstream B — Bundled favicons (build-time snapshot)

**Problem.** Operator wants each site's favicon shown on results. Live fetch is an egress /
deanonymization hazard (the reason GraphView uses generated avatars today).

**Design.**
- `scripts/fetch-favicons.mjs` (regenerator, run manually; *not* in the build): reads the
  bundled Maigret DB, derives the unique set of `urlMain` origins, fetches a favicon for each
  (best-effort: `/favicon.ico`, then a parsed `<link rel="icon">` fallback), downscales to a
  small PNG, and writes `resources/searchlight/favicons.json` = `{ "<siteName>": "data:image/png;base64,…" }`.
  Best-effort: sites that fail are simply omitted. Deterministic output ordering (sorted keys).
  Fail-closed only on write errors, not on individual fetch misses.
- Commit `resources/searchlight/favicons.json` as a snapshot (like the TLE snapshot). Add it to
  `build.extraResources` alongside `maigret_sites.json`.
- Main process (`src/main/searchlight/site-db.ts`): load `favicons.json` once (cached). Expose a
  lazy IPC `searchlight:favicon(siteName) → string | null` returning the data-URI (or null).
  **Per-site lazy lookup, not the whole map over IPC** — keeps payloads small; the renderer
  requests icons only for the results it displays.
- Renderer: `SweepPanel` result rows and `GraphView` profile nodes request the favicon for a
  displayed site and render `<img src={dataUri}>` with the existing generated avatar as fallback
  when null. No renderer network.

**OpSec note.** Zero runtime network. The only network is the operator running
`fetch-favicons.mjs` deliberately to refresh the snapshot; it touches the listed sites'
favicons from whatever environment the operator runs it in (document this in the script header).

**Tests** (`test/searchlight-favicons.test.ts`, node): the IPC/lookup returns the data-URI for a
known site from a fixture map and `null` for an unknown site; loader tolerates a missing
favicons.json (returns null, no throw); data-URIs are validated to start with `data:image/` at
load (drop anything else — trust-boundary coercion even though the file is bundled).

---

## Workstream C — Custom site add + export

**Problem.** Operator wants to add a single custom URL that persists; current flow only imports
a full Maigret `data.json`.

**Design.**
- New IPC `searchlight:addCustomSite({ name, url, category? })`. Main validates with the same
  rules as `validateImportedSites` (https, `{username}` token), coerces, merges into the
  encrypted `custom-sites.json` store (`secureWriteFile`), returns `{ ok, reason? }`.
- New IPC `searchlight:exportSites() → string` (plaintext JSON of the merged custom sites) wired
  to a renderer "Export sites.json" save dialog. Bundled sites are not exported (only custom).
- Renderer: a small "Add custom site" form on the Sweep panel (name + URL + optional category),
  inline validation, success/error toast. Catalog refreshes after add.

**Error handling.** Invalid URL → rejected with reason, nothing persisted. Duplicate name →
overwrites the custom entry (custom-overrides semantics already in `fullSites`).

**Tests** (`test/searchlight-store.test.ts` extension, node, mock secure-fs): add → persisted →
present in merged catalog; invalid URL rejected, store unchanged; export emits only custom sites
as valid JSON round-tripping through `validateImportedSites`.

---

## Workstream D — Searchlight chrome (settings, start menu, intro, whiteboard removal)

All renderer-only; existing patterns identified.

- **D1 Settings pane.** Add a "Searchlight" section to `SettingsModule.tsx` (`SECTIONS` array +
  `SectionKey` + conditional render). New `SearchlightPane` exposes: network on/off toggle
  (`settings.searchlight.networkEnabled`), Tor concurrency, clearnet concurrency. Mirrors the
  existing `SoundPane`/`ThemePane` shape. This is the missing toggle the operator couldn't find.
- **D2 Start-menu entry.** Add a Searchlight entry to `defaultShortcuts` and
  `REQUIRED_MODULE_SHORTCUTS` (`src/shared/types.ts`) so it appears in the Access menu and
  back-fills existing installs.
- **D3 Intro splash.** Add `hasSeenSearchlightIntro: boolean` (default false) to `AppSettings`.
  On Searchlight module mount, show a Win98-framed intro modal titled **Searchlight** —
  "Opening Searchlight / Be sure to verify your results. / Automated checks are not a substitute
  for manual verification." with an **UNDERSTOOD — PROCEED** button that sets the flag. Faithful
  to the original standalone card, renamed. (Once-per-install via the flag; matches the
  `hasSeenWelcome` pattern.)
- **D4 Remove Whiteboard.** Delete `panels/Whiteboard.tsx`, its tab entry + conditional render +
  import in `SearchlightModule.tsx`, and the `.sl-wb-*` CSS. Remove the now-unused `react-rnd`
  dependency from `package.json` (Searchlight was its only consumer — verify with a repo grep
  before removing).

**Tests.** Renderer isn't unit-tested (typecheck + electron-vite build + manual smoke per house
rule). `npm run typecheck` and the build must stay clean; settings round-trip for the new flag
covered by the existing settings store tests where applicable. Add a node test asserting the
Searchlight shortcut is present in `defaultShortcuts`/`REQUIRED_MODULE_SHORTCUTS`.

---

## Workstream E — Searchlight cosmetics (midnight purple)

CSS-only in `searchlight.css`, against the classes the explorer pinned.

- **E1 Dropdowns.** `.sl-graph-add-menu` (Graph "Add Entity") and the scope-filter chips
  (`.sl-sweep-cat` / `.sl-sweep-cat-active`) → midnight-purple background with light/white text.
  Fixes the gray-bg + colored-text unreadability.
- **E2 Export buttons.** The Reports export buttons → a `.sl-rp-export-btn` variant: smaller
  (font/padding down), midnight-purple background, white lettering, purple 3-D Win98 bevel,
  pressed-state invert.

Palette: base `#3d1a5c`, hover `#5d3a7d`, bevel light `#5d3a7d` / dark `#1a0f2a`, text
`#ffffff`/`#e8d8ff`. Verify contrast against the dark canvas.

**Tests.** Visual; verified by build + manual smoke. No unit tests.

---

## Workstream F — GeoINT timeline lock + Add to Monitor

- **F1 Lock the timeline slider.** The "slider" is the `TimelineBar` scrubber; far-right =
  `bounds.max` = the "All / show every event" position. Lock the visible set to the **full**
  (non-time-filtered) item set permanently and retire the scrubber + Play/Pause/All controls
  (they are no-ops when locked). Implementation: stop driving the map/feed off `timeCursor`;
  feed the full located set. Remove the `TimelineBar` render (or render nothing) and the
  play-timer effect. Keep `corroborate()` and everything else unchanged.
- **F2 Add to Monitor.** Right-click a Situation-Feed item (`CommandRail.tsx`) → a small
  context menu (reuse EyeSpy `Finder.tsx`'s `FeedMenu` pattern) with **Add to Monitor**.
  "Monitored Situations" is currently auto-derived (corroboration ≥ 1) and ephemeral. Add a
  **pinned set** persisted in the vault (set of feed-item ids/keys). A pinned item appears in
  MONITORED SITUATIONS regardless of corroboration count and is removable (a "Remove from
  Monitor" entry on already-pinned items). Persist via secure-fs; load on GeoINT mount.

**Data flow.** Pinned ids ∪ corroborated ids → the MONITORED SITUATIONS list. A feed item maps
to a stable key (id, or `sourceId+title` if id is non-unique — verify the feed item shape during
implementation). Sanitise the persisted pinned set on load (array of strings, drop non-strings).

**Tests** (`test/geoint-monitor.test.ts`, node): pinned-set store round-trips through mock
secure-fs; the monitored-list selector unions pinned + corroborated and dedupes; load sanitises
a malformed persisted blob.

---

## Workstream G — EyeSpy coordinate entry

- Add **Latitude / Longitude** fields to the EyeSpy Add-Stream dialog (`EyeSpyModule.tsx`).
  Validate as a pair with the existing `parseCoordPair` (`SetLocationDialog.tsx`): both finite,
  lat ∈ [-90, 90], lon ∈ [-180, 180]; an incomplete/out-of-range pair is dropped (not partially
  saved). Pass through the existing `streams.upsert` IPC; main-side `pickGeo()` already enforces
  the same pair rule (defence in depth).
- No reverse geocoding (none exists). Country/Region/City stay manual fields (already on the
  Set-Location flow; optionally surface them on Add-Stream too for completeness — minor).
- Export path unchanged: `streamsToMasterTree()` already emits
  `coordinates:{latitude,longitude}` for cameras that carry a valid pair, nesting under
  Country/Region/City (or an Unknown bucket). The new coords therefore flow into the master CCTV
  json on "Export CCTV…". This satisfies the export-on-demand decision with no new file binding.

**Tests** (`test/streams.test.ts` extension, node): an upsert carrying a valid lat/lon pair
persists both; an out-of-range or half pair is dropped; `streamsToMasterTree` emits the
`coordinates` block for a geocoded camera and omits it for a geo-less one.

---

## Cross-cutting / verification

- `npm run typecheck` + full `npm test` green (new/extended suites: searchlight-sites,
  searchlight-favicons, searchlight-store, geoint-monitor, streams; plus the shortcut presence
  test). Existing 1,317 stay green.
- electron-vite build clean; confirm `favicons.json` + full `maigret_sites.json` land in
  `extraResources`.
- Manual smoke (operator, post-build): Settings → Searchlight toggle flips the gate; start-menu
  entry opens Searchlight; intro card shows once; full DB site count (~3k usable after
  disabled-filter); a found result shows its bundled favicon; add a custom site + export; Graph
  dropdown + scope chips + export buttons render midnight-purple and readable; Whiteboard gone;
  GeoINT shows all events with no scrubber; right-click feed → Add to Monitor pins it; EyeSpy
  Add-Stream takes lat/long and Export CCTV writes coordinates.
- Charter: no new egress (favicons bundled), no telemetry, encrypt-at-rest for custom sites +
  pinned monitors, untrusted input coerced at every boundary.

## Out of scope

Release/version-bump/publish (operator will request separately). The parked chat-handshake
formal-verification work. EyeSpy reverse-geocoding. Bundling the operator's 2.4 MB master CCTV
tree as a seed dataset (separate decision if wanted).
