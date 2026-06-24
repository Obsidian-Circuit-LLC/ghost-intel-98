# Searchlight / GeoINT / EyeSpy Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a 12-item dogfooding feedback batch across Searchlight (full Maigret DB, bundled favicons, custom-site add/export, settings pane, start-menu entry, intro splash, whiteboard removal, midnight-purple cosmetics), GeoINT (timeline default-to-max, right-click Add-to-Monitor), and EyeSpy (coordinate entry).

**Architecture:** Searchlight stays main-process-only for any network; renderer makes no network calls. New persisted state (custom sites, pinned monitors) goes through the encrypted secure-fs vault. Favicons ship as a committed build-time snapshot (zero runtime egress), looked up lazily per displayed site over IPC. Engine-backed Maigret sites are resolved at parse time. Pure logic lives in `@shared/*` and `src/main/*` node-testable modules; renderer changes are verified by typecheck + electron-vite build + manual smoke (house rule: renderer is not unit-tested).

**Tech Stack:** Electron 33 (Node 20), React 18, TypeScript strict, vitest (node env, no globals, `@shared/*` alias). Tests: `npx vitest run <file>`.

## Global Constraints

- No telemetry, no phone-home, no new network egress channel. Favicons add **zero** runtime egress (bundled snapshot regenerated only by an explicit script).
- Searchlight sweeps are **main-process only**; the renderer makes **no** network calls. Tor-default / `networkEnabled`-gated / no-silent-clearnet-fallback invariants are unchanged.
- Encrypt-at-rest via secure-fs (`secureReadFile`/`secureWriteFile`) for all new persisted state.
- Untrusted input coerced/validated at the trust boundary before persist (imported/custom sites, coordinate entry, persisted pinned-monitor blob, loaded favicons.json).
- No `new RegExp(untrustedInput)` on the main thread. `MaigretSiteEntry` has **no** `regexCheck` field; `regexCheck` is dropped on ingest.
- CSP unchanged. Favicons render as `data:` `<img>` (already permitted — GraphView already renders data-URI avatars).
- Build determinism: favicons ship as committed `resources/searchlight/favicons.json`; `package`/`package:win` consume it; no build-time network.
- Renderer not unit-tested: for renderer/CSS tasks the verification is `npm run typecheck` + `npx electron-vite build` clean + the stated manual smoke. Node-logic tasks are TDD.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF`
- Run a single test file with: `npx vitest run test/<file>.test.ts`. Typecheck with `npm run typecheck`.

---

## Task 1: Maigret engine resolution + `ignore403`

**Files:**
- Modify: `src/shared/searchlight/types.ts` (add `ignore403` to `MaigretSiteEntry`)
- Modify: `src/shared/searchlight/sites.ts` (`coerceEntry`, `parseMaigretData`)
- Modify: `src/shared/searchlight/interpret.ts` (honour `ignore403` on 403)
- Test: `test/searchlight-sites.test.ts` (extend; create if absent)

**Interfaces:**
- Produces: `parseMaigretData(json)` now resolves `engine` refs; `MaigretSiteEntry.ignore403?: boolean`.
- Consumes (Task 2): the bundled `data.json` `{sites,engines,tags}` envelope.

Maigret's full DB: `{ "sites": {name: info}, "engines": {engName: {name, site:{...defaults}}}, "tags": {...} }`. 1,372 of 3,166 sites carry `"engine": "<name>"` and inherit `checkType`/`presenseStrs`/`absenceStrs`/`ignore403` from `engines[name].site`. Known engines: `engine404`→`status_code`, `engineRedirect`→`response_url`, `engine404message`→`message`, `phpBB`/`XenForo`→`message`. Merge order: **engine defaults first, site fields override**, applied **before** the url/disabled filter.

- [ ] **Step 1: Write the failing test**

Add to `test/searchlight-sites.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseMaigretData } from '@shared/searchlight/sites';

