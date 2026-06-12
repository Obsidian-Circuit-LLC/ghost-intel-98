# EyeSpy Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace EyeSpy's flat stream list + single viewer with a Country→State/Region→City tree (rolled-up counts), a search box, and a live-capped tile grid, plus node-scoped import that stamps a selected location onto geo-less feeds.

**Architecture:** Pure logic (`tree.ts`, live-budget core) is split from React for headless vitest tests. The view recomposes `EyeSpyModule` into `LocationTree` (sidebar) + `CameraGrid` (tiles, ≤9 concurrent live players via `IntersectionObserver`) + an overlay `Viewer` (the existing per-kind player, extracted unchanged). Backend change is limited to threading an optional location `stamp` through the existing `streams:import` IPC.

**Tech Stack:** Electron + React + TypeScript, hls.js, vitest. Data already in `streams.json` via `CameraStream` (geo fields exist). Win98 CSS classes (`ga98-*`).

---

## Task 1: Location tree — types + `buildTree`

**Files:**
- Create: `src/renderer/modules/eyespy/tree.ts`
- Test: `test/eyespy-tree.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/eyespy-tree.test.ts
import { describe, it, expect } from 'vitest';
import { buildTree } from '../src/renderer/modules/eyespy/tree';
import type { CameraStream } from '../src/shared/post-mvp-types';

const s = (id: string, geo: Partial<CameraStream>): CameraStream => ({
  id, label: id, url: `https://cam/${id}.m3u8`, kind: 'hls', caseId: null, addedAt: '', notes: '', ...geo
});

