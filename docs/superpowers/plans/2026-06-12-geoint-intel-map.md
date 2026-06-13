# GeoINT intel-map wow-bundle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Five additive GeoINT enhancements for the next release: a city-rich offline gazetteer (auto-geocode + the "feeds not showing" fix), category/severity marker coloring, corroboration-resonance, a timeline scrubber, and story-mode playback.

**Architecture:** Main enriches items on refresh (gazetteer geocode + literal-keyword classify); renderer derives corroboration and drives timeline/story. Pure logic split out for tests. Offline-first; no new IPC; `GeoItem` gains optional `category`/`severity`.

**Tech:** Electron + React + TS, Leaflet, vitest. Gazetteer = GeoNames `cities5000` (CC-BY) + `world-countries`.

---

## Task 1: City-rich gazetteer + scalable geocoder

**Files:** Modify `scripts/gen-gazetteer.cjs`, `src/main/geoint/geocode.ts`; regenerate `resources/geoint/gazetteer.json`; Test `test/geoint-geocode.test.ts`.

### 1a — Scalable phrase-index geocoder (must precede the big dataset)
- [ ] **Rewrite `geocode.ts:makeGeocoder`** to a phrase-index lookup (the current per-entry regex sweep is O(entries) per item — fatal at ~50k). Keep the `GazEntry`/`Geocoder` types and "longest place-name wins, whole-word, deterministic" semantics.

```ts
export interface GazEntry { name: string; lat: number; lon: number }
export type Geocoder = (text: string) => { lat: number; lon: number; name: string } | null;

/** Normalize to space-joined lowercase letter-tokens, so "Coeur d'Alene" and "coeur d alene" match
 *  and punctuation/casing is irrelevant. */
function norm(s: string): string { return (s.toLowerCase().match(/\p{L}+/gu) ?? []).join(' '); }

export function makeGeocoder(entries: GazEntry[]): Geocoder {
  const index = new Map<string, GazEntry>();
  let maxWords = 1;
  for (const e of entries) {
    const key = norm(e.name);
    if (!key) continue;
    if (!index.has(key)) index.set(key, e); // first wins; the gen script dedupes by population
    const w = key.split(' ').length;
    if (w > maxWords) maxWords = w;
  }
  return (text) => {
    const words = text ? (text.toLowerCase().match(/\p{L}+/gu) ?? []) : [];
    let best: GazEntry | null = null; let bestLen = 0;
    for (let i = 0; i < words.length; i++) {
      for (let n = Math.min(maxWords, words.length - i); n >= 1; n--) {
        const phrase = words.slice(i, i + n).join(' ');
        const hit = index.get(phrase);
        if (hit) { if (phrase.length > bestLen) { best = hit; bestLen = phrase.length; } break; }
      }
    }
    return best ? { lat: best.lat, lon: best.lon, name: best.name } : null;
  };
}
```
(At each start `i`, take the longest matching n-gram, update `best` if its phrase length beats `bestLen`, then `break` to the next `i` — so the globally longest place name wins.)

- [ ] **Tests** (`test/geoint-geocode.test.ts`, replace the old regex-based expectations): "protests in Mariupol today" → Mariupol; multi-word "New York" matched over "York" if both present (longest wins); "Coeur d'Alene" matches the apostrophe entry; a 50k-entry synthetic set geocodes a string in well under 5ms (perf guard); empty/no-match → null.

### 1b — Generate from GeoNames cities5000 (CC-BY)
- [ ] **Extend `scripts/gen-gazetteer.cjs`:** keep the `world-countries` country centroids; ADD GeoNames `cities5000`. Fetch `https://download.geonames.org/export/dump/cities5000.zip` at build time, **SHA-256-pin** it (mirror `fetch-tor`), unzip, parse the TSV (tab-sep; col 1 = name, col 4 = latitude, col 5 = longitude, col 14 = population). For each city emit `{name, lat, lon}` and track population for dedupe.
  - **Dedupe by `norm(name)`** across cities, keeping the **highest population** (so "Springfield" → the biggest). Merge with countries; on an exact normalized collision between a country and a city, keep the country centroid.
  - **Drop false-positive-prone names:** filter any city whose `norm(name)` is **< 4 chars** OR is in a small **stoplist of common English words** (e.g. `as, is, of, or, and, the, you, eu, us, no, so, to, ...`). Country names are exempt. This prevents a city "Eu" geocoding the word "EU".
  - Write `resources/geoint/gazetteer.json` (compact). Log the count + provenance.
  - **RUN it** (`node scripts/gen-gazetteer.cjs`) and commit the regenerated `gazetteer.json`.