describe('parseMaigretData engine resolution', () => {
  const db = {
    engines: {
      engine404: { name: 'engine404', site: { checkType: 'status_code' } },
      engine404message: { name: 'engine404message', site: { checkType: 'message', absenceStrs: ['Not Found'] } },
    },
    tags: { social: 'Social' },
    sites: {
      Upwork: { engine: 'engine404', urlMain: 'https://upwork.com', url: 'https://upwork.com/fl/{username}', tags: ['freelance'] },
      Foo: { engine: 'engine404message', url: 'https://foo.test/{username}' },
      Override: { engine: 'engine404', checkType: 'message', url: 'https://o.test/{username}', presenseStrs: ['hi'] },
      Unknown: { engine: 'nope', url: 'https://u.test/{username}' },
      Dead: { engine: 'engine404', disabled: true, url: 'https://d.test/{username}' },
      Inline: { checkType: 'message', url: 'https://i.test/{username}', absenceStrs: ['gone'] },
    },
  };

  it('resolves engine checkType and strings, lets site override, drops disabled, excludes engines/tags keys', () => {
    const sites = parseMaigretData(db);
    const byName = Object.fromEntries(sites.map((s) => [s.name, s]));
    expect(byName.Upwork.checkType).toBe('status_code');
    expect(byName.Foo.checkType).toBe('message');
    expect(byName.Foo.absenceStrs).toEqual(['Not Found']);
    expect(byName.Override.checkType).toBe('message'); // site overrides engine's status_code
    expect(byName.Override.presenseStrs).toEqual(['hi']);
    expect(byName.Unknown.checkType).toBe('status_code'); // unknown engine -> coerce default
    expect(byName.Dead).toBeUndefined();
    expect(byName.Inline.checkType).toBe('message');
    expect(sites.find((s) => s.name === 'engine404')).toBeUndefined();
    expect(sites.find((s) => s.name === 'social')).toBeUndefined();
  });

  it('carries ignore403 from engine or site', () => {
    const sites = parseMaigretData({
      engines: { e: { site: { checkType: 'message', ignore403: true } } },
      sites: { A: { engine: 'e', url: 'https://a.test/{username}' }, B: { url: 'https://b.test/{username}', ignore403: true } },
    });
    const byName = Object.fromEntries(sites.map((s) => [s.name, s]));
    expect(byName.A.ignore403).toBe(true);
    expect(byName.B.ignore403).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/searchlight-sites.test.ts`
Expected: FAIL (engine fields not resolved; `ignore403` undefined).

- [ ] **Step 3: Add `ignore403` to the type**

In `src/shared/searchlight/types.ts`, inside `MaigretSiteEntry` (after `usernameClaimed: string;`):

```typescript
  usernameClaimed: string;
  /** When true, a 403 is a normal response for this site (interpret by content, not 'blocked'). */
  ignore403?: boolean;
```

- [ ] **Step 4: Resolve engines in the parser**

In `src/shared/searchlight/sites.ts`, replace `coerceEntry` and `parseMaigretData` with:

```typescript
function coerceEntry(name: string, info: Record<string, unknown>): MaigretSiteEntry {
  const tags = Array.isArray(info.tags) ? (info.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
  const ct = typeof info.checkType === 'string' && CHECK_TYPES.has(info.checkType) ? (info.checkType as CheckType) : 'status_code';
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const hdrs = info.headers && typeof info.headers === 'object' ? (info.headers as Record<string, string>) : {};
  return {
    name,
    url: String(info.url),
    urlMain: typeof info.urlMain === 'string' ? info.urlMain : '',
    urlProbe: typeof info.urlProbe === 'string' ? info.urlProbe : '',
    category: tags.length > 0 ? tags[0] : 'misc',
    tags,
    checkType: ct,
    presenseStrs: strArr(info.presenseStrs),
    absenceStrs: strArr(info.absenceStrs),
    alexaRank: typeof info.alexaRank === 'number' ? info.alexaRank : 99999,
    headers: hdrs,
    usernameClaimed: typeof info.usernameClaimed === 'string' ? info.usernameClaimed : '',
    ignore403: info.ignore403 === true
  };
}

/** Merge an engine's `.site` defaults beneath a site's own fields (site overrides engine). */
function resolveEngine(info: Record<string, unknown>, engines: Record<string, unknown>): Record<string, unknown> {
  const engName = typeof info.engine === 'string' ? info.engine : null;
  const engDef = engName && engines[engName] && typeof engines[engName] === 'object'
    ? (engines[engName] as Record<string, unknown>).site
    : null;
  if (engDef && typeof engDef === 'object') return { ...(engDef as Record<string, unknown>), ...info };
  return info;
}

/** Parse a trusted/bundled Maigret object (or {sites, engines, tags} envelope). */
export function parseMaigretData(json: unknown): MaigretSiteEntry[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  const sites = (root.sites && typeof root.sites === 'object' ? root.sites : root) as Record<string, unknown>;
  const engines = (root.engines && typeof root.engines === 'object' ? root.engines : {}) as Record<string, unknown>;
  const out: MaigretSiteEntry[] = [];
  for (const [name, rawInfo] of Object.entries(sites)) {
    if (!rawInfo || typeof rawInfo !== 'object') continue;
    const merged = resolveEngine(rawInfo as Record<string, unknown>, engines);
    if (typeof merged.url !== 'string' || merged.disabled) continue;
    out.push(coerceEntry(name, merged));
  }
  return out;
}
```

- [ ] **Step 5: Honour `ignore403` in interpretation**

In `src/shared/searchlight/interpret.ts`, replace the blocked-codes guard (lines ~22-25):

```typescript
  // Anti-bot / rate-limit responses are NOT evidence of absence — unless the site
  // declares ignore403 (403 is a normal response there; interpret by content).
  if (BLOCKED_CODES.has(result.statusCode) && !(result.statusCode === 403 && site.ignore403)) {
    return { found: false, confidence: 'low', status: 'blocked' };
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/searchlight-sites.test.ts test/searchlight-interpret.test.ts`
Expected: PASS (all, including the pre-existing interpret suite).

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck
git add src/shared/searchlight/types.ts src/shared/searchlight/sites.ts src/shared/searchlight/interpret.ts test/searchlight-sites.test.ts
git commit -m "feat(searchlight): resolve Maigret engine refs + honour ignore403

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

## Task 2: Bundle the full Maigret database

**Files:**
- Replace: `resources/searchlight/maigret_sites.json` (full Maigret `data.json`, the `{sites,engines,tags}` envelope)
- Test: `test/searchlight-site-db.test.ts` (extend; create if absent)

**Interfaces:**
- Consumes (Task 1): engine-resolving `parseMaigretData`.
- Produces: a bundled catalog of ~3,000 usable (non-disabled) sites.

The source file is the operator-supplied full Maigret `data.json` at `/root/.claude/uploads/956dbabe-6cc6-4375-9e68-f4a21d90048d/849f0367-data.json` (keys `sites`/`engines`/`tags`, 3,166 sites). **Copy it verbatim** — do not strip `engines`/`tags` (the parser needs `engines`).

- [ ] **Step 1: Write the failing test**

Add to `test/searchlight-site-db.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMaigretData } from '@shared/searchlight/sites';

describe('bundled Maigret DB', () => {
  it('parses the full bundled DB to a large engine-resolved catalog', () => {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'resources/searchlight/maigret_sites.json'), 'utf8'));
    expect(raw.engines).toBeTruthy(); // envelope preserved
    const sites = parseMaigretData(raw);
    expect(sites.length).toBeGreaterThan(2000); // far above the old ~1,433 subset
    // engine-backed sites resolved (no checkType defaulted away to status_code en masse):
    const messageSites = sites.filter((s) => s.checkType === 'message');
    expect(messageSites.length).toBeGreaterThan(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/searchlight-site-db.test.ts`
Expected: FAIL (current bundled file is the curated subset / smaller count).

- [ ] **Step 3: Replace the bundled DB**

```bash
cp /root/.claude/uploads/956dbabe-6cc6-4375-9e68-f4a21d90048d/849f0367-data.json resources/searchlight/maigret_sites.json
```

Verify it is the envelope form:
```bash
node -e "const d=require('./resources/searchlight/maigret_sites.json'); console.log(Object.keys(d), 'sites:', Object.keys(d.sites).length)"
```
Expected: `[ 'sites', 'engines', 'tags' ] sites: 3166`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/searchlight-site-db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add resources/searchlight/maigret_sites.json test/searchlight-site-db.test.ts
git commit -m "feat(searchlight): bundle full 3,166-site Maigret database

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

## Task 3: Bundled favicons — snapshot, regen script, main loader + IPC

**Files:**
- Create: `scripts/fetch-favicons.mjs` (regenerator; not in the build)
- Create: `resources/searchlight/favicons.json` (committed snapshot; generated by the script)
- Modify: `src/main/searchlight/site-db.ts` (favicon loader + lookup)
- Modify: `src/shared/ipc-contracts.ts` (`searchlight:favicon` channel)
- Modify: `src/preload/index.ts` + `src/preload/api.d.ts` (`window.api.searchlight.favicon`)
- Modify: `src/main/ipc/register.ts` (handler)
- Modify: `package.json` (`build.extraResources` already includes `resources/searchlight` → `searchlight`; confirm favicons.json rides along — it's in the same dir, so it does. No change unless extraResources lists files individually.)
- Test: `test/searchlight-favicons.test.ts`

**Interfaces:**
- Produces: `loadFavicons(readJson?)` cache + `faviconFor(siteName: string): string | null`; IPC `searchlight:favicon(name) → string | null`; preload `window.api.searchlight.favicon(name: string): Promise<string | null>`.

The snapshot shape is `{ "<siteName>": "data:image/png;base64,…" }`. The loader validates each value starts with `data:image/` (trust-boundary coercion even on a bundled file) and drops anything else.

- [ ] **Step 1: Write the failing test**

Create `test/searchlight-favicons.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { loadFavicons, faviconFor, _resetForTest } from '@main/searchlight/site-db';

describe('searchlight favicons', () => {
  beforeEach(() => _resetForTest());

  it('returns the data-uri for a known site and null for unknown', () => {
    loadFavicons(() => ({ GitHub: 'data:image/png;base64,AAAA', Evil: 'javascript:alert(1)' }));
    expect(faviconFor('GitHub')).toBe('data:image/png;base64,AAAA');
    expect(faviconFor('Nope')).toBeNull();
  });

  it('drops non data:image values at load (trust boundary)', () => {
    loadFavicons(() => ({ Evil: 'javascript:alert(1)', Http: 'http://x/y.png' }));
    expect(faviconFor('Evil')).toBeNull();
    expect(faviconFor('Http')).toBeNull();
  });

  it('tolerates a missing favicons.json', () => {
    loadFavicons(() => { throw new Error('missing'); });
    expect(faviconFor('GitHub')).toBeNull();
  });
});
```

> Note: this test imports via the `@main/*` alias. Confirm the alias exists in `vitest.config.ts`; the existing `test/searchlight-*.test.ts` already import `@main/searchlight/*`, so it does.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/searchlight-favicons.test.ts`
Expected: FAIL (`loadFavicons`/`faviconFor` not exported).

- [ ] **Step 3: Implement loader + lookup in `site-db.ts`**

Add to `src/main/searchlight/site-db.ts` (after the `customCache` declarations near the top):

```typescript
let faviconCache: Record<string, string> | null = null;

function faviconsPath(): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return join(base, app.isPackaged ? 'searchlight' : 'resources/searchlight', 'favicons.json');
}

export function loadFavicons(readJson?: () => unknown): Record<string, string> {
  if (readJson) { faviconCache = sanitizeFavicons(readJson()); return faviconCache; }
  if (!faviconCache) {
    try { faviconCache = sanitizeFavicons(JSON.parse(readFileSync(faviconsPath(), 'utf8'))); }
    catch { faviconCache = {}; }
  }
  return faviconCache;
}

function sanitizeFavicons(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const [name, val] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof val === 'string' && val.startsWith('data:image/')) out[name] = val;
    }
  }
  return out;
}

export function faviconFor(siteName: string): string | null {
  return loadFavicons()[siteName] ?? null;
}
```

Extend `_resetForTest`:

```typescript
export function _resetForTest(): void { bundledCache = null; customCache = null; faviconCache = null; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/searchlight-favicons.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the IPC channel + preload + handler**

In `src/shared/ipc-contracts.ts`, add to the searchlight channel group: `favicon: 'searchlight:favicon'` and its payload typing `'searchlight:favicon': { args: [name: string]; result: string | null }` (match the existing MessagePayloads style in that file).

In `src/preload/index.ts`, under the `searchlight` object: `favicon: (name: string) => ipcRenderer.invoke(channels.searchlight.favicon, name),`. In `src/preload/api.d.ts`, add `favicon(name: string): Promise<string | null>;` to the searchlight interface.

In `src/main/ipc/register.ts`, add (near the other searchlight handlers, using the existing `safeHandle`):

```typescript
safeHandle(channels.searchlight.favicon, async (_e, name: unknown) =>
  typeof name === 'string' ? faviconFor(name) : null);
```

Add `faviconFor` to the existing `site-db` import in `register.ts`.

- [ ] **Step 6: Write the regenerator script**

Create `scripts/fetch-favicons.mjs`. It reads the bundled DB, derives unique `urlMain` origins, fetches each favicon best-effort, and writes a sorted snapshot. Run manually (`node scripts/fetch-favicons.mjs`); it is **not** part of `package`/`package:win`.

```javascript
// Regenerates resources/searchlight/favicons.json — a committed snapshot of per-site
// favicons (data:image/png base64). Run manually and review the diff before commit.
// Network: fetches favicons from the listed sites' origins. Run from a context where
// that egress is acceptable (NOT part of the build — the build consumes the snapshot).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const db = JSON.parse(readFileSync(join(ROOT, 'resources/searchlight/maigret_sites.json'), 'utf8'));
const sites = db.sites ?? db;
const engines = db.engines ?? {};

// site -> origin (urlMain or url origin), resolving engine fields if needed
function originFor(info) {
  const merged = info.engine && engines[info.engine]?.site ? { ...engines[info.engine].site, ...info } : info;
  const u = merged.urlMain || merged.url;
  try { return new URL(u).origin; } catch { return null; }
}

async function fetchIcon(origin) {
  try {
    const res = await fetch(origin + '/favicon.ico', { redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!/image\//i.test(ct)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 64 * 1024) return null; // skip empties / oversize
    const mime = ct.split(';')[0].trim();
    return `data:${mime.startsWith('image/') ? mime : 'image/png'};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

const out = {};
const entries = Object.entries(sites).filter(([, v]) => v && typeof v === 'object' && !v.disabled);
let done = 0;
for (const [name, info] of entries) {
  const origin = originFor(info);
  if (!origin) { continue; }
  const icon = await fetchIcon(origin);
  if (icon && icon.startsWith('data:image/')) out[name] = icon;
  if (++done % 100 === 0) console.error(`${done}/${entries.length}…`);
}
const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
writeFileSync(join(ROOT, 'resources/searchlight/favicons.json'), JSON.stringify(sorted));
console.error(`wrote ${Object.keys(sorted).length} favicons`);
```

- [ ] **Step 7: Generate the snapshot**

```bash
node scripts/fetch-favicons.mjs
node -e "const f=require('./resources/searchlight/favicons.json'); console.log('favicons:', Object.keys(f).length)"
```
Expected: a few hundred to ~2,000 icons (best-effort; many origins won't serve `/favicon.ico`). If the run environment blocks egress and produces 0, commit an **empty `{}`** snapshot — the loader and renderer fall back to avatars, and the operator can regenerate later. Note in the commit message whether the snapshot is populated or empty.

- [ ] **Step 8: Typecheck + commit**

```bash
npm run typecheck
git add scripts/fetch-favicons.mjs resources/searchlight/favicons.json src/main/searchlight/site-db.ts src/shared/ipc-contracts.ts src/preload/index.ts src/preload/api.d.ts src/main/ipc/register.ts test/searchlight-favicons.test.ts
git commit -m "feat(searchlight): bundled favicon snapshot + lazy per-site IPC lookup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

## Task 4: Render favicons in Sweep results + Graph nodes

**Files:**
- Modify: `src/renderer/modules/searchlight/panels/SweepPanel.tsx` (result rows)
- Modify: `src/renderer/modules/searchlight/panels/GraphView.tsx` (profile nodes)
- Modify: `src/renderer/modules/searchlight/searchlight.css` (icon styling)

**Interfaces:**
- Consumes (Task 3): `window.api.searchlight.favicon(name) → Promise<string|null>`.

Renderer-only; verified by typecheck + build + manual smoke. Fetch the favicon lazily for each displayed site name, cache in a `Map` in component state/ref, render `<img>` with the existing generated avatar as fallback when null.

- [ ] **Step 1: Read the two panels**

Read `SweepPanel.tsx` (result row rendering, ~line 380+) and `GraphView.tsx` (node avatar rendering) to find where a per-result/site row is drawn and what avatar fallback exists.

- [ ] **Step 2: Add a favicon hook**

Create a small hook used by both panels — add to `src/renderer/modules/searchlight/panels/useFavicons.ts`:

```typescript
import { useEffect, useState } from 'react';

const cache = new Map<string, string | null>();

/** Lazily resolve bundled favicons for a set of site names. Returns a name→dataUri|null map. */
export function useFavicons(names: string[]): Record<string, string | null> {
  const [map, setMap] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let alive = true;
    const missing = names.filter((n) => !cache.has(n));
    if (missing.length === 0) { setMap(Object.fromEntries(names.map((n) => [n, cache.get(n) ?? null]))); return; }
    (async () => {
      await Promise.all(missing.map(async (n) => { cache.set(n, await window.api.searchlight.favicon(n)); }));
      if (alive) setMap(Object.fromEntries(names.map((n) => [n, cache.get(n) ?? null])));
    })();
    return () => { alive = false; };
  }, [names.join('|')]);
  return map;
}
```

- [ ] **Step 3: Use it in SweepPanel**

In `SweepPanel.tsx`, derive the visible site names, call `const favicons = useFavicons(visibleNames);`, and in each result row render (before the site name):

```tsx
{favicons[r.siteName]
  ? <img className="sl-favicon" src={favicons[r.siteName]!} alt="" width={16} height={16} />
  : <span className="sl-favicon sl-favicon-fallback" aria-hidden />}
```

- [ ] **Step 4: Use it in GraphView**

In `GraphView.tsx`, for profile/result nodes, prefer the favicon when present, else keep the current generated data-URI avatar. Use the same `useFavicons` hook keyed on the node's site name.

- [ ] **Step 5: CSS**

Add to `searchlight.css`:

```css
.sl-favicon { width: 16px; height: 16px; object-fit: contain; vertical-align: middle; margin-right: 6px; border-radius: 2px; }
.sl-favicon-fallback { display: inline-block; background: #2a2050; }
```

- [ ] **Step 6: Typecheck + build + commit**

```bash
npm run typecheck && npx electron-vite build
git add src/renderer/modules/searchlight/panels/SweepPanel.tsx src/renderer/modules/searchlight/panels/GraphView.tsx src/renderer/modules/searchlight/panels/useFavicons.ts src/renderer/modules/searchlight/searchlight.css
git commit -m "feat(searchlight): show bundled favicons in Sweep results + Graph nodes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

## Task 5: Add custom site + export (main + IPC)

**Files:**
- Modify: `src/main/searchlight/site-db.ts` (`addCustomSite`, `exportCustomSitesJson`)
- Modify: `src/shared/ipc-contracts.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`, `src/main/ipc/register.ts`
- Test: `test/searchlight-site-db.test.ts` (extend)

**Interfaces:**
- Produces: `addCustomSite({name,url,category?}) → Promise<{ok:boolean; reason?:string}>`; `exportCustomSitesJson() → Promise<string>`; IPC `searchlight:addCustomSite`, `searchlight:exportSites`.

Validation reuses `validateImportedSites` rules (https + `{username}`). Persistence is the existing encrypted `custom-sites.json` (secure-fs), same merge semantics as `importCustomSites`.

- [ ] **Step 1: Write the failing test**

Add to `test/searchlight-site-db.test.ts` (the suite already mocks secure-fs — follow its existing mock setup; if none, mock `@main/storage/secure-fs` with an in-memory map as the other `searchlight-store` tests do):

```typescript
import { addCustomSite, exportCustomSitesJson, catalog, _resetForTest } from '@main/searchlight/site-db';
import { validateImportedSites } from '@shared/searchlight/sites';

describe('custom site add/export', () => {
  beforeEach(() => _resetForTest());

  it('adds a valid custom site and surfaces it in the catalog', async () => {
    const r = await addCustomSite({ name: 'MySite', url: 'https://my.test/u/{username}', category: 'forum' });
    expect(r.ok).toBe(true);
    const cat = await catalog();
    expect(cat.find((c) => c.name === 'MySite')).toBeTruthy();
  });

  it('rejects an invalid url and persists nothing', async () => {
    const r = await addCustomSite({ name: 'Bad', url: 'http://no-token.test/' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
    const cat = await catalog();
    expect(cat.find((c) => c.name === 'Bad')).toBeUndefined();
  });

  it('exports only custom sites as valid round-trippable JSON', async () => {
    await addCustomSite({ name: 'MySite', url: 'https://my.test/u/{username}' });
    const json = await exportCustomSitesJson();
    const parsed = validateImportedSites(JSON.parse(json));
    expect(parsed.sites.find((s) => s.name === 'MySite')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/searchlight-site-db.test.ts`
Expected: FAIL (`addCustomSite`/`exportCustomSitesJson` not exported).

- [ ] **Step 3: Implement in `site-db.ts`**

```typescript
export async function addCustomSite(input: { name: string; url: string; category?: string }): Promise<{ ok: boolean; reason?: string }> {
  const name = String(input?.name ?? '').trim();
  const url = String(input?.url ?? '').trim();
  if (!name) return { ok: false, reason: 'Name is required' };
  if (!/^https:\/\//i.test(url) || !url.includes('{username}')) {
    return { ok: false, reason: 'URL must start with https:// and contain {username}' };
  }
  const entry: Record<string, unknown> = { url, urlMain: (() => { try { return new URL(url).origin; } catch { return ''; } })() };
  if (input.category) entry.tags = [String(input.category)];
  const { sites } = validateImportedSites({ [name]: entry });
  if (sites.length === 0) return { ok: false, reason: 'Invalid site definition' };
  const existing = await loadCustom();
  const byName = new Map(existing.map((s) => [s.name, s]));
  byName.set(sites[0].name, sites[0]);
  const merged = [...byName.values()];
  customCache = merged;
  const asObj: Record<string, unknown> = {};
  for (const s of merged) asObj[s.name] = s;
  await secureWriteFile(customSitesFile(), JSON.stringify(asObj));
  return { ok: true };
}

export async function exportCustomSitesJson(): Promise<string> {
  const custom = await loadCustom();
  const asObj: Record<string, unknown> = {};
  for (const s of custom) asObj[s.name] = s;
  return JSON.stringify({ sites: asObj }, null, 2);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/searchlight-site-db.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire IPC + preload + handlers**

Add channels `addCustomSite: 'searchlight:addCustomSite'`, `exportSites: 'searchlight:exportSites'` + payload typings. Preload: `addCustomSite: (i) => ipcRenderer.invoke(channels.searchlight.addCustomSite, i)`, `exportSites: () => ipcRenderer.invoke(channels.searchlight.exportSites)`; matching `api.d.ts` signatures. Handlers in `register.ts` (gate `addCustomSite` shape-guard the payload; `exportSites` returns the string for a renderer save dialog):

```typescript
safeHandle(channels.searchlight.addCustomSite, async (_e, i: unknown) => {
  const o = (i ?? {}) as Record<string, unknown>;
  return addCustomSite({ name: String(o.name ?? ''), url: String(o.url ?? ''), category: o.category ? String(o.category) : undefined });
});
safeHandle(channels.searchlight.exportSites, async () => exportCustomSitesJson());
```

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/main/searchlight/site-db.ts src/shared/ipc-contracts.ts src/preload/index.ts src/preload/api.d.ts src/main/ipc/register.ts test/searchlight-site-db.test.ts
git commit -m "feat(searchlight): add single custom site + export sites.json (encrypted store)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

## Task 6: Add-custom-site form + Export button (renderer)

**Files:**
- Modify: `src/renderer/modules/searchlight/panels/SweepPanel.tsx`
- Modify: `src/renderer/modules/searchlight/searchlight.css`

**Interfaces:**
- Consumes (Task 5): `window.api.searchlight.addCustomSite`, `window.api.searchlight.exportSites`, and the existing `window.api.searchlight.catalog()` refresh.

Renderer-only (typecheck + build + manual smoke). Near the existing "LOAD MAIGRET DB" control, add a compact "Add custom site" row (name + URL + optional category + Add button) and an "Export sites.json" button that calls `exportSites()` then a save dialog (reuse the existing CSV/report save pattern in `ReportsPanel.tsx`). On success, re-run `loadCatalog`. Show inline reason on failure; the dialog/toast pattern already exists in the panel.

- [ ] **Step 1: Read SweepPanel** around the LOAD MAIGRET DB control (lines ~234-357) and the catalog refresh (lines ~119-126); read the save-file pattern in `ReportsPanel.tsx` (export buttons).
- [ ] **Step 2: Add the form + handlers** (state for name/url/category, an `onAdd` calling `addCustomSite` then `loadCatalog`, an `onExport` calling `exportSites` then the save dialog). Use the `.sl-sweep-btn` button class (restyled in Task 11).
- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npx electron-vite build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/searchlight/panels/SweepPanel.tsx src/renderer/modules/searchlight/searchlight.css
git commit -m "feat(searchlight): add-custom-site form + export sites.json button

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

## Task 7: Searchlight settings pane (the missing toggle)

**Files:**
- Modify: `src/renderer/modules/settings/SettingsModule.tsx`

**Interfaces:**
- Consumes: `settings.searchlight.{networkEnabled,torConcurrency,clearnetConcurrency}` (already in `AppSettings`); the `patch()` helper used by other panes.

Renderer-only (typecheck + build). Add `'searchlight'` to the `SectionKey` union and a `{ key: 'searchlight', label: 'Searchlight', glyph: '🔎' }` entry to `SECTIONS`; add a conditional render `{section === 'searchlight' && <SearchlightPane s={s} patch={patch} />}`; create `SearchlightPane` mirroring `SoundPane`/`ThemePane`.

- [ ] **Step 1: Read** `SettingsModule.tsx` (lines 17, 25-37, 106-119, and the `SoundPane` shape ~176-215).
- [ ] **Step 2: Implement the pane:**

```tsx
function SearchlightPane({ s, patch }: { s: AppSettings; patch: (p: Partial<AppSettings>) => void }): JSX.Element {
  const sl = s.searchlight;
  const set = (p: Partial<AppSettings['searchlight']>) => patch({ searchlight: { ...sl, ...p } });
  return (
    <div className="ga98-settings-pane">
      <h3>Searchlight</h3>
      <label className="ga98-check">
        <input type="checkbox" checked={sl.networkEnabled} onChange={(e) => set({ networkEnabled: e.target.checked })} />
        Enable Searchlight network (sweeps). Off = Searchlight sends nothing.
      </label>
      <p className="ga98-hint">Sweeps run through Tor by default. A per-sweep clearnet checkbox is in the Sweep panel.</p>
      <label className="ga98-field">Tor concurrency
        <input type="number" min={1} max={64} value={sl.torConcurrency}
          onChange={(e) => set({ torConcurrency: Math.max(1, Math.min(64, Number(e.target.value) || 1)) })} />
      </label>
      <label className="ga98-field">Clearnet concurrency
        <input type="number" min={1} max={64} value={sl.clearnetConcurrency}
          onChange={(e) => set({ clearnetConcurrency: Math.max(1, Math.min(64, Number(e.target.value) || 1)) })} />
      </label>
    </div>
  );
}
```

(Match the actual class names / field markup used by the neighbouring panes — read them first; the above is the shape, not necessarily the exact classes.)

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npx electron-vite build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/settings/SettingsModule.tsx
git commit -m "feat(settings): add Searchlight pane with network enable toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

## Task 8: Searchlight in the start menu

**Files:**
- Modify: `src/shared/types.ts` (`defaultShortcuts`, `REQUIRED_MODULE_SHORTCUTS`)
- Test: `test/settings-shortcuts.test.ts` (create if absent; else extend a settings/types test)

**Interfaces:**
- Consumes: the shortcut shape used by `defaultShortcuts` (read the array at types.ts:467-490 for exact fields).

- [ ] **Step 1: Write the failing test**

Create `test/settings-shortcuts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { defaultShortcuts, REQUIRED_MODULE_SHORTCUTS } from '@shared/types';

describe('default shortcuts', () => {
  it('includes a Searchlight module shortcut', () => {
    expect(defaultShortcuts.some((s) => s.target === 'searchlight')).toBe(true);
    expect(REQUIRED_MODULE_SHORTCUTS.some((s) => s.target === 'searchlight' || s === 'searchlight')).toBe(true);
  });
});
```

> Read types.ts:467-505 first to match the exact field names and whether `REQUIRED_MODULE_SHORTCUTS` holds objects or string keys; adjust the assertion to the real shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/settings-shortcuts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the shortcut** to `defaultShortcuts` (and `REQUIRED_MODULE_SHORTCUTS`) matching the existing entry shape, e.g.:

```typescript
{ id: 'searchlight', label: 'Searchlight', kind: 'module', target: 'searchlight', icon: 'search' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/settings-shortcuts.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/shared/types.ts test/settings-shortcuts.test.ts
git commit -m "feat(shell): add Searchlight to default start-menu shortcuts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

## Task 9: Searchlight intro splash (once per install)

**Files:**
- Modify: `src/shared/types.ts` (`AppSettings.hasSeenSearchlightIntro` + default)
- Modify: `src/renderer/modules/searchlight/SearchlightModule.tsx`
- Modify: `src/renderer/modules/searchlight/searchlight.css`

**Interfaces:**
- Consumes: `settings.hasSeenSearchlightIntro`; the settings read/patch already available to the module (the module reads settings; if not, use `window.api.settings.read()/update()` as Welcome.tsx does).

Renderer + one settings flag. Mirror `Welcome.tsx`: on mount, if `!hasSeenSearchlightIntro`, render a Win98-framed modal titled **Searchlight** with the verify-your-results copy and an **UNDERSTOOD — PROCEED** button that sets the flag.

- [ ] **Step 1: Add the flag** to `AppSettings` (after `hasSeenWelcome`) and `defaultSettings` (`hasSeenSearchlightIntro: false`).
- [ ] **Step 2: Read** `Welcome.tsx` (gate + persistence pattern) and `SearchlightModule.tsx` (mount).
- [ ] **Step 3: Implement the modal** in `SearchlightModule.tsx`:

```tsx
// near the top of SearchlightModule render
const [introDone, setIntroDone] = useState<boolean | null>(null);
useEffect(() => { window.api.settings.read().then((st) => setIntroDone(!!st.hasSeenSearchlightIntro)); }, []);
const dismissIntro = () => { window.api.settings.update({ hasSeenSearchlightIntro: true }); setIntroDone(true); };
// ... render, before the tabbed UI:
{introDone === false && (
  <div className="sl-intro-overlay">
    <div className="sl-intro-card">
      <div className="sl-intro-logo">G</div>
      <h2>Searchlight</h2>
      <p className="sl-intro-sub">Intelligence Workstation</p>
      <p className="sl-intro-title">Opening Searchlight</p>
      <p>Be sure to verify your results.</p>
      <p className="sl-intro-fine">Automated checks are not a substitute for manual verification.</p>
      <button className="sl-intro-proceed" onClick={dismissIntro}>UNDERSTOOD — PROCEED</button>
    </div>
  </div>
)}
```

- [ ] **Step 4: CSS** — add `.sl-intro-overlay` (full-module absolute overlay, dark), `.sl-intro-card` (centered, bordered, midnight-purple accent), and the text/button styles to `searchlight.css`.
- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npx electron-vite build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/modules/searchlight/SearchlightModule.tsx src/renderer/modules/searchlight/searchlight.css
git commit -m "feat(searchlight): intro splash on first open (Understood — Proceed)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

## Task 10: Remove the Whiteboard

**Files:**
- Delete: `src/renderer/modules/searchlight/panels/Whiteboard.tsx`
- Modify: `src/renderer/modules/searchlight/SearchlightModule.tsx` (remove tab, import, render)
- Modify: `src/renderer/modules/searchlight/searchlight.css` (remove `.sl-wb-*`)
- Modify: `package.json` (remove `react-rnd` iff unused elsewhere)
- Note: `WhiteboardFile`/`WhiteboardNote` types and `whiteboardFiles`/`whiteboardNotes` on `SearchlightCase` stay (persisted-case back-compat; `sanitizeImportedCase` still handles old `.gic` files). Do NOT remove the import-sanitizer's whiteboard handling.

- [ ] **Step 1: Confirm react-rnd is whiteboard-only**

Run: `grep -rn "react-rnd" src/`
Expected: only `Whiteboard.tsx`. If anything else imports it, leave it in `package.json`.

- [ ] **Step 2: Remove the tab, import, render** in `SearchlightModule.tsx` (delete the `{ key: 'whiteboard', label: 'Whiteboard' }` TABS entry, the `import { Whiteboard }` line, and the `tab === 'whiteboard'` branch).
- [ ] **Step 3: Delete the panel file** and the `.sl-wb-*` CSS block.
- [ ] **Step 4: Remove `react-rnd`** from `package.json` dependencies (only if Step 1 confirmed whiteboard-only). Run `npm install` to update the lockfile.
- [ ] **Step 5: Typecheck + build + full suite**

Run: `npm run typecheck && npx electron-vite build && npx vitest run`
Expected: clean; suite green (the `sanitizeImportedCase` whiteboard tests still pass — types retained).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(searchlight): remove Whiteboard tab/panel + drop react-rnd dep

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

## Task 11: Midnight-purple cosmetics

**Files:**
- Modify: `src/renderer/modules/searchlight/searchlight.css`
- Modify: `src/renderer/modules/searchlight/panels/ReportsPanel.tsx` (apply the new export-button class)

CSS-only + one className change. Palette: base `#3d1a5c`, hover `#5d3a7d`, bevel light `#5d3a7d` / dark `#1a0f2a`, text `#ffffff`/`#e8d8ff`.

- [ ] **Step 1: Dropdowns.** In `searchlight.css`, change `.sl-graph-add-menu` background to `#3d1a5c` with light borders, and `.sl-graph-add-item` color to `#e8d8ff` (keep the dark hover). Change the scope chips: `.sl-sweep-cat` `border-color:#5d3a7d; color:#a080c0;` and `.sl-sweep-cat-active` `background:rgba(93,58,125,0.25); border-color:#7d5aad; color:#e8d8ff;`.
- [ ] **Step 2: Export buttons.** Add a `.sl-rp-export-btn` rule (smaller font/padding, `background:#3d1a5c; color:#fff;` purple bevel, pressed-invert) and apply `className="sl-sweep-btn sl-rp-export-btn"` to the four export buttons in `ReportsPanel.tsx` (replace the inline gray styling that forced `height:auto` etc. as needed).
- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npx electron-vite build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/searchlight/searchlight.css src/renderer/modules/searchlight/panels/ReportsPanel.tsx
git commit -m "style(searchlight): midnight-purple dropdowns + smaller purple export buttons

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

## Task 12: GeoINT timeline defaults to max

**Files:**
- Modify: `src/renderer/modules/geoint/GeoIntModule.tsx`

**Interfaces:**
- Consumes: `timeBounds`/`itemsUpTo` (`./timeline`), `timeCursor` state (line ~129), the `bounds` memo (~line 536).

Renderer-only (typecheck + build + manual smoke). Keep the `TimelineBar` and all controls. Seed `timeCursor` to `bounds.max` whenever `bounds` is (re)established, instead of the current `0` start — so the view opens on "all events" but stays scrubbable.

- [ ] **Step 1: Read** `GeoIntModule.tsx` lines ~126-145 (state) and ~536-590 (bounds memo + play effect) to confirm the `bounds` variable name and that nothing else resets the cursor.
- [ ] **Step 2: Add a seed effect** after `bounds` is computed:

```tsx
// Open the timeline on "show all": seed the cursor to the latest bound whenever bounds
// (re)establish. Keep it scrubbable afterward; only seed when the cursor is unset/out of range.
useEffect(() => {
  if (bounds) setTimeCursor((cur) => (cur < bounds.min || cur > bounds.max || cur === 0 ? bounds.max : cur));
}, [bounds]);
```

(Adjust to the real `bounds` identifier. The guard avoids clobbering an active user scrub on unrelated re-renders while still defaulting fresh loads to max.)

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npx electron-vite build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/geoint/GeoIntModule.tsx
git commit -m "feat(geoint): default timeline cursor to latest (show all) on load

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

## Task 13: GeoINT Add-to-Monitor (pinned set)

**Files:**
- Create: `src/main/services/geoint-monitor.ts` (encrypted pinned-set store)
- Modify: `src/shared/ipc-contracts.ts`, `src/preload/index.ts`, `src/preload/api.d.ts`, `src/main/ipc/register.ts`
- Modify: `src/renderer/modules/geoint/CommandRail.tsx` (context menu + union)
- Modify: `src/renderer/modules/geoint/GeoIntModule.tsx` (load pinned, pass down)
- Test: `test/geoint-monitor.test.ts`

**Interfaces:**
- Produces: `loadPinned():Promise<string[]>`, `setPinned(ids:string[]):Promise<void>`, `addPinned(id)`, `removePinned(id)`; IPC `geoint:getMonitors`/`geoint:setMonitors`. The monitored list shown = pinned ids ∪ corroborated ids.

The pinned set persists a list of stable feed-item keys via secure-fs. Sanitise on load (array of strings only).

- [ ] **Step 1: Write the failing test**

Create `test/geoint-monitor.test.ts` (mock `@main/storage/secure-fs` in-memory, as the searchlight-store tests do):

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

let mem: Record<string, Buffer> = {};
vi.mock('@main/storage/secure-fs', () => ({
  secureReadFile: async (p: string) => { if (!mem[p]) throw new Error('enoent'); return mem[p]; },
  secureWriteFile: async (p: string, d: string | Buffer) => { mem[p] = Buffer.from(d as any); },
}));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/userData' } }));

import { loadPinned, setPinned, addPinned, removePinned, _resetForTest } from '@main/services/geoint-monitor';

describe('geoint monitor pinned set', () => {
  beforeEach(() => { mem = {}; _resetForTest(); });

  it('round-trips through secure-fs', async () => {
    await setPinned(['a', 'b']);
    expect((await loadPinned()).sort()).toEqual(['a', 'b']);
  });

  it('add/remove are idempotent and deduped', async () => {
    await addPinned('x'); await addPinned('x'); await removePinned('y');
    expect(await loadPinned()).toEqual(['x']);
  });

  it('sanitises a malformed persisted blob', async () => {
    mem['/tmp/userData/geoint/monitors.json'] = Buffer.from(JSON.stringify(['ok', 5, null, { a: 1 }]));
    _resetForTest();
    expect(await loadPinned()).toEqual(['ok']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/geoint-monitor.test.ts`
Expected: FAIL (module absent).

- [ ] **Step 3: Implement `src/main/services/geoint-monitor.ts`**

```typescript
import { join } from 'node:path';
import { app } from 'electron';
import { secureReadFile, secureWriteFile } from '../storage/secure-fs';

let cache: string[] | null = null;
function file(): string { return join(app.getPath('userData'), 'geoint', 'monitors.json'); }

export async function loadPinned(): Promise<string[]> {
  if (cache) return cache;
  try {
    const raw = JSON.parse((await secureReadFile(file())).toString('utf8'));
    cache = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch { cache = []; }
  return cache;
}

export async function setPinned(ids: string[]): Promise<void> {
  const clean = Array.from(new Set((Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === 'string')));
  cache = clean;
  await secureWriteFile(file(), JSON.stringify(clean));
}

export async function addPinned(id: string): Promise<string[]> {
  const cur = await loadPinned();
  if (typeof id === 'string' && !cur.includes(id)) await setPinned([...cur, id]);
  return loadPinned();
}

export async function removePinned(id: string): Promise<string[]> {
  const cur = await loadPinned();
  await setPinned(cur.filter((x) => x !== id));
  return loadPinned();
}

export function _resetForTest(): void { cache = null; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/geoint-monitor.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire IPC + preload + handlers** — `geoint:getMonitors → loadPinned()`, `geoint:setMonitors(ids) → setPinned(ids)` (or add/remove variants). Add preload `window.api.geoint.{getMonitors,addMonitor,removeMonitor}` + `api.d.ts`.
- [ ] **Step 6: Renderer wiring** — in `CommandRail.tsx`, add `onContextMenu` to the situation-feed `<li>` (reuse the `FeedMenu` pattern from `src/renderer/modules/eyespy/Finder.tsx`) with "Add to Monitor" / "Remove from Monitor". Maintain a `pinned: Set<string>` loaded on mount (lifted to `GeoIntModule` and passed down, or loaded in the rail). The MONITORED SITUATIONS list = items whose key ∈ (pinned ∪ corroborated). Determine the stable key from the feed item shape (prefer `item.id`; fall back to `sourceId + '|' + title` if ids aren't unique — verify during implementation).
- [ ] **Step 7: Typecheck + build + the new test**

Run: `npm run typecheck && npx electron-vite build && npx vitest run test/geoint-monitor.test.ts`
Expected: clean + green.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/geoint-monitor.ts src/shared/ipc-contracts.ts src/preload/index.ts src/preload/api.d.ts src/main/ipc/register.ts src/renderer/modules/geoint/CommandRail.tsx src/renderer/modules/geoint/GeoIntModule.tsx test/geoint-monitor.test.ts
git commit -m "feat(geoint): right-click Add to Monitor with vault-persisted pinned set

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

## Task 14: EyeSpy coordinate entry on Add-Stream

**Files:**
- Modify: `src/renderer/modules/eyespy/EyeSpyModule.tsx` (Add-stream form: lat/lon fields)
- Reference: `src/renderer/modules/eyespy/SetLocationDialog.tsx` (`parseCoordPair`)
- Test: `test/streams.test.ts` (extend) — exercises main-side `pickGeo`/upsert + `streamsToMasterTree`

**Interfaces:**
- Consumes: existing `window.api.streams.upsert(payload)` (main `pickGeo` validates the pair); `parseCoordPair(latStr, lonStr)` from `SetLocationDialog.tsx`; `streamsToMasterTree` from `src/main/services/cctv-export.ts`.

The export-on-demand path already emits `coordinates` for cameras carrying a valid pair, so the only new work is letting Add-Stream capture lat/lon. Add a main-side test to lock the contract that coords flow into the master tree.

- [ ] **Step 1: Write the failing test**

Add to `test/streams.test.ts` (follow the file's existing import + mock setup for `streams.ts`/`cctv-export.ts`):

```typescript
import { streamsToMasterTree } from '@main/services/cctv-export';

describe('coordinates flow to master CCTV tree', () => {
  it('emits coordinates for a geocoded camera and omits them otherwise', () => {
    const tree = streamsToMasterTree([
      { id: '1', label: 'A', url: 'https://cam.test/a', kind: 'mjpeg', caseId: null, addedAt: '', notes: '',
        country: 'Testland', region: 'Reg', city: 'Town', lat: 12.5, lon: -7.25, source: '' } as any,
      { id: '2', label: 'B', url: 'https://cam.test/b', kind: 'mjpeg', caseId: null, addedAt: '', notes: '', source: '' } as any,
    ]);
    const town = tree['Testland']['Reg']['Town'];
    expect(town[0].coordinates).toEqual({ latitude: 12.5, longitude: -7.25 });
    // geo-less camera lands in an Unknown-ish bucket with no coordinates
    const flat = JSON.stringify(tree);
    expect(flat).toContain('cam.test/b');
    expect(JSON.parse(flat) && tree['Testland']['Reg']['Town'][0].coordinates).toBeTruthy();
  });
});
```

> Read `cctv-export.ts:23-39` first to confirm the exact bucket key for geo-less cameras (e.g. `'Unknown'`) and adjust the second assertion to match.

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npx vitest run test/streams.test.ts`
Expected: This asserts existing `streamsToMasterTree` behaviour — if it already passes, that's the contract baseline; keep it as a regression guard. If the geo-less bucket key differs, fix the assertion to the real key (not the code).

- [ ] **Step 3: Add lat/lon to the Add-stream form** in `EyeSpyModule.tsx` (lines ~351-388). Add two inputs (Latitude, Longitude), parse with `parseCoordPair` on save, and include `lat`/`lon` in the `upsert` payload only when the pair is valid:

```tsx
// in the Add-stream dialog state
const [lat, setLat] = useState(''); const [lon, setLon] = useState('');
// ... fields:
<label>Latitude<input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-90..90" /></label>
<label>Longitude<input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="-180..180" /></label>
// in save(): build geo
const pair = parseCoordPair(lat, lon); // returns {lat,lon} | null
await window.api.streams.upsert({ /* existing fields */, ...(pair ? { lat: pair.lat, lon: pair.lon } : {}) });
```

(Import `parseCoordPair` from `./SetLocationDialog` — export it there if it isn't already.)

- [ ] **Step 4: Run test + typecheck + build**

Run: `npx vitest run test/streams.test.ts && npm run typecheck && npx electron-vite build`
Expected: green + clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/eyespy/EyeSpyModule.tsx src/renderer/modules/eyespy/SetLocationDialog.tsx test/streams.test.ts
git commit -m "feat(eyespy): lat/long entry on Add-Stream → flows to master CCTV export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

## Final verification (after all tasks)

- [ ] `npm run typecheck` clean.
- [ ] `npx vitest run` — full suite green (1,317 prior + new: searchlight-sites engine cases, searchlight-site-db DB + custom, searchlight-favicons, settings-shortcuts, geoint-monitor, streams coords).
- [ ] `npx electron-vite build` clean.
- [ ] `grep -rn "react-rnd" src/` → no matches (dep removed).
- [ ] Confirm `resources/searchlight/{maigret_sites.json,favicons.json}` are committed and present in `build.extraResources`.
- [ ] Manual smoke (operator, post-build): Settings → Searchlight toggle gates sweeps; start-menu shows Searchlight; intro card shows once; ~3k sites; a found result shows its favicon; add a custom site + export sites.json; Graph dropdown + scope chips + export buttons are midnight-purple and readable; Whiteboard gone; GeoINT opens on all events (scrubber still works); right-click feed → Add to Monitor pins; EyeSpy Add-Stream takes lat/long and Export CCTV writes coordinates.
- [ ] Charter: no new runtime egress (favicons bundled), no telemetry, encrypt-at-rest for custom sites + pinned monitors, untrusted input coerced at boundaries.
