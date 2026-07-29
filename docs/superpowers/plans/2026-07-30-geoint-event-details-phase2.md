# GeoINT Event Details — Phase 2 (Sources & Related) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Event Details dossier's **SOURCES** tab live as *factual corroboration* — the other feeds reporting the same event, plus related events in the same region — and add a **Group Regional Events** view, all from real already-fetched data with no invented authority tiers.

**Architecture:** Two new pure, deterministic selectors (one reusing the corroboration engine's geo+time logic, one region+type) feed a newly-live SOURCES tab in the existing presentational `EventDetailsPanel`. The panel gains two additive props (`allItems`, `sources`) the module already holds. A module-level `regionFilter` view state, driven by a new CommandRail right-click entry, buckets the map + Situation Feed by country. No persistence, no data-model change, no new egress or dependency.

**Tech Stack:** TypeScript, React (renderer), existing Vitest + jsdom test harness, existing headless-Chrome CSS harness.

## Global Constraints

- **No fabricated intelligence data.** Sources are shown by their *real* label/link/time/distance; war-tracker / `chatter`-category items keep their explicit "unverified social-OSINT" stamp. **No Official/Independent/Social authority tier** — the app holds no field that substantiates authority (operator decision 2026-07-30). Provenance shown as-is, never laundered.
- **No new network egress, no telemetry, no phone-home.** Every selector operates on already-fetched in-memory `GeoItem`s. No new dependency.
- **Additive/back-compatible only.** New panel props are required in the component's TS type but the only caller (GeoIntModule) supplies them; no `GeoItem`/`GeoSource` schema change. War-tracker `category:'chatter'` is unchanged (severity/confidence drives the red, per the spec's open-question lean).
- **Determinism.** Every selector is a pure function of its inputs with a total, tie-broken sort order. No `Date.now()`, no unseeded RNG, no order-dependent iteration in the result.
- **XSS-safe.** All source/related text renders as React text nodes (no `dangerouslySetInnerHTML`); external links go only through the existing `onOpenLink` → `system.openExternal` path, http(s)-guarded like `safeHref`.
- **Commits:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>` via `git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org commit --no-verify`; explicit-path `git add <paths>` only (never `-A`/`.`; never stage `active-snapshot.tle`, `Cargo.lock`, `docs/superpowers/ideation/`, `resources/local-ai/`); **NO AI-identity trailers** (Co-Authored-By / Signed-off-by / Claude-Session / Generated-with). All work on branch `feat/geoint-event-details-p2`; the controller merges to main — implementers never touch main.

---

### Task 1: `corroboratingItems` selector (the same-event source list)

**Files:**
- Modify: `src/renderer/modules/geoint/corroborate.ts` (add an export beside `corroborate`; reuse the module-private `haversineKm`)
- Test: `test/geoint-corroborating-items.test.ts` (new)

**Interfaces:**
- Consumes: `GeoItem` from `@shared/post-mvp-types` (`id`, `sourceId`, `lat?`, `lon?`, `published?`).
- Produces:
  ```ts
  export interface CorroboratingItem { item: GeoItem; distanceKm: number; }
  export function corroboratingItems(
    target: GeoItem,
    items: GeoItem[],
    opts?: { radiusKm?: number; windowHours?: number }
  ): CorroboratingItem[];
  ```
  Defaults `radiusKm = 25`, `windowHours = 48` (identical to `corroborate`, so the tab list and the map halo agree). Returns **every OTHER item** (`item.id !== target.id`) with finite coords within `radiusKm` of `target` and, when BOTH carry a parseable `published`, within `windowHours`; an undated item on either side is proximity-only (matches `corroborate`). Same-source items ARE included (so the panel's "This source" filter has content). Returns `[]` when `target` has no finite coords. Sort: `distanceKm` asc, then `published` desc (undated last), then `id` asc — total and deterministic.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { corroboratingItems } from '../src/renderer/modules/geoint/corroborate';
import type { GeoItem } from '../src/shared/post-mvp-types';

const mk = (o: Partial<GeoItem> & { id: string; sourceId: string }): GeoItem => ({
  title: o.id, located: 'geo', ...o
} as GeoItem);

describe('corroboratingItems', () => {
  const target = mk({ id: 'T', sourceId: 'wt', lat: 50, lon: 30, published: '2026-07-30T10:00:00Z' });

  it('returns other items within radius+window, nearest first, excluding the target itself', () => {
    const near = mk({ id: 'A', sourceId: 'reuters', lat: 50.05, lon: 30.05, published: '2026-07-30T09:00:00Z' });
    const far = mk({ id: 'B', sourceId: 'ajz', lat: 10, lon: 10, published: '2026-07-30T10:00:00Z' });
    const out = corroboratingItems(target, [target, near, far]);
    expect(out.map((c) => c.item.id)).toEqual(['A']);
    expect(out[0].distanceKm).toBeGreaterThan(0);
    expect(out[0].distanceKm).toBeLessThan(25);
  });

  it('includes same-source items (for the "this source" filter) but never the target', () => {
    const sameSrc = mk({ id: 'C', sourceId: 'wt', lat: 50.01, lon: 30.01, published: '2026-07-30T10:05:00Z' });
    const out = corroboratingItems(target, [target, sameSrc]);
    expect(out.map((c) => c.item.id)).toEqual(['C']);
  });

  it('excludes items outside the time window when both are dated', () => {
    const old = mk({ id: 'D', sourceId: 'reuters', lat: 50.01, lon: 30.01, published: '2026-07-20T10:00:00Z' });
    expect(corroboratingItems(target, [target, old], { windowHours: 48 })).toEqual([]);
  });

  it('is proximity-only when either side is undated', () => {
    const undated = mk({ id: 'E', sourceId: 'reuters', lat: 50.01, lon: 30.01 });
    expect(corroboratingItems(target, [target, undated]).map((c) => c.item.id)).toEqual(['E']);
  });

  it('returns [] when the target has no coordinates', () => {
    const noCoord = mk({ id: 'N', sourceId: 'wt' });
    const other = mk({ id: 'A', sourceId: 'reuters', lat: 50, lon: 30 });
    expect(corroboratingItems(noCoord, [noCoord, other])).toEqual([]);
  });

  it('sorts ties by published desc then id asc (deterministic)', () => {
    const a = mk({ id: 'ID2', sourceId: 's1', lat: 50.01, lon: 30.01, published: '2026-07-30T09:00:00Z' });
    const b = mk({ id: 'ID1', sourceId: 's2', lat: 50.01, lon: 30.01, published: '2026-07-30T09:00:00Z' });
    const out = corroboratingItems(target, [target, a, b]);
    // identical coords => equal distance; equal published => id asc
    expect(out.map((c) => c.item.id)).toEqual(['ID1', 'ID2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/geoint-corroborating-items.test.ts`
