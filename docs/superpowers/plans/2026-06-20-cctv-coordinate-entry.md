# Manual CCTV Coordinate Entry + Master Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator manually set a camera feed's latitude/longitude (so it pins on the GeoINT map) and export the camera library back to a master CCTV JSON file.

**Architecture:** Extend the existing EyeSpy "Set location…" dialog with lat/lon inputs (single-target, both-or-neither, range-validated) that persist through the existing `streams.upsert` path; harden main-side `pickGeo` to range-gate + pair coordinates; add a pure `streamsToMasterTree` builder + a `streams:exportCctv` IPC handler + a Finder "Export CCTV…" button.

**Tech Stack:** Electron (main + preload + renderer), React, vitest (node env, pure-function tests), the in-vault `streams.json` store.

**Spec:** `docs/superpowers/specs/2026-06-20-cctv-coordinate-entry-design.md`

## Global Constraints

- **Main is the trust boundary.** Coordinate range-gating (lat ∈ [−90,90], lon ∈ [−180,180]) MUST happen in main (`pickGeo`); the renderer's own validation is defense-in-depth. Coordinates are kept only as a valid **pair** — a lone or out-of-range coordinate drops both.
- **Multi-target safety:** the "Set location…" dialog must NOT alter coordinates when more than one camera is selected (bulk country/region/city stamping must preserve each camera's existing lat/lon). Coordinate inputs render only for a single target.
- **Export round-trips:** `streamsToMasterTree` output, re-parsed by the existing `feed-import.ts` `parseFeedList`, must yield back the same url + coordinates + country/region/city.
- **Export safety:** the export handler refuses a symlink target (mirror `media.savePlaylist`) and returns `null` on cancel.
- No new egress host, no coordinate geocoding/probing, no telemetry, no new dependency.
- Test style: vitest **node** env, pure-function tests only. No React render harness (no `@testing-library`). JSX wrappers are thin; verified by typecheck + the operator's manual smoke.
- `Master_CCTV.json` is **reference-only** — never committed; tests use small inline fixtures.

---

## Task 1: Pure master-tree builder `cctv-export.ts`

**Files:**
- Create: `src/main/services/cctv-export.ts`
- Test: `test/cctv-export.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/cctv-export.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { streamsToMasterTree } from '../src/main/services/cctv-export';
import { parseFeedList } from '../src/main/services/feed-import';
import type { CameraStream } from '../src/shared/post-mvp-types';

function cam(p: Partial<CameraStream> & { url: string }): CameraStream {
  return { id: p.id ?? p.url, label: p.label ?? 'c', url: p.url, kind: p.kind ?? 'mjpeg', caseId: null, addedAt: '2026-01-01T00:00:00Z', notes: '', ...p };
}

describe('streamsToMasterTree', () => {
  it('groups by country/region/city and emits coordinates when present', () => {
    const tree = streamsToMasterTree([
      cam({ url: 'http://a/1', country: 'Australia', region: 'New South Wales', city: 'Sydney', lat: -33.86785, lon: 151.20732 })
    ]);
    expect(tree).toEqual({
      Australia: { 'New South Wales': { Sydney: [{ stream_url: 'http://a/1', coordinates: { latitude: -33.86785, longitude: 151.20732 } }] } }
    });
  });

  it('omits coordinates when lat/lon are absent', () => {
    const tree = streamsToMasterTree([cam({ url: 'http://a/2', country: 'Armenia', region: 'Erevan', city: 'Yerevan' })]);
    expect(tree.Armenia.Erevan.Yerevan).toEqual([{ stream_url: 'http://a/2' }]);
  });

  it('buckets missing geo levels under "Unknown"', () => {
    const tree = streamsToMasterTree([cam({ url: 'http://a/3' })]);
    expect(tree).toEqual({ Unknown: { Unknown: { Unknown: [{ stream_url: 'http://a/3' }] } } });
  });

  it('emits country/region/city keys in sorted order', () => {
    const tree = streamsToMasterTree([
      cam({ url: 'http://a/z', country: 'Zambia', region: 'R', city: 'C' }),
      cam({ url: 'http://a/a', country: 'Angola', region: 'R', city: 'C' })
    ]);
    expect(Object.keys(tree)).toEqual(['Angola', 'Zambia']);
  });

  it('keeps multiple cameras in the same city in stable input order', () => {
    const tree = streamsToMasterTree([
      cam({ url: 'http://a/first', country: 'X', region: 'Y', city: 'Z' }),
      cam({ url: 'http://a/second', country: 'X', region: 'Y', city: 'Z' })
    ]);
    expect(tree.X.Y.Z.map((c) => c.stream_url)).toEqual(['http://a/first', 'http://a/second']);
  });

  it('round-trips through feed-import parseFeedList (url + coords + path stamps)', () => {
    const tree = streamsToMasterTree([
      cam({ url: 'http://a/rt', country: 'Australia', region: 'New South Wales', city: 'Sydney', lat: -33.86785, lon: 151.20732 })
    ]);
    const parsed = parseFeedList(JSON.stringify(tree));
    const f = parsed.find((p) => p.url === 'http://a/rt')!;
    expect(f).toBeDefined();
    expect(f.lat).toBe(-33.86785);
    expect(f.lon).toBe(151.20732);
    expect(f.country).toBe('Australia');
    expect(f.region).toBe('New South Wales');
    expect(f.city).toBe('Sydney');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run test/cctv-export.test.ts`
Expected: FAIL — cannot resolve `../src/main/services/cctv-export`.

- [ ] **Step 3: Create `cctv-export.ts`**

```ts
/**
 * Inverse of feed-import's parseNestedTree: rebuild the 4-level master CCTV tree
 * (Country → Region → City → [{ stream_url, coordinates? }]) from the flat CameraStream library, so
 * the operator can export their (coordinate-edited) corpus back to a re-importable master_CCTV.json.
 *
 * - coordinates are emitted ONLY when both lat & lon are present (post-pickGeo they are a range-valid
 *   pair); otherwise the key is omitted, matching the reference master shape.
 * - missing country/region/city bucket under the literal "Unknown" so every camera is representable
 *   and the tree stays 4 levels deep (round-trips through parseNestedTree, which stamps the path back
 *   into country/region/city).
 * - deterministic: country/region/city keys sorted; cameras within a city in stable input order.
 */
import type { CameraStream } from '@shared/post-mvp-types';

export interface MasterCamera {
  stream_url: string;
  coordinates?: { latitude: number; longitude: number };
}
export type MasterTree = Record<string, Record<string, Record<string, MasterCamera[]>>>;

const UNKNOWN = 'Unknown';

export function streamsToMasterTree(streams: CameraStream[]): MasterTree {
  const tree: MasterTree = {};
  for (const s of streams) {
    const country = (s.country && s.country.trim()) || UNKNOWN;
    const region = (s.region && s.region.trim()) || UNKNOWN;
    const city = (s.city && s.city.trim()) || UNKNOWN;
    const cam: MasterCamera = { stream_url: s.url };
    if (typeof s.lat === 'number' && Number.isFinite(s.lat) && typeof s.lon === 'number' && Number.isFinite(s.lon)) {
      cam.coordinates = { latitude: s.lat, longitude: s.lon };
    }
    const c = (tree[country] ??= {});
    const r = (c[region] ??= {});
    const arr = (r[city] ??= []);
    arr.push(cam);
  }
  return sortTree(tree);
}

/** Re-emit the tree with country/region/city keys in sorted order (non-numeric string keys preserve
 *  insertion order in JS, so a sorted rebuild gives deterministic output). City arrays keep order. */
function sortTree(tree: MasterTree): MasterTree {
  const out: MasterTree = {};
  for (const country of Object.keys(tree).sort()) {
    out[country] = {};
    for (const region of Object.keys(tree[country]).sort()) {
      out[country][region] = {};
      for (const city of Object.keys(tree[country][region]).sort()) {
        out[country][region][city] = tree[country][region][city];
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run test/cctv-export.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/cctv-export.ts test/cctv-export.test.ts
git commit -m "feat(cctv): pure streamsToMasterTree builder (inverse of feed-import)"
```

---

## Task 2: Harden `pickGeo` — range-gate + pair coordinates

**Files:**
- Modify: `src/main/services/streams.ts`
- Test: `test/streams-pickgeo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/streams-pickgeo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickGeo } from '../src/main/services/streams';

describe('pickGeo coordinate gating', () => {
  it('keeps an in-range lat/lon pair', () => {
    expect(pickGeo({ lat: -33.8, lon: 151.2 })).toEqual({ lat: -33.8, lon: 151.2 });
  });
  it('drops BOTH when lat is out of range', () => {
    const g = pickGeo({ lat: 500, lon: 151.2 });
    expect(g.lat).toBeUndefined();
    expect(g.lon).toBeUndefined();
  });
  it('drops BOTH when lon is out of range', () => {
    const g = pickGeo({ lat: 33.8, lon: 999 });
    expect(g.lat).toBeUndefined();
    expect(g.lon).toBeUndefined();
  });
  it('drops a lone latitude (no longitude)', () => {
    expect(pickGeo({ lat: 33.8 }).lat).toBeUndefined();
  });
  it('drops a lone longitude (no latitude)', () => {
    expect(pickGeo({ lon: 151.2 }).lon).toBeUndefined();
  });
  it('drops a non-finite coordinate', () => {
    expect(pickGeo({ lat: NaN, lon: 10 })).toEqual({});
  });
  it('keeps country/region/city independently of coordinates', () => {
    expect(pickGeo({ country: 'Australia', city: 'Sydney', lat: 500, lon: 1 })).toEqual({ country: 'Australia', city: 'Sydney' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run test/streams-pickgeo.test.ts`
Expected: FAIL — `pickGeo` is not exported (and the lone/out-of-range cases would not yet pass).

- [ ] **Step 3: Edit `pickGeo` in `streams.ts`**

Replace the existing `function pickGeo(...) {...}` (lines 34-48) with an EXPORTED, paired+range-gated version:

```ts
/**
 * Collect only the geo fields that are present and well-formed, so a stream without location data
 * keeps NO geo keys on disk (rather than a litter of null/NaN). country/region/city are independent
 * trimmed strings. lat/lon are kept ONLY as a valid PAIR — both finite and in range
 * (lat ∈ [-90,90], lon ∈ [-180,180]); a lone or out-of-range coordinate can never produce a map pin
 * (validCoord), so it is dropped wholesale. This is the main-side trust gate: the untrusted
 * renderer's own validation is defense-in-depth. Exported for unit testing.
 */
export function pickGeo(i: Partial<CameraStream>): Partial<CameraStream> {
  const g: Partial<CameraStream> = {};
  if (typeof i.country === 'string' && i.country.trim()) g.country = i.country.trim();
  if (typeof i.region === 'string' && i.region.trim()) g.region = i.region.trim();
  if (typeof i.city === 'string' && i.city.trim()) g.city = i.city.trim();
  if (
    typeof i.lat === 'number' && Number.isFinite(i.lat) && i.lat >= -90 && i.lat <= 90 &&
    typeof i.lon === 'number' && Number.isFinite(i.lon) && i.lon >= -180 && i.lon <= 180
  ) {
    g.lat = i.lat;
    g.lon = i.lon;
  }
  if (typeof i.source === 'string' && i.source.trim()) g.source = i.source.trim();
  return g;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run test/streams-pickgeo.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the existing streams/feed tests to confirm no regression**

Run: `pnpm exec vitest run test/feed-import.test.ts`
Expected: PASS (the importer supplies lat/lon as a pair, so pairing does not regress it). If there is no such file, skip; the full suite at the end covers it.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: OK.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/streams.ts test/streams-pickgeo.test.ts
git commit -m "fix(cctv): pickGeo range-gates + pairs lat/lon (main-side trust gate)"
```

---

## Task 3: Coordinate inputs in `SetLocationDialog` + `parseCoordPair`

**Files:**
- Modify: `src/renderer/modules/eyespy/SetLocationDialog.tsx`
- Modify: `src/renderer/modules/eyespy/EyeSpyModule.tsx` (`applyLoc`)
- Test: `test/setlocation-coords.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/setlocation-coords.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCoordPair } from '../src/renderer/modules/eyespy/SetLocationDialog';

describe('parseCoordPair', () => {
  it('both blank ⇒ ok with no coords (clears)', () => {
    expect(parseCoordPair('', '')).toEqual({ ok: true });
    expect(parseCoordPair('   ', '  ')).toEqual({ ok: true });
  });
  it('exactly one blank ⇒ error', () => {
    expect(parseCoordPair('33.8', '').ok).toBe(false);
    expect(parseCoordPair('', '151.2').ok).toBe(false);
  });
  it('valid pair ⇒ ok with numbers', () => {
    expect(parseCoordPair('-33.86785', '151.20732')).toEqual({ ok: true, lat: -33.86785, lon: 151.20732 });
  });
  it('non-numeric ⇒ error', () => {
    expect(parseCoordPair('north', '151').ok).toBe(false);
  });
  it('lat out of range ⇒ error', () => {
    expect(parseCoordPair('500', '10').ok).toBe(false);
  });
  it('lon out of range ⇒ error', () => {
    expect(parseCoordPair('10', '999').ok).toBe(false);
  });
  it('trims surrounding whitespace', () => {
    expect(parseCoordPair('  10 ', ' 20 ')).toEqual({ ok: true, lat: 10, lon: 20 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run test/setlocation-coords.test.ts`
Expected: FAIL — `parseCoordPair` not exported.

- [ ] **Step 3: Rewrite `SetLocationDialog.tsx`**

```tsx
import { useState } from 'react';
import type { CameraStream } from '@shared/post-mvp-types';
import { toast } from '../../state/toasts';

export type CoordParse = { ok: true; lat?: number; lon?: number } | { ok: false; error: string };

/** Validate the lat/lon text pair for a single feed. Both blank ⇒ ok with no coords (clears).
 *  Exactly one blank ⇒ error. Non-numeric or out-of-range ⇒ error. Pure (unit-tested). */
export function parseCoordPair(latStr: string, lonStr: string): CoordParse {
  const a = latStr.trim();
  const b = lonStr.trim();
  if (a === '' && b === '') return { ok: true };
  if (a === '' || b === '') return { ok: false, error: 'Enter both latitude and longitude, or leave both blank.' };
  const lat = Number(a);
  const lon = Number(b);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, error: 'Latitude and longitude must be numbers.' };
  if (lat < -90 || lat > 90) return { ok: false, error: 'Latitude must be between -90 and 90.' };
  if (lon < -180 || lon > 180) return { ok: false, error: 'Longitude must be between -180 and 180.' };
  return { ok: true, lat, lon };
}

export interface SetLocationApply {
  country: string;
  region: string;
  city: string;
  /** Present only for a single-target edit; when present it is authoritative (set or clear).
   *  Absent for multi-target, so existing per-camera coordinates are preserved. */
  coords?: { lat?: number; lon?: number };
}

export function SetLocationDialog({ targets, onApply, onClose }: {
  targets: CameraStream[];
  onApply: (geo: SetLocationApply) => void;
  onClose: () => void;
}): JSX.Element {
  const seed = targets[0] ?? {};
  const single = targets.length === 1;
  const [country, setCountry] = useState(seed.country ?? '');
  const [region, setRegion] = useState(seed.region ?? '');
  const [city, setCity] = useState(seed.city ?? '');
  const [lat, setLat] = useState(seed.lat != null ? String(seed.lat) : '');
  const [lon, setLon] = useState(seed.lon != null ? String(seed.lon) : '');

  function apply(): void {
    const base: SetLocationApply = { country: country.trim(), region: region.trim(), city: city.trim() };
    if (single) {
      const c = parseCoordPair(lat, lon);
      if (!c.ok) { toast.error(c.error); return; }
      base.coords = { lat: c.lat, lon: c.lon }; // both undefined ⇒ clear
    }
    onApply(base);
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <fieldset style={{ background: '#c0c0c0', minWidth: 280 }}>
        <legend>Set location ({targets.length} feed{targets.length === 1 ? '' : 's'})</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 4 }}>
          <label>Country:</label><input className="ga98-text" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="United Kingdom" />
          <label>State/Region:</label><input className="ga98-text" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="(optional)" />
          <label>City:</label><input className="ga98-text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="London" />
          {single && <>
            <label>Latitude:</label><input className="ga98-text" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-90 … 90 (optional)" />
            <label>Longitude:</label><input className="ga98-text" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="-180 … 180 (optional)" />
          </>}
        </div>
        {single && <div style={{ fontSize: 10, opacity: 0.65, marginTop: 4 }}>Set both to drop a map pin; clear both to remove it.</div>}
        <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
          <button onClick={apply}>Apply</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </fieldset>
    </div>
  );
}
```

- [ ] **Step 4: Update `applyLoc` in `EyeSpyModule.tsx`**

Replace the existing `applyLoc` (lines 234-241) so coordinates are authoritative for a single target and untouched for multi-target. Also update the `SetLocationDialog` import if needed (the type is inferred via the callback, so no import change is required, but ensure the callback param is typed via the dialog's `SetLocationApply`):

```tsx
  const applyLoc = async (geo: { country: string; region: string; city: string; coords?: { lat?: number; lon?: number } }): Promise<void> => {
    // Spread ...t to preserve label/url/kind/etc. Multi-target: no `coords` key ⇒ each camera's
    // existing lat/lon is preserved. Single-target: `coords` is authoritative — set OR clear (the
    // service's pickGeo drops undefined/out-of-range coords).
    for (const t of setLocTargets!) {
      const base: Partial<CameraStream> & { url: string; label: string; kind: CameraStream['kind'] } =
        { ...t, country: geo.country, region: geo.region, city: geo.city };
      if (geo.coords) { base.lat = geo.coords.lat; base.lon = geo.coords.lon; }
      await window.api.streams.upsert(base);
    }
    setSetLocTargets(null);
    await refresh();
  };
```

(The render line `<SetLocationDialog ... onApply={(g) => void applyLoc(g)} ... />` already passes the geo object through unchanged — no edit needed there. `CameraStream` is already imported in `EyeSpyModule.tsx`.)

- [ ] **Step 5: Run the coord test to verify it passes**

Run: `pnpm exec vitest run test/setlocation-coords.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: OK.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/eyespy/SetLocationDialog.tsx src/renderer/modules/eyespy/EyeSpyModule.tsx test/setlocation-coords.test.ts
git commit -m "feat(cctv): lat/lon inputs in Set location dialog (single-target, validated)"
```

---

## Task 4: Export wiring — `streams:exportCctv` IPC + Finder "Export CCTV…" button

**Files:**
- Modify: `src/shared/ipc-contracts.ts` (streams channel)
- Modify: `src/main/ipc/register.ts` (handler + import)
- Modify: `src/preload/index.ts` (bridge)
- Modify: `src/preload/api.d.ts` (type)
- Modify: `src/renderer/modules/eyespy/Finder.tsx` (button + prop)
- Modify: `src/renderer/modules/eyespy/EyeSpyModule.tsx` (`onExport` + pass to Finder)

This task is glue (a save-dialog handler + a button). It is verified by `pnpm typecheck` + the Task 1 builder test + the operator's manual smoke; there is no pure unit to add.

- [ ] **Step 1: Add the IPC channel**

In `src/shared/ipc-contracts.ts`, the `streams` block (lines 219-226) gains `exportCctv`:

```ts
  streams: {
    list: 'streams:list',
    upsert: 'streams:upsert',
    delete: 'streams:delete',
    clear: 'streams:clear',
    import: 'streams:import',
    detect: 'streams:detect',
    exportCctv: 'streams:exportCctv'
  },
```

- [ ] **Step 2: Add the main handler**

In `src/main/ipc/register.ts`, add the import near the other service imports (top of file, alongside `streams`):

```ts
import { streamsToMasterTree } from '../services/cctv-export';
```

Then, in the `// ---- streams (EyeSpy) ----` section (after the `channels.streams.clear` handler), add:

```ts
  safeHandle(channels.streams.exportCctv, async () => {
    const tree = streamsToMasterTree(await streams.list());
    const win = getWindow();
    const r = win
      ? await dialog.showSaveDialog(win, { defaultPath: 'master_CCTV.json' })
      : await dialog.showSaveDialog({ defaultPath: 'master_CCTV.json' });
    if (r.canceled || !r.filePath) return null;
    // Refuse a symlink target so an export can't be redirected to overwrite another file.
    try { const st = await lstat(r.filePath); if (st.isSymbolicLink()) throw new Error('Refusing to write to a symbolic link.'); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
    await writeFile(r.filePath, JSON.stringify(tree, null, 2), 'utf8');
    return basename(r.filePath);
  });
```

(`dialog`, `writeFile`, `lstat`, `basename`, and `getWindow` are already imported/in scope — see `register.ts:17-19,241` and the `media.savePlaylist` handler.)

- [ ] **Step 3: Add the preload bridge**

In `src/preload/index.ts`, the `streams` bridge (lines 253-259) gains:

```ts
    exportCctv: () => ipcRenderer.invoke(channels.streams.exportCctv),
```

(Add a comma after the `detect` line and insert this as the last entry.)

- [ ] **Step 4: Add the API type**

In `src/preload/api.d.ts`, the `streams` interface (lines 309-318) gains, after `detect`:

```ts
    /** Export the camera library to a master CCTV JSON file (Country→Region→City→[{stream_url,
     *  coordinates?}]) via a save dialog. Returns the saved filename, or null if cancelled. */
    exportCctv(): Promise<string | null>;
```

- [ ] **Step 5: Add the `onExport` prop + button to `Finder.tsx`**

In `src/renderer/modules/eyespy/Finder.tsx`, add `onExport` to the destructured props (line 7) and the props type (after `onImport: () => void;` on line 19):

```tsx
  onExport: () => void;
```

Then add the button in the action row (the `<div>` containing Refresh + Import, around lines 57-61), after the Import button:

```tsx
        <button onClick={onExport} title="Export the whole camera library to a master CCTV JSON file (re-importable).">Export CCTV…</button>
```

(Always enabled — the handler reads the full library via `streams.list()`, not the current view; an empty library simply exports `{}`.)

- [ ] **Step 6: Wire `onExport` in `EyeSpyModule.tsx`**

Add an `onExport` handler near `onImport` (after line 243):

```tsx
  const onExport = (): void => void (async () => {
    try {
      const name = await window.api.streams.exportCctv();
      if (name) toast.success(`Exported ${name}.`);
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    }
  })();
```

Then pass it to `<Finder ... />` (the props list around line 298): add `onExport={onExport}` alongside `onImport={onImport}`.

(`toast` is already imported in `EyeSpyModule.tsx`.)

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: OK (both tsconfig targets — note the channel is added to the shared contract, used by main + preload + renderer).

- [ ] **Step 8: Run the builder test (still green) and commit**

Run: `pnpm exec vitest run test/cctv-export.test.ts`
Expected: PASS.

```bash
git add src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts src/renderer/modules/eyespy/Finder.tsx src/renderer/modules/eyespy/EyeSpyModule.tsx
git commit -m "feat(cctv): streams:exportCctv IPC + EyeSpy 'Export CCTV…' button"
```

---

## Verification (whole-branch, after all tasks)

- [ ] `pnpm typecheck` — both targets OK.
- [ ] `pnpm test` — full suite green (new: `cctv-export`, `streams-pickgeo`, `setlocation-coords`).
- [ ] Trust-gate audit: confirm coordinates are range-gated in `pickGeo` (main) regardless of renderer input; export handler refuses symlink + returns null on cancel; no new egress host/IPC beyond `streams:exportCctv`; no telemetry.
- [ ] Manual smoke (operator): EyeSpy → right-click a camera → "Set location…" → enter lat/lon → Apply → the camera appears as a GeoINT map pin; clearing both lat/lon removes the pin; entering only one shows the validation toast; multi-select set-location still only edits country/region/city (existing pins preserved). Then Finder "Export CCTV…" → save → reopen/re-import the file and confirm the coordinates round-trip.

## Parked / out of scope

- Geocoding (city ↔ coordinates); a from-scratch "add camera in GeoINT" form. Coordinates are hand-entered; EyeSpy already adds feeds.
