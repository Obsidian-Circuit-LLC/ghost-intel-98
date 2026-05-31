# GeoINT ↔ Case Integration (cycle 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a GeoINT event be saved into a case (as a record, link, or note), auto-link a location entity, link manual entities, and emit a `geo-event` timeline entry.

**Architecture:** A single main-process orchestrator (`saveToCase`) composes the existing self-locking case/entity/note stores; saved-event records persist in a per-case `geo-events.json` sidecar. The geocoder is extended to return the matched place name so a `location` entity can be auto-created. All local, vault-gated, no new egress.

**Tech Stack:** Electron 33, React 18, TS strict, secure-fs, vitest.

**Spec:** `docs/superpowers/specs/2026-05-31-geoint-case-integration-design.md`

---

## File structure

**Create:**
- `src/main/geoint/case-events.ts` — `geo-events.json` per-case sidecar store.
- `src/main/geoint/save-to-case.ts` — `saveToCase` orchestrator.
- `src/renderer/modules/geoint/SaveEventDialog.tsx` — case picker + form + entity multiselect.
- `test/geoint-case-events.test.ts`, `test/geoint-save-to-case.test.ts`.

**Modify:**
- `src/main/geoint/geocode.ts` — geocoder returns `{lat,lon,name}`.
- `src/main/geoint/feeds.ts` — record `place` on located items.
- `src/shared/post-mvp-types.ts` — `GeoItem.place?`, `SavedGeoEvent`.
- `src/shared/types.ts` — `'geo-event'` in `TimelineKind` + `TIMELINE_KINDS`.
- `src/shared/ipc-contracts.ts`, `src/main/ipc/register.ts`, `src/main/security/validate.ts`, `src/preload/index.ts`, `src/preload/api.d.ts` — `geoint.saveToCase/listCaseEvents/removeCaseEvent`.
- `src/renderer/modules/geoint/GeoIntModule.tsx` — "Save to case…" action.
- `src/renderer/modules/cases/CaseDetail.tsx` — "GeoINT events" section.
- Update `test/geoint-geocode.test.ts`, `test/geoint-feeds.test.ts`.

---

## Stage 1 — Cycle-1 tweak: geocoder returns the matched name

### Task 1.1: `Geocoder` returns `{lat,lon,name}`

**Files:** Modify `src/main/geoint/geocode.ts`, `test/geoint-geocode.test.ts`

- [ ] **Step 1: Update the failing test** — change the geocode test expectations to include `name`:

```ts
// test/geoint-geocode.test.ts — replace expected objects with name-bearing ones:
  it('matches a place name in free text', () => {
    expect(geocode('Unrest reported across France today')).toEqual({ lat: 46, lon: 2, name: 'France' });
  });
  it('prefers the longest name match (South Sudan over Sudan)', () => {
    expect(geocode('clashes in South Sudan today')).toEqual({ lat: 7, lon: 30, name: 'South Sudan' });
  });
  it('is whole-word + case-insensitive (no substring false hits)', () => {
    expect(geocode('the malimba festival')).toBeNull();
    expect(geocode('news from MALI')).toEqual({ lat: 17, lon: -4, name: 'Mali' });
  });
```
(Leave the null + deterministic cases as-is.)

- [ ] **Step 2: Run** — `pnpm exec vitest run test/geoint-geocode.test.ts` → FAIL (missing `name`).

- [ ] **Step 3: Implement** — return the matched entry's name:

```ts
// src/main/geoint/geocode.ts
export type Geocoder = (text: string) => { lat: number; lon: number; name: string } | null;

export function makeGeocoder(entries: GazEntry[]): Geocoder {
  const sorted = [...entries].sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
  const prepared = sorted.map((e) => ({
    e,
    re: new RegExp(`(?:^|[^\\p{L}])${e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}])`, 'iu')
  }));
  return (text: string) => {
    if (!text) return null;
    for (const { e, re } of prepared) {
      if (re.test(text)) return { lat: e.lat, lon: e.lon, name: e.name };
    }
    return null;
  };
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** — `git add src/main/geoint/geocode.ts test/geoint-geocode.test.ts && git commit -m "feat(geoint): geocoder returns matched place name (cycle-2 prep)"`

### Task 1.2: `GeoItem.place` + feeds record it

**Files:** Modify `src/shared/post-mvp-types.ts`, `src/main/geoint/feeds.ts`, `test/geoint-feeds.test.ts`

- [ ] **Step 1: Add `place` to `GeoItem`** (`post-mvp-types.ts`, in the GeoItem interface after `lon?`):
```ts
  /** Matched gazetteer place name when located:'gazetteer' (drives the auto location-entity). */
  place?: string;