describe('buildTree', () => {
  it('nests US three-level (country→region→city) and UK two-level (country→city)', () => {
    const tree = buildTree([
      s('a', { country: 'United States', region: 'Texas', city: 'Dallas' }),
      s('b', { country: 'United States', region: 'Texas', city: 'Austin' }),
      s('c', { country: 'United Kingdom', city: 'London' }) // no region
    ]);
    const us = tree.find((n) => n.label === 'United States')!;
    expect(us.level).toBe('country');
    expect(us.count).toBe(2);
    const tx = us.children.find((n) => n.label === 'Texas')!;
    expect(tx.level).toBe('region');
    expect(tx.children.map((c) => c.label)).toEqual(['Austin', 'Dallas']); // sorted
    const uk = tree.find((n) => n.label === 'United Kingdom')!;
    expect(uk.children.map((c) => c.label)).toEqual(['London']); // city promoted directly under country
    expect(uk.children[0].level).toBe('city');
  });

  it('rolls counts up and buckets country-less streams under Ungeocoded (always last)', () => {
    const tree = buildTree([
      s('a', { country: 'France', city: 'Paris' }),
      s('z', {}) // no geo
    ]);
    expect(tree.map((n) => n.label)).toEqual(['France', 'Ungeocoded']);
    expect(tree.find((n) => n.label === 'Ungeocoded')!.count).toBe(1);
  });

  it('a node streamIds includes every stream at or below it', () => {
    const tree = buildTree([
      s('a', { country: 'US', region: 'Texas', city: 'Dallas' }),
      s('b', { country: 'US', region: 'Texas' }) // region but no city
    ]);
    const us = tree.find((n) => n.label === 'US')!;
    expect([...us.streamIds].sort()).toEqual(['a', 'b']);
    const tx = us.children.find((n) => n.label === 'Texas')!;
    expect([...tx.streamIds].sort()).toEqual(['a', 'b']); // 'b' counts toward Texas though it has no city row
    expect(tx.children.map((c) => c.label)).toEqual(['Dallas']); // only the city-bearing stream gets a city row
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- eyespy-tree`
Expected: FAIL ("buildTree is not a function" / module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/renderer/modules/eyespy/tree.ts
import type { CameraStream } from '@shared/post-mvp-types';

export type TreeLevel = 'country' | 'region' | 'city';

export interface TreeNode {
  key: string;          // stable path, e.g. "United States/Texas/Dallas"
  label: string;
  level: TreeLevel;
  count: number;        // streams at or below this node
  streamIds: string[];  // ids at or below this node
  children: TreeNode[];
}

const UNGEO = 'Ungeocoded';
const norm = (v: string | undefined): string => (v ?? '').trim();

// Deterministic, locale-independent; Ungeocoded sinks to the bottom.
function cmpLabel(a: string, b: string): number {
  if (a === b) return 0;
  if (a === UNGEO) return 1;
  if (b === UNGEO) return -1;
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

export function buildTree(streams: CameraStream[]): TreeNode[] {
  // country -> region('' = none) -> city('' = none) -> ids
  const tree = new Map<string, Map<string, Map<string, string[]>>>();
  for (const s of streams) {
    const country = norm(s.country) || UNGEO;
    const region = norm(s.region);
    const city = norm(s.city);
    const rMap = tree.get(country) ?? new Map<string, Map<string, string[]>>();
    tree.set(country, rMap);
    const cMap = rMap.get(region) ?? new Map<string, string[]>();
    rMap.set(region, cMap);
    const ids = cMap.get(city) ?? [];
    cMap.set(city, ids);
    ids.push(s.id);
  }

  const out: TreeNode[] = [];
  for (const [country, rMap] of tree) {
    const countryIds: string[] = [];
    const countryChildren: TreeNode[] = [];
    for (const [region, cMap] of rMap) {
      const regionIds: string[] = [];
      const cityNodes: TreeNode[] = [];
      for (const [city, ids] of cMap) {
        regionIds.push(...ids);
        if (city) {
          cityNodes.push({ key: `${country}/${region}/${city}`, label: city, level: 'city', count: ids.length, streamIds: [...ids], children: [] });
        }
        // city === '' → stream has country (±region) but no city: counts toward region/country,
        // reachable by selecting that node, but gets no city row of its own.
      }
      countryIds.push(...regionIds);
      cityNodes.sort((a, b) => cmpLabel(a.label, b.label));
      if (region) {
        countryChildren.push({ key: `${country}/${region}`, label: region, level: 'region', count: regionIds.length, streamIds: [...regionIds], children: cityNodes });
      } else {
        countryChildren.push(...cityNodes); // no region tier → promote cities under the country
      }
    }
    countryChildren.sort((a, b) => cmpLabel(a.label, b.label));
    out.push({ key: country, label: country, level: 'country', count: countryIds.length, streamIds: countryIds, children: countryChildren });
  }
  out.sort((a, b) => cmpLabel(a.label, b.label));
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- eyespy-tree`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/eyespy/tree.ts test/eyespy-tree.test.ts
git commit -m "feat(eyespy): location tree builder (Country→Region→City, rolled-up counts)"
```

---

## Task 2: Tree/stream search — `matchStream` + `filterTree`

**Files:**
- Modify: `src/renderer/modules/eyespy/tree.ts`
- Test: `test/eyespy-tree.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

```ts
// append to test/eyespy-tree.test.ts
import { filterTree, matchStream } from '../src/renderer/modules/eyespy/tree';

describe('filterTree', () => {
  const streams = [
    s('a', { country: 'United States', region: 'Texas', city: 'Dallas' }),
    s('b', { country: 'United Kingdom', city: 'London' })
  ];
  const tree = buildTree(streams);

  it('empty query returns the tree unchanged', () => {
    expect(filterTree(tree, streams, '')).toBe(tree);
  });
  it('prunes to branches matching on city/region/country/url, case-insensitive', () => {
    const r = filterTree(tree, streams, 'dallas');
    expect(r.map((n) => n.label)).toEqual(['United States']);
    expect(r[0].children[0].label).toBe('Texas');
  });
  it('matchStream hits label/city/region/country/url', () => {
    expect(matchStream(streams[1], 'london')).toBe(true);
    expect(matchStream(streams[1], 'cam/b')).toBe(true);
    expect(matchStream(streams[1], 'texas')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- eyespy-tree`
Expected: FAIL (`filterTree`/`matchStream` not exported).

- [ ] **Step 3: Implement**

```ts
// append to src/renderer/modules/eyespy/tree.ts
export function matchStream(s: CameraStream, qLower: string): boolean {
  const hay = `${s.label} ${s.city ?? ''} ${s.region ?? ''} ${s.country ?? ''} ${s.url}`.toLowerCase();
  return hay.includes(qLower);
}

export function filterTree(nodes: TreeNode[], streams: CameraStream[], q: string): TreeNode[] {
  const query = q.trim().toLowerCase();
  if (!query) return nodes;
  const byId = new Map(streams.map((s) => [s.id, s] as const));
  const keep = (n: TreeNode): TreeNode | null => {
    const children = n.children.map(keep).filter((c): c is TreeNode => c !== null);
    const labelHit = n.label.toLowerCase().includes(query);
    const streamHit = n.streamIds.some((id) => { const st = byId.get(id); return !!st && matchStream(st, query); });
    return labelHit || streamHit || children.length > 0 ? { ...n, children } : null;
  };
  return nodes.map(keep).filter((c): c is TreeNode => c !== null);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- eyespy-tree`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/eyespy/tree.ts test/eyespy-tree.test.ts
git commit -m "feat(eyespy): search filter over tree + stream fields"
```

---

## Task 3: Node-scoped import — `feedToUpsert` stamp

**Files:**
- Modify: `src/main/services/feed-import.ts:228` (`feedToUpsert`)
- Test: `test/feed-import.test.ts` (extend; if absent, create)

- [ ] **Step 1: Add failing test**

```ts
// in test/feed-import.test.ts
import { feedToUpsert } from '../src/main/services/feed-import';

describe('feedToUpsert location stamp', () => {
  it('with no stamp, output is the feed unchanged', () => {
    expect(feedToUpsert({ label: 'x', url: 'https://c/x.m3u8', kind: 'hls' })).toEqual({ label: 'x', url: 'https://c/x.m3u8', kind: 'hls' });
  });
  it('stamp fills geo only where the feed lacks it (feed geo wins)', () => {
    const out = feedToUpsert({ label: 'x', url: 'https://c/x.m3u8', kind: 'hls', city: 'Austin' }, { country: 'United States', region: 'Texas', city: 'Dallas' });
    expect(out.country).toBe('United States');
    expect(out.region).toBe('Texas');
    expect(out.city).toBe('Austin'); // feed-provided city wins over the stamp
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- feed-import`
Expected: FAIL (`feedToUpsert` takes 1 arg / stamp ignored).

- [ ] **Step 3: Implement**

```ts
// src/main/services/feed-import.ts — replace feedToUpsert
export function feedToUpsert(
  f: ParsedFeed,
  stamp?: { country?: string; region?: string; city?: string }
): Pick<CameraStream, 'label' | 'url' | 'kind' | 'country' | 'region' | 'city' | 'lat' | 'lon' | 'source'> {
  const base: Partial<CameraStream> = {};
  if (stamp?.country) base.country = stamp.country;
  if (stamp?.region) base.region = stamp.region;
  if (stamp?.city) base.city = stamp.city;
  return { ...base, ...f }; // feed-provided geo overrides the stamp; streams.pickGeo trims/validates
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- feed-import`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/feed-import.ts test/feed-import.test.ts
git commit -m "feat(eyespy): feedToUpsert applies a location stamp to geo-less feeds"
```

---

## Task 4: Thread `stamp` through the import IPC + preload

**Files:**
- Modify: `src/main/ipc/register.ts:881` (import handler)
- Modify: `src/preload/index.ts:232`
- Modify: `src/preload/api.d.ts:286` (streams.import signature)

- [ ] **Step 1: Update the main handler**

```ts
// src/main/ipc/register.ts — streams.import handler
safeHandle(channels.streams.import, async (...args) => {
  const stamp = (args[0] ?? undefined) as { country?: string; region?: string; city?: string } | undefined;
  const win = getWindow();
  const r = win
    ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Camera feed list', extensions: ['csv', 'json', 'txt', 'm3u', 'm3u8'] }] })
    : await dialog.showOpenDialog({ properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return { added: 0, skipped: 0, total: 0 };
  const feeds = parseFeedList(await readFile(r.filePaths[0], 'utf8'));
  const seen = new Set((await streams.list()).map((s) => s.url.toLowerCase()));
  let added = 0;
  let skipped = 0;
  for (const f of feeds) {
    if (!ensureFeedUrl(f.url) || seen.has(f.url.toLowerCase())) { skipped++; continue; }
    await streams.upsert(feedToUpsert(f, stamp));
    seen.add(f.url.toLowerCase());
    added++;
  }
  return { added, skipped, total: feeds.length };
});
```

- [ ] **Step 2: Update preload**

```ts
// src/preload/index.ts
import: (stamp?: { country?: string; region?: string; city?: string }) =>
  ipcRenderer.invoke(channels.streams.import, stamp)
```

```ts
// src/preload/api.d.ts — within streams:
import: (stamp?: { country?: string; region?: string; city?: string }) => Promise<{ added: number; skipped: number; total: number }>;
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean (no callers break — `import()` with no arg still valid).

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts
git commit -m "feat(eyespy): pass optional location stamp through streams:import IPC"
```

---

## Task 5: Live-player budget — pure core + hook

**Files:**
- Create: `src/renderer/modules/eyespy/useLivePlayerBudget.ts`
- Test: `test/eyespy-budget.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/eyespy-budget.test.ts
import { describe, it, expect } from 'vitest';
import { admit, MAX_LIVE } from '../src/renderer/modules/eyespy/useLivePlayerBudget';

describe('admit (live-player budget core)', () => {
  it('never exceeds the cap, taking most-recently-visible first', () => {
    const order = Array.from({ length: 20 }, (_, i) => `c${i}`); // index 0 = most recent
    const live = admit(order, MAX_LIVE);
    expect(live.length).toBe(MAX_LIVE);
    expect(live[0]).toBe('c0');
    expect(live).not.toContain('c9');
  });
  it('dedupes and preserves first-seen order', () => {
    expect(admit(['a', 'b', 'a', 'c'], 9)).toEqual(['a', 'b', 'c']);
  });
  it('fewer visible than cap → all live', () => {
    expect(admit(['a', 'b'], 9)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- eyespy-budget`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/renderer/modules/eyespy/useLivePlayerBudget.ts
import { useCallback, useRef, useState } from 'react';

export const MAX_LIVE = 9;

/** Pure: given visible ids in most-recently-visible-first order, return the ≤max unique ids to keep live. */
export function admit(mruVisible: string[], max: number = MAX_LIVE): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of mruVisible) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** Tracks which tiles are visible (MRU order) and exposes a stable `isLive(id)` capped at `max`. */
export function useLivePlayerBudget(max: number = MAX_LIVE): {
  setVisible: (id: string, visible: boolean) => void;
  isLive: (id: string) => boolean;
} {
  const orderRef = useRef<string[]>([]);
  const [live, setLive] = useState<string[]>([]);
  const setVisible = useCallback((id: string, visible: boolean) => {
    const next = orderRef.current.filter((x) => x !== id);
    if (visible) next.unshift(id);
    orderRef.current = next;
    setLive(admit(next, max));
  }, [max]);
  const isLive = useCallback((id: string) => live.includes(id), [live]);
  return { setVisible, isLive };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test -- eyespy-budget`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/eyespy/useLivePlayerBudget.ts test/eyespy-budget.test.ts
git commit -m "feat(eyespy): live-player budget (cap 9, most-recently-visible wins)"
```

---

## Task 6: Extract `Viewer` with a `poster` mode

**Files:**
- Create: `src/renderer/modules/eyespy/Viewer.tsx`
- Modify: `src/renderer/modules/eyespy/EyeSpyModule.tsx` (import the extracted `Viewer`, delete the inline copy)

- [ ] **Step 1: Move `Viewer` to its own file, add `poster` prop**

Copy the existing `Viewer` function (EyeSpyModule.tsx:145-204) verbatim into `Viewer.tsx`, add the `Hls` import, export it, and add a `poster` short-circuit at the top of the body:

```tsx
// src/renderer/modules/eyespy/Viewer.tsx
import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import type { CameraStream } from '@shared/post-mvp-types';

export function Viewer({ stream, poster = false }: { stream: CameraStream; poster?: boolean }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [imgTick, setImgTick] = useState(0);

  // Hooks must run unconditionally; they no-op while poster (kind guards already gate them).
  useEffect(() => {
    if (poster || stream.kind !== 'http') return;
    const t = setInterval(() => setImgTick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, [poster, stream.kind]);

  useEffect(() => {
    if (poster || stream.kind !== 'hls') return;
    const video = videoRef.current;
    if (!video) return;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(stream.url);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
    video.src = stream.url;
    return;
  }, [poster, stream.kind, stream.url]);

  if (poster) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111', color: '#9ad', fontSize: 11 }}>
        ▶ {stream.label}
      </div>
    );
  }
  // ...the existing rtsp / mjpeg / http / mp4 / default branches, unchanged...
}
```

(Keep the existing five return branches exactly as they were.)

- [ ] **Step 2: Repoint EyeSpyModule**

In `EyeSpyModule.tsx`: delete the inline `function Viewer(...)`, and add `import { Viewer } from './Viewer';`. Leave the rest of the module as-is for now (Task 9 recomposes it).

- [ ] **Step 3: Typecheck + existing tests**

Run: `pnpm typecheck && pnpm test`
Expected: clean; all existing tests still pass (no behaviour change — `poster` defaults false).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/eyespy/Viewer.tsx src/renderer/modules/eyespy/EyeSpyModule.tsx
git commit -m "refactor(eyespy): extract Viewer (+poster mode) for reuse in the grid"
```

---

## Task 7: `LocationTree` sidebar

**Files:**
- Create: `src/renderer/modules/eyespy/LocationTree.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// src/renderer/modules/eyespy/LocationTree.tsx
import { useState } from 'react';
import type { TreeNode } from './tree';

export function LocationTree({ nodes, selectedKey, query, onQuery, onSelect }: {
  nodes: TreeNode[];
  selectedKey: string | null;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (node: TreeNode | null) => void;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <input className="ga98-text" placeholder="Search countries, cities, cameras…" value={query}
        onChange={(e) => onQuery(e.target.value)} style={{ margin: 4 }} />
      <div className="ga98-list" style={{ flex: 1, overflow: 'auto' }}>
        <div data-selected={selectedKey === null} onClick={() => onSelect(null)} style={{ cursor: 'pointer', padding: '2px 6px', fontWeight: 600 }}>
          All cameras
        </div>
        {nodes.map((n) => <Row key={n.key} node={n} depth={0} selectedKey={selectedKey} onSelect={onSelect} />)}
      </div>
    </div>
  );
}

function Row({ node, depth, selectedKey, onSelect }: {
  node: TreeNode; depth: number; selectedKey: string | null; onSelect: (n: TreeNode) => void;
}): JSX.Element {
  const [open, setOpen] = useState(depth === 0);
  const hasKids = node.children.length > 0;
  return (
    <div>
      <div data-selected={selectedKey === node.key}
        style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', padding: '2px 6px', paddingLeft: 6 + depth * 14 }}
        onClick={() => onSelect(node)}>
        {hasKids
          ? <span onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} style={{ width: 14, display: 'inline-block' }}>{open ? '▾' : '▸'}</span>
          : <span style={{ width: 14, display: 'inline-block' }} />}
        <span style={{ flex: 1 }}>{node.label}</span>
        <span style={{ fontSize: 10, opacity: 0.65 }}>{node.count}</span>
      </div>
      {open && hasKids && node.children.map((c) => <Row key={c.key} node={c} depth={depth + 1} selectedKey={selectedKey} onSelect={onSelect} />)}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/eyespy/LocationTree.tsx
git commit -m "feat(eyespy): LocationTree sidebar (collapsible, per-node counts, search box)"
```

---

## Task 8: `CameraGrid` tiles (live-capped + lazy)

**Files:**
- Create: `src/renderer/modules/eyespy/CameraGrid.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// src/renderer/modules/eyespy/CameraGrid.tsx
import { useEffect, useRef } from 'react';
import type { CameraStream } from '@shared/post-mvp-types';
import { Viewer } from './Viewer';
import { useLivePlayerBudget } from './useLivePlayerBudget';

export function CameraGrid({ streams, onExpand, onAdd }: {
  streams: CameraStream[];
  onExpand: (s: CameraStream) => void;
  onAdd: () => void;
}): JSX.Element {
  const { setVisible, isLive } = useLivePlayerBudget();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, padding: 6, overflow: 'auto', height: '100%', alignContent: 'start' }}>
      {streams.map((s) => (
        <Tile key={s.id} stream={s} live={isLive(s.id)} onVisible={setVisible} onExpand={() => onExpand(s)} />
      ))}
      <button onClick={onAdd} title="Add a camera feed"
        style={{ aspectRatio: '16 / 9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: '#888' }}>
        ＋
      </button>
    </div>
  );
}

function Tile({ stream, live, onVisible, onExpand }: {
  stream: CameraStream; live: boolean; onVisible: (id: string, v: boolean) => void; onExpand: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => onVisible(stream.id, e.isIntersecting), { threshold: 0.1 });
    io.observe(el);
    return () => { io.disconnect(); onVisible(stream.id, false); };
  }, [stream.id, onVisible]);
  return (
    <div ref={ref} onClick={onExpand} title={`${stream.label} — click to enlarge`}
      style={{ aspectRatio: '16 / 9', background: '#000', overflow: 'hidden', cursor: 'pointer', position: 'relative' }}>
      <Viewer stream={stream} poster={!live} />
      <div style={{ position: 'absolute', left: 0, bottom: 0, right: 0, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10, padding: '1px 4px' }}>
        {stream.label}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/eyespy/CameraGrid.tsx
git commit -m "feat(eyespy): CameraGrid tiles — lazy IntersectionObserver mount, ≤9 live, +Add tile"
```

---

## Task 9: Recompose `EyeSpyModule`

**Files:**
- Modify: `src/renderer/modules/eyespy/EyeSpyModule.tsx`

- [ ] **Step 1: Rebuild the module around tree + grid**

Replace the render body (and selection state) so that:
- State: `selectedNode: TreeNode | null`, `query: string`, `expanded: CameraStream | null`, plus the existing `streams`, `cases`, `draft`, and a `showForm: boolean`.
- Derive: `const tree = useMemo(() => filterTree(buildTree(streams), streams, query), [streams, query]);`
  and `const shown = useMemo(() => selectedNode ? streams.filter((s) => new Set(selectedNode.streamIds).has(s.id)) : streams, [selectedNode, streams]);` (further narrowed by `query` via `matchStream` when a query is set).
- Left pane: `<LocationTree nodes={tree} selectedKey={selectedNode?.key ?? null} query={query} onQuery={setQuery} onSelect={setSelectedNode} />`.
- Header bar (above the grid): the selected node's path + count, an **"Import here"** button (calls `window.api.streams.import(nodeStamp(selectedNode))`), a global **"Import feeds…"** (no stamp), and **"Purge all…"**.
- Right pane: `expanded ? <div className="ga98-pane" style={{background:'#000'}}><button onClick={() => setExpanded(null)}>← Back</button><Viewer stream={expanded} /></div> : <CameraGrid streams={shown} onExpand={setExpanded} onAdd={() => setShowForm(true)} />`.
- The add/edit form (existing JSX) renders inside a small modal/panel gated by `showForm` (or `draft.id`); `save()` then `setShowForm(false)`.
- Helper:

```ts
function nodeStamp(n: TreeNode | null): { country?: string; region?: string; city?: string } | undefined {
  if (!n) return undefined;
  const parts = n.key.split('/'); // country / region / city
  return { country: parts[0] === 'Ungeocoded' ? undefined : parts[0], region: parts[1] || undefined, city: parts[2] || undefined };
}
```

Keep `save`, `edit`, `del`, `purge`, `refresh` as-is; `importFeeds` gains an optional stamp arg:

```ts
async function importFeeds(stamp?: { country?: string; region?: string; city?: string }): Promise<void> {
  try {
    const r = await window.api.streams.import(stamp);
    await refresh();
    if (r.total === 0) { toast.warn('No camera feeds found in that file.'); return; }
    toast.success(`Imported ${r.added} feed${r.added === 1 ? '' : 's'}${r.skipped ? ` · skipped ${r.skipped} (duplicate/invalid)` : ''}.`);
  } catch (err) { toast.error(`Import failed: ${(err as Error).message}`); }
}
```

- [ ] **Step 2: Typecheck + full test**

Run: `pnpm typecheck && pnpm test`
Expected: clean; all suites green (the new pure suites + unchanged existing ones).

- [ ] **Step 3: Build sanity**

Run: `pnpm build`
Expected: succeeds (renderer bundle builds).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/eyespy/EyeSpyModule.tsx
git commit -m "feat(eyespy): recompose into tree + camera grid, node-scoped Import here"
```

---

## Task 10: Docs touch (deferred to the next release bump)

Do **not** bump the version here — this lands behind the v3.14.0-beta.x line and ships when the operator
cuts the next build. When that happens, add an EyeSpy grid bullet to `README.md` Status + changelog and a
release-notes entry, and update the test count. (Left as a release-time step, not a code task.)

---

## Verification

- `pnpm typecheck` clean; `pnpm test` green (new: `eyespy-tree`, `eyespy-budget`, extended `feed-import`).
- `pnpm build` succeeds.
- Manual (operator/GhostExodus on Windows packaged build): import an archive into "London" → tree shows
  `United Kingdom › London (N)`; select it → grid shows tiles, at most 9 live + posters, scroll lazily
  mounts/unmounts; type "dallas" → tree prunes to US › Texas › Dallas; click a tile → large viewer; "Back"
  returns to the grid. Confirm no app freeze on a large (60+ camera) node.
- Charter: no new egress/telemetry; the cap also bounds concurrent connections (matters over Tor).

## Self-Review notes

- Type consistency: `TreeNode` (Task 1) is consumed unchanged by `filterTree` (2), `LocationTree` (7),
  `CameraGrid` selection (9). `feedToUpsert(f, stamp?)` (3) matches the IPC caller (4) and `nodeStamp` shape (9).
- `admit`/`useLivePlayerBudget` (5) are the only concurrency control; `MAX_LIVE = 9` is the single knob.
- No placeholder steps; every code step shows complete code except Task 9's render recompose, which is
  described against the existing JSX it edits (the form/handlers already exist verbatim in the file).