Expected: FAIL — `corroboratingItems is not a function` (not yet exported).

- [ ] **Step 3: Write minimal implementation**

Add to `src/renderer/modules/geoint/corroborate.ts` (after the existing `corroborate` export; `haversineKm` is already in-module):

```ts
export interface CorroboratingItem { item: GeoItem; distanceKm: number; }

/** The OTHER items co-located with `target` in space (and, when both are dated, time) — the concrete
 *  list behind the corroboration count. Same defaults as {@link corroborate} so the list and the map
 *  halo agree. Same-source items are included (the panel's "this source" filter needs them); the
 *  target itself is never included. Pure and deterministic: sorted by distance, then recency, then id. */
export function corroboratingItems(
  target: GeoItem,
  items: GeoItem[],
  opts: { radiusKm?: number; windowHours?: number } = {}
): CorroboratingItem[] {
  const R = opts.radiusKm ?? 25, W = (opts.windowHours ?? 48) * 3600_000;
  if (!Number.isFinite(target.lat) || !Number.isFinite(target.lon)) return [];
  const t = (i: GeoItem): number | null => {
    const p = i.published ? Date.parse(i.published) : NaN;
    return Number.isNaN(p) ? null : p;
  };
  const tt = t(target);
  const out: CorroboratingItem[] = [];
  for (const b of items) {
    if (b.id === target.id) continue;
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lon)) continue;
    const d = haversineKm(target.lat!, target.lon!, b.lat!, b.lon!);
    if (d > R) continue;
    const tb = t(b);
    if (tt != null && tb != null && Math.abs(tt - tb) > W) continue;
    out.push({ item: b, distanceKm: d });
  }
  out.sort((x, y) => {
    if (x.distanceKm !== y.distanceKm) return x.distanceKm - y.distanceKm;
    const px = t(x.item), py = t(y.item);
    if (px != null && py != null && px !== py) return py - px; // recent first
    if (px == null && py != null) return 1;
    if (py == null && px != null) return -1;
    return x.item.id < y.item.id ? -1 : x.item.id > y.item.id ? 1 : 0;
  });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/geoint-corroborating-items.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org \
  commit --no-verify -m "feat(geoint): corroboratingItems selector for the Sources tab" \
  -- src/renderer/modules/geoint/corroborate.ts test/geoint-corroborating-items.test.ts
```
(Stage exactly those two paths first with `git add <paths>`.)