```

- [ ] **Step 2: Update the feeds test** — assert `place` on the gazetteer-located RSS item. The test stub geocoder must now return a name:
```ts
const mali = (t: string): { lat: number; lon: number; name: string } | null => (t.includes('Mali') ? { lat: 17, lon: -4, name: 'Mali' } : null);
// in the RSS test:
    expect(items[1]).toMatchObject({ title: 'Unrest in Mali', lat: 17, lon: -4, located: 'gazetteer', place: 'Mali' });
```

- [ ] **Step 3: Run** — `pnpm exec vitest run test/geoint-feeds.test.ts` → FAIL.

- [ ] **Step 4: Implement** — `feeds.ts` `locate()` records the name; update the `Geocoder` type alias too:
```ts
type Geocoder = (text: string) => { lat: number; lon: number; name: string } | null;

function locate(
  title: string,
  summary: string,
  geo: { lat: number; lon: number } | null,
  geocode: Geocoder
): Pick<GeoItem, 'lat' | 'lon' | 'located' | 'place'> {
  if (geo) return { lat: geo.lat, lon: geo.lon, located: 'geo' };
  const g = geocode(`${title} ${summary}`);
  return g ? { lat: g.lat, lon: g.lon, located: 'gazetteer', place: g.name } : { located: 'none' };
}
```

- [ ] **Step 5: Run** → PASS (geocode + feeds suites). **Step 6: Commit** — `git add src/shared/post-mvp-types.ts src/main/geoint/feeds.ts test/geoint-feeds.test.ts && git commit -m "feat(geoint): record matched place on GeoItem"`

---

## Stage 2 — Shared types: SavedGeoEvent + geo-event timeline kind

### Task 2.1

**Files:** Modify `src/shared/post-mvp-types.ts`, `src/shared/types.ts`

- [ ] **Step 1: `SavedGeoEvent`** (`post-mvp-types.ts`, after `GeoSnapshot`):
```ts
export interface SavedGeoEvent extends GeoItem { savedAt: string }
```

- [ ] **Step 2: `'geo-event'` kind** (`types.ts`): append to the `TimelineKind` union and to `TIMELINE_KINDS`:
```ts
  | 'updated' | 'archive' | 'rename' | 'view' | 'entity' | 'bio-image' | 'geo-event';
```
```ts
  'updated', 'archive', 'rename', 'view', 'entity', 'bio-image', 'geo-event'
```

- [ ] **Step 3: Typecheck** — `pnpm typecheck` → exit 0.
- [ ] **Step 4: Commit** — `git add src/shared/post-mvp-types.ts src/shared/types.ts && git commit -m "feat(geoint): SavedGeoEvent type + geo-event timeline kind"`

---

## Stage 3 — Per-case saved-event store

### Task 3.1: `case-events.ts` + tests

**Files:** Create `src/main/geoint/case-events.ts`; Test `test/geoint-case-events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const DATA = mkdtempSync(join(tmpdir(), 'ga98-geoce-'));
vi.mock('electron', () => ({ app: { getPath: () => DATA } }));
import * as ce from '../src/main/geoint/case-events';

const CASE = '11111111-1111-4111-8111-111111111111';
const item = { id: 'e1', sourceId: 's1', title: 'Quake', lat: 1, lon: 2, located: 'geo' as const };

beforeEach(async () => { /* fresh tmp case dir per run is implicit; remove if present */ });