- [ ] **Attribution:** add a `GAZETTEER_ATTRIBUTION = 'Places © GeoNames (CC-BY 4.0)'` constant (in `gazetteer.ts` or a shared place) and surface it in the GeoINT UI attribution line (Task 7). Note the CC-BY source in the script header (replace the "country-level only" comment).

- [ ] **Verify:** `node scripts/gen-gazetteer.cjs` writes ~50k entries incl. known cities (Mariupol, Portland, Khartoum, Kyiv); `pnpm test -- geoint-geocode` green; `pnpm typecheck` clean.
- [ ] **Commit:** `git commit -m "feat(geoint): city-rich gazetteer (GeoNames cities5000, CC-BY) + scalable phrase-index geocoder"`

---

## Task 2: Category / severity classification

**Files:** Modify `src/shared/post-mvp-types.ts`, `src/main/geoint/feeds.ts`; Create `src/main/geoint/classify.ts`; Test `test/geoint-classify.test.ts`.

- [ ] **Type:** `GeoItem` += `category?: string; severity?: 'low' | 'medium' | 'high';` (optional, back-compat).
- [ ] **`classify.ts` (pure, literal-match only — NO `new RegExp` on feed text):**

```ts
export type Severity = 'low' | 'medium' | 'high';
export interface Classification { category?: string; severity?: Severity }

// Default rulesets — bundled, ordered (first category with a hit wins). Lowercase keywords; literal substring.
const CATEGORIES: { category: string; keywords: string[] }[] = [
  { category: 'conflict', keywords: ['airstrike', 'shelling', 'offensive', 'troops', 'missile', 'ceasefire', 'frontline', 'casualties', 'militant'] },
  { category: 'cyber', keywords: ['ransomware', 'breach', 'malware', 'ddos', 'phishing', 'exploit', 'data leak', 'hacked', 'cyberattack'] },
  { category: 'protest', keywords: ['protest', 'demonstration', 'rally', 'unrest', 'riot', 'strike', 'clashes'] },
  { category: 'disaster', keywords: ['earthquake', 'flood', 'wildfire', 'hurricane', 'tornado', 'eruption', 'landslide', 'evacuat'] },
  { category: 'crime', keywords: ['shooting', 'homicide', 'trafficking', 'kidnap', 'arrest', 'cartel', 'smuggling'] },
  { category: 'politics', keywords: ['election', 'sanction', 'parliament', 'minister', 'summit', 'treaty', 'coup'] }
];
const HIGH = ['killed', 'dead', 'explosion', 'attack', 'emergency', 'mass', 'critical', 'fatal'];
const MED = ['injured', 'warning', 'threat', 'evacuat', 'clashes', 'breach'];

export function classify(title: string, summary = ''): Classification {
  const text = `${title} ${summary}`.toLowerCase();
  let category: string | undefined;
  for (const c of CATEGORIES) { if (c.keywords.some((k) => text.includes(k))) { category = c.category; break; } }
  let severity: Severity | undefined;
  if (HIGH.some((k) => text.includes(k))) severity = 'high';
  else if (MED.some((k) => text.includes(k))) severity = 'medium';
  else if (category) severity = 'low';
  return { ...(category ? { category } : {}), ...(severity ? { severity } : {}) };
}
```