---

### Task 2: `relatedEvents` + `sourceLabel` selectors (related-in-region + label resolution)

**Files:**
- Modify: `src/renderer/modules/geoint/event-details.ts` (add two exports beside `resolveEventFields`/`deriveTags`)
- Test: `test/geoint-related-events.test.ts` (new)

**Interfaces:**
- Consumes: `GeoItem` (`id`, `country?`, `eventType?`, `category?`, `published?`); the corroborating id set from Task 1's output.
- Produces:
  ```ts
  export function sourceLabel(sourceId: string, sources: { id: string; label: string }[]): string;
  export function relatedEvents(
    target: GeoItem,
    items: GeoItem[],
    excludeIds: ReadonlySet<string>,
    opts?: { windowHours?: number; max?: number }
  ): GeoItem[];
  ```
  `sourceLabel` returns the matching source's `label`, else the raw `sourceId` (never blank, never invented). `relatedEvents` returns items in the SAME region (`country`, case-insensitive) with the SAME relation key (`eventType` if present else `category`, case-insensitive) within `windowHours` (default 168 = 7 days) of `target`, EXCLUDING `target.id` and every id in `excludeIds` (the same-event corroboration set — related ≠ duplicate). `[]` when `target.country` is absent or its relation key is empty. Sort: `published` desc (undated last), then `id` asc. Capped at `max` (default 8).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { relatedEvents, sourceLabel } from '../src/renderer/modules/geoint/event-details';
import type { GeoItem } from '../src/shared/post-mvp-types';

const mk = (o: Partial<GeoItem> & { id: string }): GeoItem =>
  ({ sourceId: 's', title: o.id, located: 'none', ...o } as GeoItem);

describe('sourceLabel', () => {
  it('resolves a known id to its label, else falls back to the raw id', () => {
    const src = [{ id: 'wt', label: 'War-Tracker' }];
    expect(sourceLabel('wt', src)).toBe('War-Tracker');
    expect(sourceLabel('unknown', src)).toBe('unknown');
  });
});