describe('case-events store', () => {
  it('returns [] for a case with no sidecar (ENOENT-safe)', async () => {
    expect(await ce.listCaseEvents(CASE)).toEqual([]);
  });
  it('adds + lists + removes a saved event', async () => {
    const saved = await ce.addCaseEvent(CASE, item);
    expect(saved.savedAt).toBeTruthy();
    expect(saved.title).toBe('Quake');
    const list = await ce.listCaseEvents(CASE);
    expect(list).toHaveLength(1);
    await ce.removeCaseEvent(CASE, saved.id);
    expect(await ce.listCaseEvents(CASE)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** (mirror `streams.ts`; `caseDir` from paths; `randomUUID` for a stable saved-event id distinct from the source item id)

```ts
// src/main/geoint/case-events.ts
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { caseDir } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';
import type { GeoItem, SavedGeoEvent } from '@shared/post-mvp-types';

const file = (caseId: string): string => join(caseDir(caseId), 'geo-events.json');

async function read(caseId: string): Promise<SavedGeoEvent[]> {
  try { return JSON.parse(await secureReadText(file(caseId))) as SavedGeoEvent[]; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; return []; }
}
async function write(caseId: string, list: SavedGeoEvent[]): Promise<void> {
  await mkdir(caseDir(caseId), { recursive: true });
  await secureWriteFile(file(caseId), JSON.stringify(list, null, 2));
}

export async function listCaseEvents(caseId: string): Promise<SavedGeoEvent[]> { return read(caseId); }

export async function addCaseEvent(caseId: string, item: GeoItem): Promise<SavedGeoEvent> {
  const list = await read(caseId);
  // Re-id so a saved event is uniquely addressable per case (the source item id may repeat).
  const saved: SavedGeoEvent = { ...item, id: randomUUID(), savedAt: new Date().toISOString() };
  list.push(saved);
  await write(caseId, list);
  return saved;
}
export async function removeCaseEvent(caseId: string, eventId: string): Promise<void> {
  await write(caseId, (await read(caseId)).filter((e) => e.id !== eventId));
}
```
(`new Date().toISOString()` is display metadata only.)

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `git add src/main/geoint/case-events.ts test/geoint-case-events.test.ts && git commit -m "feat(geoint): per-case geo-events sidecar store"`

---

## Stage 4 — Save orchestration

### Task 4.1: `save-to-case.ts` + tests

**Files:** Create `src/main/geoint/save-to-case.ts`; Test `test/geoint-save-to-case.test.ts`

- [ ] **Step 1: Write the failing test** — mock the case/entity/note stores to assert orchestration without real case scaffolding:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Record<string, unknown[]> = {};
vi.mock('../src/main/storage/json-fs', () => ({
  caseStore: {
    addLink: vi.fn(async (id, url, title) => { calls.addLink = [id, url, title]; }),
    addTimeline: vi.fn(async (id, ev) => { calls.addTimeline = [id, ev]; return { id: 't', at: '', ...ev }; })
  },
  noteStore: { write: vi.fn(async (id, name, body) => { calls.note = [id, name, body]; }) }
}));
const entityState: { list: { id: string; type: string; value: string }[] } = { list: [] };
vi.mock('../src/main/storage/entities', () => ({
  listAll: vi.fn(async () => entityState.list),
  create: vi.fn(async (input: { type: string; value: string }) => { const e = { id: 'new-ent', ...input }; entityState.list.push(e); return e; }),
  linkToCase: vi.fn(async (caseId: string, entityId: string) => { calls.linkToCase = [caseId, entityId]; })
}));
vi.mock('../src/main/geoint/case-events', () => ({ addCaseEvent: vi.fn(async (id, item) => ({ ...item, id: 'saved', savedAt: 'now' })) }));

import { saveToCase } from '../src/main/geoint/save-to-case';
import * as caseEvents from '../src/main/geoint/case-events';
import * as entities from '../src/main/storage/entities';
import { caseStore, noteStore } from '../src/main/storage/json-fs';

const CASE = 'c1';
const item = { id: 'e1', sourceId: 's1', title: 'Quake in Mali', summary: 'm5', link: 'https://x/1', lat: 17, lon: -4, located: 'gazetteer' as const, place: 'Mali' };

beforeEach(() => { entityState.list = []; for (const k of Object.keys(calls)) delete calls[k]; vi.clearAllMocks(); });

describe('saveToCase', () => {
  it('record form: writes a saved-event record', async () => {
    await saveToCase(CASE, item, { form: 'record' });
    expect(caseEvents.addCaseEvent).toHaveBeenCalledWith(CASE, item);
  });
  it('link form: addLink with the item link', async () => {
    await saveToCase(CASE, item, { form: 'link' });
    expect(calls.addLink).toEqual([CASE, 'https://x/1', 'Quake in Mali']);
  });
  it('link form: rejects a non-http(s) link', async () => {
    await expect(saveToCase(CASE, { ...item, link: 'javascript:1' }, { form: 'link' })).rejects.toThrow();
  });
  it('note form: writes a note', async () => {
    await saveToCase(CASE, item, { form: 'note' });
    expect((calls.note as string[])[2]).toContain('Quake in Mali');
  });
  it('auto-creates + links a location entity from item.place', async () => {
    await saveToCase(CASE, item, { form: 'record' });
    expect(entities.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'location', value: 'Mali' }));
    expect(calls.linkToCase).toEqual([CASE, 'new-ent']);
  });
  it('reuses an existing location entity (find, not create)', async () => {
    entityState.list = [{ id: 'ex', type: 'location', value: 'Mali' }];
    await saveToCase(CASE, item, { form: 'record' });
    expect(entities.create).not.toHaveBeenCalled();
    expect(calls.linkToCase).toEqual([CASE, 'ex']);
  });
  it('emits a geo-event timeline entry', async () => {
    await saveToCase(CASE, item, { form: 'record' });
    expect((calls.addTimeline as [string, { kind: string }])[1].kind).toBe('geo-event');
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/main/geoint/save-to-case.ts
import type { GeoItem } from '@shared/post-mvp-types';
import { caseStore, noteStore } from '../storage/json-fs';
import * as entities from '../storage/entities';
import { addCaseEvent } from './case-events';

export interface SaveToCaseOpts { form: 'record' | 'link' | 'note'; entityIds?: string[] }

function isHttp(u: string | undefined): u is string {
  if (!u) return false;
  try { const p = new URL(u).protocol; return p === 'http:' || p === 'https:'; } catch { return false; }
}

export async function saveToCase(caseId: string, item: GeoItem, opts: SaveToCaseOpts): Promise<{ savedEventId?: string }> {
  let savedEventId: string | undefined;

  if (opts.form === 'record') {
    savedEventId = (await addCaseEvent(caseId, item)).id;
  } else if (opts.form === 'link') {
    if (!isHttp(item.link)) throw new Error('This event has no http(s) link to save as a bookmark.');
    await caseStore.addLink(caseId, item.link, item.title);
  } else {
    const coords = item.lat != null && item.lon != null ? `\n\ncoords: ${item.lat}, ${item.lon}` : '';
    const link = item.link ? `\n\n${item.link}` : '';
    const body = `${item.title}\n\n${item.summary ?? ''}${link}${coords}`;
    await noteStore.write(caseId, `GeoINT — ${item.title}`.slice(0, 80), body);
  }

  // Auto location-entity (find-or-create by type+value), then manual entities.
  if (item.place) {
    const all = await entities.listAll();
    const existing = all.find((e) => e.type === 'location' && e.value === item.place);
    const id = existing ? existing.id : (await entities.create({ type: 'location', value: item.place })).id;
    await entities.linkToCase(caseId, id, {});
  }
  for (const eid of opts.entityIds ?? []) await entities.linkToCase(caseId, eid, {});

  await caseStore.addTimeline(caseId, { kind: 'geo-event', message: `Saved GeoINT event: ${item.title}` });
  return { savedEventId };
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `git add src/main/geoint/save-to-case.ts test/geoint-save-to-case.test.ts && git commit -m "feat(geoint): saveToCase orchestrator (record/link/note + auto location-entity + timeline)"`

---

## Stage 5 — IPC + validator + preload

### Task 5.1: validator

**Files:** Modify `src/main/security/validate.ts`

- [ ] **Step 1: Implement** (after `ensureGeoSource`)
```ts
export function ensureSaveToCaseOpts(v: unknown): { form: 'record' | 'link' | 'note'; entityIds?: string[] } {
  if (!v || typeof v !== 'object') throw new ValidationError('opts must be an object');
  const o = v as { form?: unknown; entityIds?: unknown };
  if (o.form !== 'record' && o.form !== 'link' && o.form !== 'note') throw new ValidationError('opts.form invalid');
  let entityIds: string[] | undefined;
  if (o.entityIds !== undefined) {
    if (!Array.isArray(o.entityIds)) throw new ValidationError('entityIds must be an array');
    entityIds = o.entityIds.map((x) => ensureUuid(x, 'entityId'));
  }
  return { form: o.form, entityIds };
}
```
(`ensureUuid` is already exported from this file.)

### Task 5.2: contracts + handlers + preload + api.d.ts

**Files:** `ipc-contracts.ts`, `register.ts`, `preload/index.ts`, `preload/api.d.ts`

- [ ] **Step 1: channels** (`ipc-contracts.ts`, inside `geoint`):
```ts
    saveToCase: 'geoint:saveToCase',
    listCaseEvents: 'geoint:listCaseEvents',
    removeCaseEvent: 'geoint:removeCaseEvent'
```
Import `SavedGeoEvent, GeoItem` from `./post-mvp-types`; add `ApiContracts`:
```ts
  [channels.geoint.saveToCase]: { args: [string, GeoItem, { form: 'record' | 'link' | 'note'; entityIds?: string[] }]; returns: { savedEventId?: string } };
  [channels.geoint.listCaseEvents]: { args: [string]; returns: SavedGeoEvent[] };
  [channels.geoint.removeCaseEvent]: { args: [string, string]; returns: void };
```

- [ ] **Step 2: handlers** (`register.ts`; import `{ saveToCase } from '../geoint/save-to-case'`, `* as caseEvents from '../geoint/case-events'`, add `ensureSaveToCaseOpts` to the validate import):
```ts
  safeHandle(channels.geoint.saveToCase, (...a) => saveToCase(ensureUuid(a[0], 'caseId'), a[1] as import('@shared/post-mvp-types').GeoItem, ensureSaveToCaseOpts(a[2])));
  safeHandle(channels.geoint.listCaseEvents, (...a) => caseEvents.listCaseEvents(ensureUuid(a[0], 'caseId')));
  safeHandle(channels.geoint.removeCaseEvent, (...a) => caseEvents.removeCaseEvent(ensureUuid(a[0], 'caseId'), ensureUuid(a[1], 'eventId')));
```
(`item` is validated structurally by the downstream stores + `saveToCase`'s URL check; the caseId/eventId/opts are validated here. The GeoItem is renderer-origin app data echoed back, not a traversal vector — no path use.)

- [ ] **Step 3: preload** (`index.ts`, in `geoint`):
```ts
    saveToCase: (caseId: string, item: unknown, opts: unknown) => ipcRenderer.invoke(channels.geoint.saveToCase, caseId, item, opts),
    listCaseEvents: (caseId: string) => ipcRenderer.invoke(channels.geoint.listCaseEvents, caseId),
    removeCaseEvent: (caseId: string, eventId: string) => ipcRenderer.invoke(channels.geoint.removeCaseEvent, caseId, eventId)
```

- [ ] **Step 4: api.d.ts** (in the `geoint` interface; import `SavedGeoEvent`, `GeoItem`):
```ts
    saveToCase(caseId: string, item: GeoItem, opts: { form: 'record' | 'link' | 'note'; entityIds?: string[] }): Promise<{ savedEventId?: string }>;
    listCaseEvents(caseId: string): Promise<SavedGeoEvent[]>;
    removeCaseEvent(caseId: string, eventId: string): Promise<void>;
```

- [ ] **Step 5: Typecheck** → exit 0. **Step 6: Commit** — `git add src/main/security/validate.ts src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts && git commit -m "feat(geoint): saveToCase/listCaseEvents IPC + validator"`

---

## Stage 6 — Renderer

### Task 6.1: SaveEventDialog

**Files:** Create `src/renderer/modules/geoint/SaveEventDialog.tsx`

- [ ] **Step 1: Implement** — props `{ item: GeoItem; onClose: () => void }`. On mount load `cases.list()` + `entities.listAll()`. State: selected caseId, form (`'record'|'link'|'note'`, default `'record'`), checked entityIds. A 98.css modal (mirror `overlayStyle` used in DialTerm/EyeSpy host setup): title, case `<select>`, form radio group, entity checklist (label = `type: value`), Save/Cancel. Save → `window.api.geoint.saveToCase(caseId, item, { form, entityIds })` → toast success + `onClose`; catch → `toast.error`. Disable Save until a case is chosen. (Link form: if `!item.link`, disable the link radio with a hint.) Concrete, ~120 lines following the existing dialog pattern.
- [ ] **Step 2: Typecheck + commit.**

### Task 6.2: Wire "Save to case…" into GeoIntModule

**Files:** Modify `src/renderer/modules/geoint/GeoIntModule.tsx`

- [ ] **Step 1:** Add `const [saveItem, setSaveItem] = useState<GeoItem | null>(null);`. In each reading-list `<li>`, add a button `📁` (title "Save to case…") → `setSaveItem(i)`. Render `{saveItem && <SaveEventDialog item={saveItem} onClose={() => setSaveItem(null)} />}`. Import `SaveEventDialog` + `GeoItem`.
- [ ] **Step 2: Typecheck + commit.**

### Task 6.3: CaseDetail "GeoINT events" section

**Files:** Modify `src/renderer/modules/cases/CaseDetail.tsx`

- [ ] **Step 1:** On the open case, load `window.api.geoint.listCaseEvents(caseId)` into state (refresh on caseId change). Render a `<fieldset><legend>GeoINT events</legend>` section: for each `SavedGeoEvent` a row — title, `place ?? '—'`, `published`/`savedAt`, an `open` link (only if http(s)), and a remove button → `window.api.geoint.removeCaseEvent(caseId, ev.id)` then refresh. Empty/ENOENT → "No saved events." Mirror the existing CaseDetail section markup (e.g. the links/entities sections). Locate the right insertion point near the entities/links sections.
- [ ] **Step 2: Typecheck + commit.**

---

## Stage 7 — Verification

- [ ] **Step 1:** `pnpm typecheck` → exit 0.
- [ ] **Step 2:** `pnpm test` → all suites pass (prior 144 + case-events + save-to-case + updated geocode/feeds).
- [ ] **Step 3:** `pnpm build` → exit 0.
- [ ] **Step 4: xvfb smoke** — open GeoINT, open the Save-to-case dialog on a fixture item, save as a record to a case, confirm it lists in that case's "GeoINT events" section; no `[main.uncaughtException]`.
- [ ] **Step 5:** update `project_roadmap` memory + `.remember/remember.md`; commit harness bits.

---

## Self-review (completed during authoring)

- **Spec coverage:** save forms record/link/note (4.1), per-case sidecar (3.1), auto location-entity find-or-create + manual entities (4.1), `geo-event` timeline (2.1/4.1), geocoder-name + `place` (1.1/1.2), IPC (5.2), Save dialog + CaseDetail section (6). Covered.
- **Placeholder scan:** 6.1/6.3 describe concrete components with exact data flow + props + the IPC calls (the JSX is first-pass per existing dialog/section patterns, not a placeholder); no "TODO/handle errors" in logic.
- **Type consistency:** `Geocoder` returns `{lat,lon,name}` in geocode.ts AND the feeds.ts alias (1.1/1.2 match). `SaveToCaseOpts.form` enum identical across validator, orchestrator, IPC, preload, dialog. `SavedGeoEvent`/`GeoItem`/`place` consistent. `caseStore.addTimeline(id,{kind,message})` matches the confirmed signature; `entities.create/listAll/linkToCase` and `noteStore.write(id,name,body)` match.
- **Locking:** `saveToCase` holds no case lock and composes only self-locking store methods — correct (no `*Unlocked`).