- [ ] **Wire into `feeds.ts`:** in `parseRss`/`parseAtom`/`parseGeoJson`, spread `...classify(title, summary)` onto each item (use the item's title/summary; for GeoJSON use title + summary).
- [ ] **Tests:** a conflict headline → `conflict`/high; a cyber breach → `cyber`/medium; neutral → `{}`; a feed string containing regex metacharacters (`.*?(`) classifies without throwing (literal-match proof).
- [ ] **Verify + Commit:** `pnpm test -- geoint-classify` green; typecheck clean. `git commit -m "feat(geoint): literal-keyword category/severity classification on feed items"`

---

## Task 3: Corroboration resonance (pure, renderer)

**Files:** Create `src/renderer/modules/geoint/corroborate.ts`; Test `test/geoint-corroborate.test.ts`.

- [ ] **Implement:**

```ts
import type { GeoItem } from '@shared/post-mvp-types';

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371, d = Math.PI / 180;
  const dLat = (bLat - aLat) * d, dLon = (bLon - aLon) * d;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * d) * Math.cos(bLat * d) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** For each located item, the count of DISTINCT other sources reporting within radiusKm and windowHours.
 *  count >= 1 ⇒ corroborated by that many *other* sources (so a ring shows for count>=1). */
export function corroborate(
  items: GeoItem[],
  opts: { radiusKm?: number; windowHours?: number } = {}
): Map<string, number> {
  const R = opts.radiusKm ?? 25, W = (opts.windowHours ?? 48) * 3600_000;
  const located = items.filter((i) => i.lat != null && i.lon != null);
  const t = (i: GeoItem): number | null => { const p = i.published ? Date.parse(i.published) : NaN; return Number.isNaN(p) ? null : p; };
  const out = new Map<string, number>();
  for (const a of located) {
    const srcs = new Set<string>();
    for (const b of located) {
      if (b.id === a.id || b.sourceId === a.sourceId) continue;
      if (haversineKm(a.lat!, a.lon!, b.lat!, b.lon!) > R) continue;
      const ta = t(a), tb = t(b);
      if (ta != null && tb != null && Math.abs(ta - tb) > W) continue; // if either undated, don't time-gate
      srcs.add(b.sourceId);
    }
    out.set(a.id, srcs.size);
  }
  return out;
}
```

- [ ] **Tests:** two items, same place + time, different sources → each count 1; same source twice → 0; outside radius → 0; outside time window → 0; undated items not time-gated; haversine sanity (~111 km per degree lat).
- [ ] **Verify + Commit:** `git commit -m "feat(geoint): corroboration resonance (cross-source same place+time confidence)"`

---

## Task 4: Map markers — category color, severity size, corroboration halo

**Files:** Modify `src/renderer/modules/geoint/MapPane.tsx` (and a small icon helper).

- [ ] Add a category→color map and a marker-icon builder. Replace the single `pin` divIcon with a per-item icon:
  - color by `item.category` (e.g. conflict=#c0392b, cyber=#8e44ad, protest=#e67e22, disaster=#16a085, crime=#7f8c8d, politics=#2980b9, default=#555),
  - size by `item.severity` (high=larger),
  - a **halo/ring** when `corroboration.get(item.id)! >= 1`, brighter with higher count.
  Implement via `L.divIcon` with a styled `<span>` (Win98-flat; CSS in `theme.css` `.ga98-geo-mk-*`). The marker build effect already iterates items — pass a `corroboration: Map<string,number>` prop (memoized in GeoIntModule) and the item's category/severity into the icon builder.
- [ ] Keep the search-pin (PR #10) and the focus popup behavior intact.
- [ ] **Verify + Commit:** typecheck + build clean. `git commit -m "feat(geoint): category-colored, severity-sized, corroboration-haloed markers"`

---

## Task 5: Timeline scrubber

**Files:** Create `src/renderer/modules/geoint/timeline.ts` (pure helper) + a `TimelineBar.tsx`; Modify `GeoIntModule.tsx`/`MapPane.tsx`. Test `test/geoint-timeline.test.ts`.

- [ ] **Pure helper `timeline.ts`:**

```ts
import type { GeoItem } from '@shared/post-mvp-types';
export function timeBounds(items: GeoItem[]): { min: number; max: number } | null {
  const ts = items.map((i) => (i.published ? Date.parse(i.published) : NaN)).filter((n) => !Number.isNaN(n));
  return ts.length ? { min: Math.min(...ts), max: Math.max(...ts) } : null;
}
/** Items at or before time `t`. Undated items are always included (pinned to "now"). */
export function itemsUpTo(items: GeoItem[], t: number): GeoItem[] {
  return items.filter((i) => { const p = i.published ? Date.parse(i.published) : NaN; return Number.isNaN(p) || p <= t; });
}
```

- [ ] **`TimelineBar.tsx`:** a Win98 range `<input type="range">` from `min..max` + a Play/Pause button. State `cursor` (default = max). Play advances `cursor` toward `max` on a timer (~step per tick), then stops. Reports `cursor` up; "All" resets to max (show everything).
- [ ] **GeoIntModule:** hold `timeCursor` state; the items passed to `MapPane` are `itemsUpTo(items, timeCursor)` (still memoized + corroboration computed on the FULL located set or the visible set — compute on full so confidence is stable; filter for display). Show the bar under the map.
- [ ] **Tests:** `timeBounds` ignores undated; `itemsUpTo` includes undated + dated ≤ t, excludes dated > t.
- [ ] **Verify + Commit:** `git commit -m "feat(geoint): timeline scrubber (play events over time)"`

---

## Task 6: Story-mode playback

**Files:** Create `src/renderer/modules/geoint/StoryControls.tsx`; Modify `GeoIntModule.tsx`.

- [ ] **Selection:** reuse the existing list/markers — add a way to build a story set: simplest v1 = "Play story" plays the **currently visible, located items in chronological order** (or the items of a selected category filter). (A manual multi-select is a nice-to-have; v1 = visible+located, sorted by `published`.)
- [ ] **`StoryControls.tsx`:** a bar with Play / Pause / Prev / Next / speed. On Play, step an index through the sorted set; for each, drive the map: `setFlyTo({lat,lon,key})` (reuse the existing flyTo path so it recenters) AND set `focusId` to that item's id (the existing `[focusId]` effect opens its popup — the white box + article link). Pause N seconds (speed-controlled), advance. Stop at the end.
- [ ] **GeoIntModule:** wire the controls; reuse `flyTo`/`focusId` state already present. Don't fight the timeline (pause auto-play while a story runs).
- [ ] **Verify + Commit:** typecheck + build clean. `git commit -m "feat(geoint): story-mode playback (chronological map briefing)"`

---

## Task 7: GeoIntModule wiring — legend + attribution + integration

**Files:** Modify `src/renderer/modules/geoint/GeoIntModule.tsx`, `src/renderer/styles/theme.css`.

- [ ] A **category legend** chip row (color ↔ category) in the left pane.
- [ ] Surface the **gazetteer attribution** (`Places © GeoNames (CC-BY 4.0)`) in the GeoINT attribution/footer area (next to the existing map attributions).
- [ ] Memoize `corroboration = corroborate(locatedItems)` and pass to `MapPane`; pass the timeline-filtered items; mount `TimelineBar` + `StoryControls`.
- [ ] **Verify:** `pnpm typecheck` clean; `pnpm test` green; `pnpm build` succeeds.
- [ ] **Commit:** `git commit -m "feat(geoint): legend, GeoNames attribution, wire corroboration/timeline/story"`

---

## Verification

- `pnpm typecheck` clean; `pnpm test` green (new: `geoint-geocode` rewrite, `geoint-classify`, `geoint-corroborate`, `geoint-timeline`); `pnpm build` succeeds with the bundled cities gazetteer.
- Adversarial review (red-teamer) on the diff: gazetteer false-positive/perf, classifier ReDoS-safety, corroboration correctness, no new egress (gazetteer + classifier bundled; feeds unchanged), determinism.
- Manual (operator/GhostExodus): enable network + add an RSS source + Refresh → city articles pin and are colored by category; corroborated events glow; scrub the timeline; play a story (flyTo + white-box popup per event).

## Self-review notes

- Task 1's geocoder rewrite MUST land before the 50k dataset (perf). Existing `geoint-geocode` test expectations are replaced.
- `classify` is literal-substring only (the ReDoS rule); the gazetteer's regex-free phrase index also removes the old per-entry RegExp.
- Corroboration is derived (no schema change) and computed on the full located set so confidence is stable under timeline filtering.
- No new IPC; `GeoItem` gains only optional fields (back-compat).