describe('relatedEvents', () => {
  const target = mk({ id: 'T', country: 'UA', eventType: 'Military Strike', published: '2026-07-30T10:00:00Z' });

  it('returns same-country same-type events within the window, excluding self + corroboration set', () => {
    const rel = mk({ id: 'R', country: 'ua', eventType: 'military strike', published: '2026-07-28T10:00:00Z' });
    const dupe = mk({ id: 'D', country: 'UA', eventType: 'Military Strike', published: '2026-07-30T09:00:00Z' });
    const otherCountry = mk({ id: 'X', country: 'PL', eventType: 'Military Strike', published: '2026-07-30T09:00:00Z' });
    const otherType = mk({ id: 'Y', country: 'UA', eventType: 'Protest', published: '2026-07-30T09:00:00Z' });
    const out = relatedEvents(target, [target, rel, dupe, otherCountry, otherType], new Set(['D']));
    expect(out.map((i) => i.id)).toEqual(['R']);
  });

  it('falls back to category as the relation key when eventType is absent', () => {
    const t2 = mk({ id: 'T2', country: 'US', category: 'cyber', published: '2026-07-30T10:00:00Z' });
    const rel = mk({ id: 'C', country: 'US', category: 'cyber', published: '2026-07-29T10:00:00Z' });
    expect(relatedEvents(t2, [t2, rel], new Set()).map((i) => i.id)).toEqual(['C']);
  });

  it('returns [] when the target has no country or no relation key', () => {
    const noCountry = mk({ id: 'NC', eventType: 'Military Strike' });
    const noKey = mk({ id: 'NK', country: 'UA' });
    expect(relatedEvents(noCountry, [noCountry], new Set())).toEqual([]);
    expect(relatedEvents(noKey, [noKey], new Set())).toEqual([]);
  });

  it('excludes events outside the window and caps the result', () => {
    const old = mk({ id: 'O', country: 'UA', eventType: 'Military Strike', published: '2026-06-01T10:00:00Z' });
    const many = Array.from({ length: 12 }, (_, n) =>
      mk({ id: `M${String(n).padStart(2, '0')}`, country: 'UA', eventType: 'Military Strike', published: `2026-07-2${n % 9}T10:00:00Z` }));
    const out = relatedEvents(target, [target, old, ...many], new Set(), { max: 8 });
    expect(out).toHaveLength(8);
    expect(out.some((i) => i.id === 'O')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/geoint-related-events.test.ts`
Expected: FAIL — `relatedEvents is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/renderer/modules/geoint/event-details.ts`:

```ts
/** Resolve a `sourceId` to its human label, falling back to the raw id (never blank, never invented). */
export function sourceLabel(sourceId: string, sources: { id: string; label: string }[]): string {
  const hit = sources.find((s) => s.id === sourceId);
  return hit ? hit.label : sourceId;
}

/** Same-region (`country`), same-relation-key (`eventType` else `category`) events within `windowHours`
 *  of `target`, excluding the target and the same-event corroboration set (`excludeIds`). Pure and
 *  deterministic: recency desc, then id asc; capped at `max`. `[]` if the target lacks a country or key. */
export function relatedEvents(
  target: GeoItem,
  items: GeoItem[],
  excludeIds: ReadonlySet<string>,
  opts: { windowHours?: number; max?: number } = {}
): GeoItem[] {
  const W = (opts.windowHours ?? 168) * 3600_000, max = opts.max ?? 8;
  const country = target.country?.trim().toLowerCase();
  const key = (target.eventType ?? target.category ?? '').trim().toLowerCase();
  if (!country || !key) return [];
  const tt = target.published ? Date.parse(target.published) : NaN;
  const parsed = (i: GeoItem): number => (i.published ? Date.parse(i.published) : NaN);
  const matched = items.filter((i) => {
    if (i.id === target.id || excludeIds.has(i.id)) return false;
    if ((i.country?.trim().toLowerCase() ?? '') !== country) return false;
    if (((i.eventType ?? i.category ?? '').trim().toLowerCase()) !== key) return false;
    const ti = parsed(i);
    if (!Number.isNaN(tt) && !Number.isNaN(ti) && Math.abs(tt - ti) > W) return false;
    return true;
  });
  matched.sort((a, b) => {
    const pa = parsed(a), pb = parsed(b);
    if (!Number.isNaN(pa) && !Number.isNaN(pb) && pa !== pb) return pb - pa;
    if (Number.isNaN(pa) && !Number.isNaN(pb)) return 1;
    if (Number.isNaN(pb) && !Number.isNaN(pa)) return -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return matched.slice(0, max);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/geoint-related-events.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/geoint/event-details.ts test/geoint-related-events.test.ts
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org \
  commit --no-verify -m "feat(geoint): relatedEvents + sourceLabel selectors for the Sources tab"
```

---

### Task 3: SOURCES tab goes live in `EventDetailsPanel` (+ module wiring)

**Files:**
- Modify: `src/renderer/modules/geoint/EventDetailsPanel.tsx` (add `allItems`/`sources` props; add tab state; render the SOURCES tab)
- Modify: `src/renderer/modules/geoint/GeoIntModule.tsx:1150-1157` (pass the two new props)
- Test: `test/geoint-sources-tab.test.tsx` (new)

**Interfaces:**
- Consumes: `corroboratingItems`/`CorroboratingItem` (Task 1); `relatedEvents`, `sourceLabel` (Task 2); `resolveEventFields` (existing, for the social-OSINT stamp — an item whose `category === 'chatter'` or whose confidence marks it unverified keeps its stamp).
- Produces: extended `EventDetailsPanelProps`:
  ```ts
  allItems: GeoItem[];                          // full in-scope set; the selectors run against it
  sources: { id: string; label: string }[];    // sourceId → label resolution
  ```
  The panel becomes tabbed: `activeTab` state (`'overview' | 'sources'`), OVERVIEW + SOURCES `live:true`, MEDIA + INTEL still `live:false`. Clicking a live tab switches; the OVERVIEW body is unchanged. The SOURCES tab shows: a header `SOURCES (N)` where **N = distinct other sourceIds** among the corroborating items; a filter `[ All | This source | Other feeds ]`; the corroboration list (source label, relative time, distance, an Open button via `onOpenLink`); a `chatter`/unverified item shows a `⚠ unverified social-OSINT` line; then a `RELATED IN REGION` sub-section listing `relatedEvents` (title + relative time, Open). Empty states: "No other feeds reporting this event." / "No related events in this region." All text is React text nodes.

- [ ] **Step 1: Write the failing test**

Mirror the Phase 1 harness `test/geoint-event-details-panel.test.tsx` EXACTLY — `// @vitest-environment jsdom`, React 18 `createRoot` inside `act()`, and the same `render`/`findButton`/`beforeEach`/`afterEach` scaffolding (there is **no `@testing-library`** dependency). Only the assertions below differ.

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EventDetailsPanel } from '../src/renderer/modules/geoint/EventDetailsPanel';
import type { GeoItem } from '../src/shared/post-mvp-types';

let container: HTMLDivElement;
let root: Root;
const render = (el: React.ReactElement): void => { act(() => root.render(el)); };
const clickButton = (re: RegExp): void => {
  const b = Array.from(container.querySelectorAll('button')).find((x) => re.test(x.textContent ?? ''));
  if (!b) throw new Error(`no button matching ${re}`);
  act(() => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};
const hasText = (re: RegExp): boolean =>
  Array.from(container.querySelectorAll<HTMLElement>('*')).some((el) => el.children.length === 0 && re.test(el.textContent ?? ''));

const mk = (o: Partial<GeoItem> & { id: string; sourceId: string }): GeoItem =>
  ({ title: o.id, located: 'geo', ...o } as GeoItem);
const target = mk({ id: 'T', sourceId: 'wt', title: 'US MILITARY STRIKE', category: 'chatter',
  lat: 50, lon: 30, country: 'UA', eventType: 'Military Strike', published: '2026-07-30T10:00:00Z' });
const reuters = mk({ id: 'A', sourceId: 'reuters', title: 'Strike reported', link: 'https://ex.org/a', lat: 50.02, lon: 30.02, published: '2026-07-30T09:00:00Z' });
const related = mk({ id: 'R', sourceId: 'reuters', title: 'Earlier strike', country: 'UA', eventType: 'Military Strike', lat: 51, lon: 31, published: '2026-07-28T10:00:00Z' });
const sources = [{ id: 'wt', label: 'War-Tracker' }, { id: 'reuters', label: 'Reuters World' }];

beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('EventDetailsPanel — SOURCES tab', () => {
  it('shows the distinct-other-source count and resolves labels', () => {
    render(<EventDetailsPanel item={target} allItems={[target, reuters, related]} sources={sources}
      onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/SOURCES/i);
    expect(hasText(/SOURCES \(1\)/)).toBe(true);          // one distinct OTHER source (reuters)
    expect(hasText(/^Reuters World$/)).toBe(true);
  });

  it('keeps the unverified social-OSINT stamp on a chatter-category source', () => {
    const chatterCorroborator = mk({ id: 'B', sourceId: 'tg', title: 'tg post', category: 'chatter', lat: 50.01, lon: 30.01, published: '2026-07-30T10:00:00Z' });
    render(<EventDetailsPanel item={target} allItems={[target, chatterCorroborator]}
      sources={[{ id: 'tg', label: 'Telegram' }]} onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/SOURCES/i);
    expect(hasText(/unverified social-OSINT/i)).toBe(true);
  });

  it('renders the related-in-region section', () => {
    render(<EventDetailsPanel item={target} allItems={[target, reuters, related]} sources={sources}
      onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/SOURCES/i);
    expect(hasText(/RELATED IN REGION/i)).toBe(true);
    expect(hasText(/^Earlier strike$/)).toBe(true);
  });

  it('opens a source link through onOpenLink (never a raw anchor)', () => {
    const onOpenLink = vi.fn();
    render(<EventDetailsPanel item={target} allItems={[target, reuters]} sources={sources}
      onClose={() => {}} onOpenLink={onOpenLink} onPin={() => {}} pinned={false} />);
    clickButton(/SOURCES/i);
    clickButton(/^Open$/);
    expect(onOpenLink).toHaveBeenCalledWith('https://ex.org/a');
  });

  it('does NOT render any authority tier label (no Official/Independent/Social)', () => {
    render(<EventDetailsPanel item={target} allItems={[target, reuters, related]} sources={sources}
      onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />);
    clickButton(/SOURCES/i);
    expect(hasText(/\bOfficial\b|\bIndependent\b/)).toBe(false);
    expect(hasText(/\bSocial\b(?!-OSINT)/)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/geoint-sources-tab.test.tsx`
Expected: FAIL — SOURCES button is `disabled` (Phase 1) so `fireEvent.click` shows no sources content; count text absent.

- [ ] **Step 3: Write minimal implementation**

In `EventDetailsPanel.tsx`: (a) mark SOURCES `live:true` in `TABS`; (b) add `allItems`/`sources` to `EventDetailsPanelProps`; (c) add `const [activeTab, setActiveTab] = React.useState<'overview'|'sources'>('overview')`, make live tab buttons call `setActiveTab(t.key as any)` with `aria-pressed={activeTab === t.key}`; (d) wrap the existing Overview sections in `{activeTab === 'overview' && (<>…</>)}`; (e) add the SOURCES block. Reuse `formatAbsolute`/`safeHref`. Compute:

```tsx
const corr = React.useMemo(() => corroboratingItems(item, allItems), [item, allItems]);
const distinctOther = React.useMemo(
  () => new Set(corr.filter((c) => c.item.sourceId !== item.sourceId).map((c) => c.item.sourceId)).size,
  [corr, item.sourceId]
);
const related = React.useMemo(
  () => relatedEvents(item, allItems, new Set(corr.map((c) => c.item.id))),
  [item, allItems, corr]
);
const [srcFilter, setSrcFilter] = React.useState<'all'|'this'|'other'>('all');
const shownCorr = corr.filter((c) =>
  srcFilter === 'all' ? true : srcFilter === 'this' ? c.item.sourceId === item.sourceId : c.item.sourceId !== item.sourceId);
```

Render (SOURCES tab): a `sectionStyle` block with `legendStyle` `SOURCES ({distinctOther})`, the three filter buttons (`setSrcFilter`), then `shownCorr.map` rows — each `sourceLabel(c.item.sourceId, sources)` · `formatAbsolute(c.item.published) || 'undated'` · `{c.distanceKm.toFixed(1)} km`, an `Open` button `disabled={!safeHref(c.item.link)}` calling `onOpenLink(c.item.link!)`, and — when `c.item.category === 'chatter'` — a `noteStyle` line `⚠ unverified social-OSINT`. Empty → "No other feeds reporting this event." Then a second `sectionStyle` block `legendStyle` `RELATED IN REGION`, `related.map` rows (title + `formatAbsolute` + Open), empty → "No related events in this region."

In `GeoIntModule.tsx` (the `<EventDetailsPanel …>` at ~1151), add:
```tsx
allItems={items}
sources={(snap?.sources ?? []).map((s) => ({ id: s.id, label: s.label }))}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/geoint-sources-tab.test.tsx`
Expected: PASS (4/4).

- [ ] **Step 5: Run the geoint suite + typecheck to catch regressions**

Run: `pnpm vitest run test/geoint-event-details-panel.test.tsx test/geoint-sources-tab.test.tsx && pnpm typecheck`
Expected: PASS; typecheck clean (new props supplied by the only caller).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/geoint/EventDetailsPanel.tsx src/renderer/modules/geoint/GeoIntModule.tsx test/geoint-sources-tab.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org \
  commit --no-verify -m "feat(geoint): SOURCES tab live — factual corroboration + related-in-region"
```

---

### Task 4: Group Regional Events view (CommandRail right-click → country filter)

**Files:**
- Modify: `src/renderer/modules/geoint/CommandRail.tsx` (add `onGroupRegion` prop + context-menu entry)
- Modify: `src/renderer/modules/geoint/GeoIntModule.tsx` (`regionFilter` state; apply to `visibleItems`; dismissable chip; pass `onGroupRegion`)
- Test: `test/geoint-group-region.test.tsx` (new)

**Interfaces:**
- Consumes: existing `visibleItems`, the CommandRail `ctxMenu`/`onViewDetails` pattern (lines 128-150), `GeoItem.country`.
- Produces: CommandRail prop `onGroupRegion: (id: string) => void;` and a **"Group regional events"** entry in the row context menu (below "View details"). Module: `const [regionFilter, setRegionFilter] = useState<string|null>(null)`; a pure helper `filterByRegion(items, country)` (exported for test) returning items whose `country` case-insensitively equals `country` (all items when `country` is null); `visibleItems` gains region filtering AFTER the timeline slice; a chip `Region: {regionFilter} ✕` (calls `setRegionFilter(null)`) rendered when set. Right-clicking a row → "Group regional events" sets `regionFilter` to that item's `country` (no-op with a `toast.warn` when the item has no country). View-only — nothing persisted.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { filterByRegion } from '../src/renderer/modules/geoint/GeoIntModule';
import type { GeoItem } from '../src/shared/post-mvp-types';

const mk = (o: Partial<GeoItem> & { id: string }): GeoItem =>
  ({ sourceId: 's', title: o.id, located: 'none', ...o } as GeoItem);

describe('filterByRegion', () => {
  const items = [mk({ id: 'A', country: 'UA' }), mk({ id: 'B', country: 'ua' }), mk({ id: 'C', country: 'PL' }), mk({ id: 'D' })];
  it('returns all items when no region is set', () => {
    expect(filterByRegion(items, null).map((i) => i.id)).toEqual(['A', 'B', 'C', 'D']);
  });
  it('filters case-insensitively by country, excluding items with no country', () => {
    expect(filterByRegion(items, 'UA').map((i) => i.id)).toEqual(['A', 'B']);
    expect(filterByRegion(items, 'pl').map((i) => i.id)).toEqual(['C']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/geoint-group-region.test.tsx`
Expected: FAIL — `filterByRegion is not exported`.

- [ ] **Step 3: Write minimal implementation**

In `GeoIntModule.tsx`, export the helper near the other module-scope helpers:
```tsx
/** View-only region grouping: items whose country matches `country` (case-insensitive). `null` → all.
 *  Items without a country are excluded when a region is active. Pure; nothing persisted. */
export function filterByRegion(items: GeoItem[], country: string | null): GeoItem[] {
  if (!country) return items;
  const c = country.trim().toLowerCase();
  return items.filter((i) => (i.country?.trim().toLowerCase() ?? '') === c);
}
```
Add `const [regionFilter, setRegionFilter] = useState<string | null>(null);`. Change the visible-set memo to apply region AFTER the timeline slice:
```tsx
const visibleItems = useMemo(
  () => filterByRegion(itemsUpTo(items, timeCursor), regionFilter),
  [items, timeCursor, regionFilter]
);
```
Add a `groupRegion` handler:
```tsx
const groupRegion = (id: string): void => {
  const it = items.find((i) => i.id === id);
  if (!it?.country) { toast.warn('This event has no country to group by.'); return; }
  setRegionFilter(it.country);
};
```
Render a chip in the globe-mode column header area (near the Events legend, line ~1055) when `regionFilter`:
```tsx
{regionFilter && (
  <button onClick={() => setRegionFilter(null)} title="Clear region grouping"
    style={{ fontSize: 10, padding: '2px 8px', margin: '0 0 4px' }}>Region: {regionFilter} ✕</button>
)}
```
Pass `onGroupRegion={groupRegion}` to `<CommandRail>`. In `CommandRail.tsx`, add `onGroupRegion: (id: string) => void;` to `CommandRailProps`, destructure it, and add below the "View details" menu row:
```tsx
<div role="menuitem" style={menuItemStyle}
  onClick={() => { onGroupRegion(ctxMenu.id); setCtxMenu(null); }}
>Group regional events</div>
```

- [ ] **Step 4: Run test to verify it passes + typecheck**

Run: `pnpm vitest run test/geoint-group-region.test.tsx && pnpm typecheck`
Expected: PASS (2/2); typecheck clean (new required CommandRail prop supplied by the module).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/geoint/CommandRail.tsx src/renderer/modules/geoint/GeoIntModule.tsx test/geoint-group-region.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org \
  commit --no-verify -m "feat(geoint): Group Regional Events — country view filter via row right-click"
```

---

### Task 5: DOM-contract test — SOURCES content lives inside the scroll-auto panel root

**Files:**
- Test: `test/geoint-sources-layout.test.tsx` (new — jsdom DOM-contract, mirroring the Phase 1 `geoint-event-details-layout.test.tsx`)

**Interfaces:**
- Consumes: `EventDetailsPanel` rendered inside a `.ga98-window-shell > .window > .window-body` wrapper.
- Produces: assertions that the panel root carries class `ga98-geo-details` (NOT `window` — so the `.window` stretch trap never applies) and inline `overflow-y: auto`, and that the SOURCES section is a DESCENDANT of that scroll-auto root (not a nested `.window`). jsdom has no layout engine, so this asserts the DOM/scroll-container contract only; the pixel-height computed-style check (long list scrolls internally, not stretched) is a **controller step** run post-implementation with the headless-Chrome harness WITH the `.ga98-window-shell` wrapper.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EventDetailsPanel } from '../src/renderer/modules/geoint/EventDetailsPanel';
import type { GeoItem } from '../src/shared/post-mvp-types';

let container: HTMLDivElement;
let root: Root;
const mk = (o: Partial<GeoItem> & { id: string; sourceId: string }): GeoItem =>
  ({ title: o.id, located: 'geo', ...o } as GeoItem);
const target = mk({ id: 'T', sourceId: 'wt', title: 'STRIKE', category: 'chatter', lat: 50, lon: 30, country: 'UA', eventType: 'Military Strike', published: '2026-07-30T10:00:00Z' });
const many = Array.from({ length: 40 }, (_, n) => mk({ id: `S${n}`, sourceId: `s${n}`, title: `report ${n}`, lat: 50.01, lon: 30.01, published: '2026-07-30T10:00:00Z' }));

beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('SOURCES tab — scroll-container contract', () => {
  it('renders the panel as a scroll-auto .ga98-geo-details root (not a .window), with SOURCES inside it', () => {
    act(() => root.render(
      <div className="ga98-window-shell" style={{ height: 600 }}>
        <div className="window"><div className="window-body">
          <EventDetailsPanel item={target} allItems={[target, ...many]}
            sources={many.map((m) => ({ id: m.sourceId, label: m.sourceId }))}
            onClose={() => {}} onOpenLink={() => {}} onPin={() => {}} pinned={false} />
        </div></div>
      </div>
    ));
    const panel = container.querySelector('.ga98-geo-details') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.classList.contains('window')).toBe(false);
    expect(panel.style.overflowY).toBe('auto');
    // switch to SOURCES and confirm its content is a descendant of the scroll-auto root
    const btn = Array.from(container.querySelectorAll('button')).find((b) => /SOURCES/i.test(b.textContent ?? ''))!;
    act(() => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const src = Array.from(panel.querySelectorAll<HTMLElement>('*')).find((el) => /SOURCES \(/i.test(el.textContent ?? ''));
    expect(src).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it passes honestly**

Run: `pnpm vitest run test/geoint-sources-layout.test.tsx`
Expected: PASS (`overflowY:auto` is already in `panelStyle`; SOURCES content is a panel descendant). If it FAILS because the SOURCES content was placed outside the panel root or inside a nested `.window`, that is a real finding — fix by keeping all tab content inside the single `.ga98-geo-details` root.

- [ ] **Step 3: Commit**

```bash
git add test/geoint-sources-layout.test.tsx
git -c user.name=onna-bugeisha-dev-team -c user.email=dev@onna-bugeisha.org \
  commit --no-verify -m "test(geoint): DOM-contract — SOURCES content inside the scroll-auto panel root"
```

---

## Self-Review

- **Spec coverage:** SOURCES tab = Task 1 (selector) + Task 3 (UI); *factual corroboration, no tiers* per the 2026-07-30 operator decision (supersedes the spec's Official/Independent/Social wording — recorded in Global Constraints). RELATED = Task 2 + Task 3. Group Regional Events = Task 4. Layout honesty = Task 5. War-tracker `category:'chatter'` unchanged (Global Constraints).
- **Type consistency:** `corroboratingItems`/`CorroboratingItem` (Task 1) consumed by Task 3; `relatedEvents`/`sourceLabel` (Task 2) consumed by Task 3; `filterByRegion` (Task 4) exported for its own test; `allItems`/`sources` prop names identical across Task 3's panel and the module wiring.
- **Placeholder scan:** none — every code and test step carries real code.
- **Charter:** no new egress/dependency; no fabricated authority; provenance stamp preserved; deterministic selectors; XSS-safe rendering.
