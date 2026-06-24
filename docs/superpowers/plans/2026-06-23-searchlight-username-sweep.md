# Searchlight Username-Sweep Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the standalone "Ghost Intel Username Sweeper" into Ghost Intel 98 as a self-contained core module `searchlight` — sweep a username across a large site DB through Tor (clearnet opt-out), interpret hits, and work them through Dashboard/Sweep/Graph/Whiteboard/Reports/Cases, all encrypted at rest.

**Architecture:** The sweep runs in the **main process** (concurrency pool + transport + SSRF guards) and streams results to the renderer over a push channel — the GeoINT live-feeds pattern. Pure logic (site parsing, result interpretation) lives in `src/shared/searchlight/` and is unit-tested. Persistence is the platform's encrypted secure-fs under `dataRoot()/searchlight/`. Egress is Tor-by-default with a per-sweep clearnet opt-out, gated behind a master `settings.searchlight.networkEnabled`.

**Tech Stack:** Electron 33 (Node 20) main + React 18 renderer + TypeScript strict; vitest (node env); MapLibre unaffected; new dep `react-rnd`; bundled Maigret site DB via `extraResources`.

**Source of truth for the port:** the upload is staged (gitignored) at `/dcs98/.searchlight-source/src/`. Renderer port tasks read the original components there and apply the enumerated transforms; do **not** reproduce original JSX in this plan.

## Global Constraints

- Module key is exactly `searchlight`; display title `Searchlight`; desktop glyph `🔎`.
- Egress only when `settings.searchlight.networkEnabled === true` (default `false`), enforced in main before any probe.
- Tor is the default transport. If no live Tor SOCKS port is available, a Tor sweep fails with `TOR_UNAVAILABLE` and **never silently falls back to clearnet**.
- Clearnet path is `safeFetch` only (SSRF + redirect re-validation). The renderer performs no network I/O.
- `webSecurity` and TLS `rejectUnauthorized` stay ON. The upload's `webSecurity:false` / `rejectUnauthorized:false` are NOT replicated.
- No untrusted `RegExp` compiled/executed on the main thread. The per-site `regexCheck` pre-filter is removed (no such field on `MaigretSiteEntry`).
- Persistence is via `secureWriteFile`/`secureReadFile` only. No `localStorage` persist, no `electron-store`.
- No telemetry / analytics / phone-home.
- Exactly one new runtime dependency: `react-rnd`. Use `crypto.randomUUID()` (not `uuid`). Reuse existing `papaparse`/`mammoth`. Icons inlined as SVG.
- Tests: vitest `environment: node`, files in `test/**/*.test.ts`, explicit imports (no globals). `@shared/*` alias resolves to `src/shared/*`.
- Commit message trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF
  ```

---

## File Structure

**Created — shared (pure, tested):**
- `src/shared/searchlight/types.ts` — all shared types.
- `src/shared/searchlight/interpret.ts` — `interpretResult`.
- `src/shared/searchlight/sites.ts` — `parseMaigretData`, `buildProbeUrl`, `toCatalog`, `validateImportedSites`.

**Created — main:**
- `src/main/searchlight/probe.ts` — single HTTP probe (Tor SOCKS | clearnet safeFetch) + error classification.
- `src/main/searchlight/sweep.ts` — concurrency pool, gate, streaming, cancel.
- `src/main/searchlight/site-db.ts` — bundled DB load + merged custom sites.
- `src/main/searchlight/store.ts` — encrypted case CRUD.
- `src/main/searchlight/tor-socks.ts` — `socksDial(host, port, socksPort)` returning a connected `net.Socket`.

**Created — renderer:**
- `src/renderer/modules/searchlight/SearchlightModule.tsx` — root tab host.
- `src/renderer/modules/searchlight/store.ts` — zustand store (IPC-persisted).
- `src/renderer/modules/searchlight/panels/{SweepPanel,GraphView,Whiteboard,ReportsPanel,CasesPanel,Dashboard}.tsx`.
- `src/renderer/modules/searchlight/searchlight.css` — `.sl-*` scoped styles.

**Created — tests:**
- `test/searchlight-interpret.test.ts`, `test/searchlight-sites.test.ts`, `test/searchlight-probe.test.ts`, `test/searchlight-sweep.test.ts`, `test/searchlight-store.test.ts`, `test/searchlight-contracts.test.ts`, `test/searchlight-registry.test.ts`.

**Created — resources:**
- `resources/searchlight/maigret_sites.json` — copied from `.searchlight-source/src/renderer/data/maigret_sites.json`.

**Modified:**
- `src/shared/ipc-contracts.ts` — `searchlight` channel group + `MessagePayloads`.
- `src/main/ipc/register.ts` — `safeHandle` registrations.
- `src/preload/index.ts` — `api.searchlight` + subscriptions.
- `src/shared/types.ts` — `AppSettings.searchlight` + default.
- `src/renderer/state/store.ts` — add `'searchlight'` to `ModuleKey`.
- `src/renderer/shell/Icon.tsx` — `SearchlightGlyph`.
- `src/renderer/shell/Desktop.tsx` — desktop shortcut.
- `src/renderer/modules/register-builtins.tsx` — adapter + `registerModule`.
- `package.json` — `react-rnd` dep + `extraResources` entry.

---

## Task 1: Shared types + result interpretation

**Files:**
- Create: `src/shared/searchlight/types.ts`
- Create: `src/shared/searchlight/interpret.ts`
- Test: `test/searchlight-interpret.test.ts`

**Interfaces:**
- Produces: `MaigretSiteEntry`, `SiteCatalogEntry`, `RawCheckResult`, `SweepResult`, `SearchJob`, `SweepStatus`, `ProbeErrorType`, `CheckType`, graph/whiteboard/case types; `interpretResult(site: MaigretSiteEntry, raw: RawCheckResult, targetUrl: string): Interpretation`.

- [ ] **Step 1: Write the failing test** — `test/searchlight-interpret.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { interpretResult } from '@shared/searchlight/interpret';
import type { MaigretSiteEntry, RawCheckResult } from '@shared/searchlight/types';

const base: MaigretSiteEntry = {
  name: 'X', url: 'https://x.com/{username}', urlMain: 'https://x.com', urlProbe: '',
  category: 'social', tags: ['social'], checkType: 'status_code',
  presenseStrs: [], absenceStrs: [], alexaRank: 1, headers: {}, usernameClaimed: 'admin'
};
const raw = (p: Partial<RawCheckResult>): RawCheckResult =>
  ({ statusCode: 200, statusMessage: 'OK', elapsed: 10, redirectUrl: null, error: null, body: '', ...p });

describe('interpretResult', () => {
  it('status_code 200 => found/high', () => {
    const r = interpretResult(base, raw({ statusCode: 200 }), 'https://x.com/admin');
    expect(r.status).toBe('found'); expect(r.found).toBe(true); expect(r.confidence).toBe('high');
  });
  it('status_code 404 => not_found', () => {
    expect(interpretResult(base, raw({ statusCode: 404 }), 'u').status).toBe('not_found');
  });
  it('403/429/503 => blocked (not a false not_found)', () => {
    for (const c of [403, 429, 503]) expect(interpretResult(base, raw({ statusCode: c }), 'u').status).toBe('blocked');
  });
  it('TOR_UNAVAILABLE => error', () => {
    expect(interpretResult(base, raw({ error: 'TOR_UNAVAILABLE', statusCode: 0 }), 'u').status).toBe('error');
  });
  it('network error => unknown', () => {
    expect(interpretResult(base, raw({ error: 'TIMEOUT', statusCode: 0 }), 'u').status).toBe('unknown');
  });
  it('message: absence string present => not_found/high', () => {
    const s = { ...base, checkType: 'message' as const, absenceStrs: ['No such user'] };
    const r = interpretResult(s, raw({ body: 'Sorry, No such user here' }), 'u');
    expect(r.status).toBe('not_found'); expect(r.confidence).toBe('high');
  });
  it('message: all presence strings present => found/high', () => {
    const s = { ...base, checkType: 'message' as const, presenseStrs: ['Profile', 'Followers'] };
    const r = interpretResult(s, raw({ body: '<h1>Profile</h1> 10 Followers' }), 'u');
    expect(r.status).toBe('found'); expect(r.confidence).toBe('high');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm exec vitest run test/searchlight-interpret.test.ts` → FAIL (module not found).

- [ ] **Step 3: Create `src/shared/searchlight/types.ts`**

```ts
export type CheckType = 'status_code' | 'message' | 'response_url' | 'unknown';
export type SweepStatus = 'found' | 'not_found' | 'blocked' | 'error' | 'unknown';
export type ProbeErrorType =
  | 'DNS_ERROR' | 'SSL_ERROR' | 'TIMEOUT' | 'CONNECTION_REFUSED' | 'CONNECTION_ERROR'
  | 'INVALID_URL' | 'READ_ERROR' | 'TOR_UNAVAILABLE' | null;

/** A site definition. NOTE: there is deliberately no `regexCheck` field — the
 *  username pre-filter was removed to avoid compiling untrusted regex (ReDoS). */
export interface MaigretSiteEntry {
  name: string;
  url: string;
  urlMain: string;
  urlProbe: string;
  category: string;
  tags: string[];
  checkType: CheckType;
  presenseStrs: string[];
  absenceStrs: string[];
  alexaRank: number;
  headers: Record<string, string>;
  usernameClaimed: string;
}

export interface SiteCatalogEntry {
  name: string;
  category: string;
  tags: string[];
  checkType: CheckType;
}

export interface RawCheckResult {
  statusCode: number;
  statusMessage: string;
  elapsed: number;
  redirectUrl: string | null;
  error: ProbeErrorType;
  body?: string;
}

export interface SweepResult {
  id: string;
  jobId: string;
  siteName: string;
  username: string;
  url: string;
  statusCode: number;
  statusMessage: string;
  elapsed: number;
  redirectUrl: string | null;
  error: ProbeErrorType;
  category: string;
  tags: string[];
  checkType: CheckType;
  found: boolean;
  confidence: 'high' | 'medium' | 'low';
  status: SweepStatus;
  timestamp: number;
}

export interface SearchJob {
  id: string;
  username: string;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'completed' | 'cancelled';
  totalSites: number;
  checkedSites: number;
  results: SweepResult[];
  useTor: boolean;
}

export interface GraphNode {
  id: string;
  type: 'username' | 'result' | 'note' | 'file' | 'custom';
  label: string;
  x: number; y: number;
  color?: string;
  data?: unknown;
  statusCode?: number;
  url?: string;
  notes?: string;
}
export interface GraphEdge { id: string; source: string; target: string; label?: string; color?: string; }
export interface WhiteboardFile { id: string; name: string; type: string; mimeType: string; dataUrl: string; x: number; y: number; width: number; height: number; }
export interface WhiteboardNote { id: string; content: string; x: number; y: number; width: number; height: number; color: string; }

export interface SearchlightCase {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  searches: SearchJob[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  whiteboardFiles: WhiteboardFile[];
  whiteboardNotes: WhiteboardNote[];
  notes: string;
  tags: string[];
}

/** Manifest row written to searchlight/index.json. */
export interface SearchlightCaseSummary { id: string; name: string; updatedAt: number; }
```

- [ ] **Step 4: Create `src/shared/searchlight/interpret.ts`**

```ts
import type { MaigretSiteEntry, RawCheckResult, SweepStatus } from './types';

export interface Interpretation {
  found: boolean;
  confidence: 'high' | 'medium' | 'low';
  status: SweepStatus;
}

const BLOCKED_CODES = new Set([403, 429, 503]);

export function interpretResult(
  site: MaigretSiteEntry,
  result: RawCheckResult,
  targetUrl: string
): Interpretation {
  if (result.error) {
    // TOR_UNAVAILABLE is an operator-actionable error; network failures are 'unknown'.
    const status: SweepStatus = result.error === 'TOR_UNAVAILABLE' ? 'error' : 'unknown';
    return { found: false, confidence: 'low', status };
  }

  // Anti-bot / rate-limit responses are NOT evidence of absence.
  if (BLOCKED_CODES.has(result.statusCode)) {
    return { found: false, confidence: 'low', status: 'blocked' };
  }

  const finalize = (found: boolean, confidence: 'high' | 'medium' | 'low'): Interpretation =>
    ({ found, confidence, status: found ? 'found' : 'not_found' });

  const { checkType, presenseStrs, absenceStrs } = site;

  if (checkType === 'message') {
    const body = result.body ?? '';
    if (!body && result.statusCode !== 200) return finalize(false, 'low');
    if (absenceStrs.length > 0 && absenceStrs.some((s) => body.includes(s))) {
      return { found: false, confidence: 'high', status: 'not_found' };
    }
    if (presenseStrs.length > 0) {
      if (presenseStrs.every((s) => body.includes(s))) return finalize(true, 'high');
      if (presenseStrs.some((s) => body.includes(s))) return finalize(true, 'medium');
      return finalize(false, 'medium');
    }
    return finalize(result.statusCode === 200, 'low');
  }

  if (checkType === 'response_url') {
    const tail = targetUrl.split('/').pop()?.toLowerCase() || '___';
    const redirected = !!result.redirectUrl && !result.redirectUrl.toLowerCase().includes(tail);
    return finalize(result.statusCode === 200 && !redirected, 'medium');
  }

  // status_code and unknown fall back to the status code.
  return finalize(result.statusCode === 200, checkType === 'status_code' ? 'high' : 'low');
}
```

- [ ] **Step 5: Run test to verify it passes** — `pnpm exec vitest run test/searchlight-interpret.test.ts` → PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/searchlight/types.ts src/shared/searchlight/interpret.ts test/searchlight-interpret.test.ts
git commit -m "feat(searchlight): shared types + result interpretation"
```

---

## Task 2: Site DB parsing, URL building, import validation

**Files:**
- Create: `src/shared/searchlight/sites.ts`
- Test: `test/searchlight-sites.test.ts`

**Interfaces:**
- Consumes: `MaigretSiteEntry`, `SiteCatalogEntry`, `CheckType` from `@shared/searchlight/types`.
- Produces: `parseMaigretData(json: unknown): MaigretSiteEntry[]`; `buildProbeUrl(username: string, site: MaigretSiteEntry): { url: string; probeUrl: string }`; `toCatalog(sites: MaigretSiteEntry[]): SiteCatalogEntry[]`; `validateImportedSites(raw: unknown, cap?: number): { sites: MaigretSiteEntry[]; rejected: number }`.

- [ ] **Step 1: Write the failing test** — `test/searchlight-sites.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseMaigretData, buildProbeUrl, toCatalog, validateImportedSites } from '@shared/searchlight/sites';
import type { MaigretSiteEntry } from '@shared/searchlight/types';

const site = (over: Partial<MaigretSiteEntry> = {}): MaigretSiteEntry => ({
  name: 'GitHub', url: 'https://github.com/{username}', urlMain: 'https://github.com', urlProbe: '',
  category: 'coding', tags: ['coding'], checkType: 'status_code', presenseStrs: [], absenceStrs: [],
  alexaRank: 1, headers: {}, usernameClaimed: 'torvalds', ...over
});

describe('parseMaigretData', () => {
  it('maps a maigret object to entries and ignores regexCheck', () => {
    const json = { GitHub: { url: 'https://github.com/{username}', urlMain: 'https://github.com', tags: ['coding'], checkType: 'status_code', regexCheck: '^[a-z]+$' } };
    const out = parseMaigretData(json);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('GitHub');
    expect((out[0] as Record<string, unknown>).regexCheck).toBeUndefined();
  });
  it('accepts the {sites:{...}} envelope and skips disabled entries', () => {
    const json = { sites: { A: { url: 'https://a/{username}' }, B: { url: 'https://b/{username}', disabled: true } } };
    expect(parseMaigretData(json).map((s) => s.name)).toEqual(['A']);
  });
});

describe('buildProbeUrl', () => {
  it('substitutes and url-encodes the username', () => {
    expect(buildProbeUrl('a b', site()).url).toBe('https://github.com/a%20b');
  });
  it('uses urlProbe when present', () => {
    const r = buildProbeUrl('x', site({ urlProbe: 'https://api.github.com/users/{username}' }));
    expect(r.probeUrl).toBe('https://api.github.com/users/x');
    expect(r.url).toBe('https://github.com/x');
  });
});

describe('toCatalog', () => {
  it('projects name/category/tags/checkType only', () => {
    expect(toCatalog([site()])[0]).toEqual({ name: 'GitHub', category: 'coding', tags: ['coding'], checkType: 'status_code' });
  });
});

describe('validateImportedSites', () => {
  it('rejects non-https, missing {username}, and junk; keeps valid', () => {
    const raw = {
      Good: { url: 'https://good/{username}', tags: ['x'] },
      NoHttps: { url: 'http://bad/{username}' },
      NoToken: { url: 'https://bad/profile' },
      NotObj: 42
    };
    const { sites, rejected } = validateImportedSites(raw);
    expect(sites.map((s) => s.name)).toEqual(['Good']);
    expect(rejected).toBe(3);
  });
  it('caps total sites', () => {
    const raw: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) raw[`S${i}`] = { url: `https://s${i}/{username}` };
    expect(validateImportedSites(raw, 4).sites).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm exec vitest run test/searchlight-sites.test.ts` → FAIL.

- [ ] **Step 3: Create `src/shared/searchlight/sites.ts`**

```ts
import type { MaigretSiteEntry, SiteCatalogEntry, CheckType } from './types';

const CHECK_TYPES: ReadonlySet<string> = new Set(['status_code', 'message', 'response_url', 'unknown']);

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
    usernameClaimed: typeof info.usernameClaimed === 'string' ? info.usernameClaimed : ''
  };
}

/** Parse a trusted/bundled Maigret object (or {sites:{...}} envelope). */
export function parseMaigretData(json: unknown): MaigretSiteEntry[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  const sites = (root.sites && typeof root.sites === 'object' ? root.sites : root) as Record<string, unknown>;
  return Object.entries(sites)
    .filter(([, info]) => info && typeof info === 'object' && typeof (info as Record<string, unknown>).url === 'string' && !(info as Record<string, unknown>).disabled)
    .map(([name, info]) => coerceEntry(name, info as Record<string, unknown>));
}

/** Substitute {username} (url-encoded) into url and urlProbe. */
export function buildProbeUrl(username: string, site: MaigretSiteEntry): { url: string; probeUrl: string } {
  const enc = encodeURIComponent(username);
  const url = site.url.replace(/\{username\}/g, enc);
  const probeUrl = site.urlProbe ? site.urlProbe.replace(/\{username\}/g, enc) : url;
  return { url, probeUrl };
}

export function toCatalog(sites: MaigretSiteEntry[]): SiteCatalogEntry[] {
  return sites.map((s) => ({ name: s.name, category: s.category, tags: s.tags, checkType: s.checkType }));
}

/** Validate UNTRUSTED imported site data. Each entry must have an https URL
 *  containing the {username} token. Caps the total accepted. */
export function validateImportedSites(raw: unknown, cap = 5000): { sites: MaigretSiteEntry[]; rejected: number } {
  if (!raw || typeof raw !== 'object') return { sites: [], rejected: 0 };
  const root = raw as Record<string, unknown>;
  const src = (root.sites && typeof root.sites === 'object' ? root.sites : root) as Record<string, unknown>;
  const sites: MaigretSiteEntry[] = [];
  let rejected = 0;
  for (const [name, info] of Object.entries(src)) {
    if (sites.length >= cap) break;
    if (!info || typeof info !== 'object') { rejected++; continue; }
    const url = (info as Record<string, unknown>).url;
    if (typeof url !== 'string' || !/^https:\/\//i.test(url) || !url.includes('{username}')) { rejected++; continue; }
    sites.push(coerceEntry(name, info as Record<string, unknown>));
  }
  return { sites, rejected };
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm exec vitest run test/searchlight-sites.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/searchlight/sites.ts test/searchlight-sites.test.ts
git commit -m "feat(searchlight): site parsing, URL building, import validation"
```

---

## Task 3: Single HTTP probe (Tor SOCKS dial + clearnet)

**Files:**
- Create: `src/main/searchlight/tor-socks.ts`
- Create: `src/main/searchlight/probe.ts`
- Test: `test/searchlight-probe.test.ts`

**Interfaces:**
- Consumes: `safeFetch` from `../net/safe-fetch`; `isPublicHttpUrl`, `assertResolvedPublic` from `../security/validate`; SOCKS5 helpers from `../chat/socks5` (`buildGreeting`, `parseMethodSelection`, `buildConnectDomain`, `parseConnectReply`, `socksReplyMessage`); `RawCheckResult`, `ProbeErrorType` from `@shared/searchlight/types`.
- Produces:
  - `classifyError(err: NodeJS.ErrnoException): ProbeErrorType`
  - `socksDial(host: string, port: number, socksPort: number): Promise<import('node:net').Socket>`
  - `probe(targetUrl: string, opts: { fetchBody: boolean; headers?: Record<string,string>; useTor: boolean }, deps?: ProbeDeps): Promise<RawCheckResult>` where `ProbeDeps = { socksPort?: () => number | null; clearnetFetch?: typeof safeFetch; dial?: typeof socksDial }`.

**Note on testing:** the Tor HTTP-over-SOCKS dial does real TLS/socket I/O against live Tor and is **not exercised in CI** (same treatment as `transport-tor.ts`). The unit tests cover: SSRF rejection, `TOR_UNAVAILABLE` when no SOCKS port, `classifyError` mapping, and the clearnet path via an injected fetch. The Tor path is verified by manual smoke (Task 9).

- [ ] **Step 1: Write the failing test** — `test/searchlight-probe.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/main/security/validate', () => ({
  isPublicHttpUrl: (u: string) => /^https?:\/\//.test(u) && !/localhost|127\.0\.0\.1|10\.|192\.168\./.test(u),
  assertResolvedPublic: async (h: string) => { if (/127\.0\.0\.1|localhost/.test(h)) throw new Error('private'); }
}));

import { classifyError, probe } from '../src/main/searchlight/probe';

describe('classifyError', () => {
  it('maps node error codes', () => {
    expect(classifyError({ code: 'ENOTFOUND' } as NodeJS.ErrnoException)).toBe('DNS_ERROR');
    expect(classifyError({ code: 'ECONNREFUSED' } as NodeJS.ErrnoException)).toBe('CONNECTION_REFUSED');
    expect(classifyError({ code: 'CERT_HAS_EXPIRED' } as NodeJS.ErrnoException)).toBe('SSL_ERROR');
    expect(classifyError({ code: 'ETIMEDOUT' } as NodeJS.ErrnoException)).toBe('TIMEOUT');
    expect(classifyError({ code: 'EOTHER' } as NodeJS.ErrnoException)).toBe('CONNECTION_ERROR');
  });
});

describe('probe', () => {
  it('rejects a private/non-public target without calling the network', async () => {
    const r = await probe('http://127.0.0.1/{u}', { fetchBody: false, useTor: false });
    expect(r.error).toBe('CONNECTION_ERROR');
    expect(r.statusCode).toBe(0);
  });
  it('Tor sweep with no SOCKS port => TOR_UNAVAILABLE, no dial', async () => {
    const dial = vi.fn();
    const r = await probe('https://x.com/u', { fetchBody: false, useTor: true }, { socksPort: () => null, dial: dial as never });
    expect(r.error).toBe('TOR_UNAVAILABLE');
    expect(dial).not.toHaveBeenCalled();
  });
  it('clearnet path uses injected fetch and reads body when fetchBody', async () => {
    const clearnetFetch = vi.fn(async () => new Response('hello-body', { status: 200, statusText: 'OK' })) as never;
    const r = await probe('https://x.com/u', { fetchBody: true, useTor: false }, { clearnetFetch });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('hello-body');
    expect(r.error).toBeNull();
  });
  it('clearnet path skips body when fetchBody=false', async () => {
    const clearnetFetch = vi.fn(async () => new Response('x', { status: 404, statusText: 'Not Found' })) as never;
    const r = await probe('https://x.com/u', { fetchBody: false, useTor: false }, { clearnetFetch });
    expect(r.statusCode).toBe(404);
    expect(r.body).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm exec vitest run test/searchlight-probe.test.ts` → FAIL.

- [ ] **Step 3: Create `src/main/searchlight/tor-socks.ts`**

```ts
import { connect, type Socket } from 'node:net';
import { buildGreeting, parseMethodSelection, buildConnectDomain, parseConnectReply, socksReplyMessage } from '../chat/socks5';

/** Open a SOCKS5 CONNECT tunnel to host:port through a local Tor SOCKS port.
 *  Resolves with the connected (pre-TLS) socket; the caller layers TLS/HTTP on top. */
export function socksDial(host: string, port: number, socksPort: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: socksPort });
    let buf = new Uint8Array(0);
    let phase: 'method' | 'connect' = 'method';
    let settled = false;
    const fail = (e: Error) => { if (!settled) { settled = true; socket.destroy(); reject(e); } };
    socket.once('error', (e) => fail(e));
    socket.once('connect', () => socket.write(Buffer.from(buildGreeting())));
    socket.on('data', (d: Buffer) => {
      if (settled) return;
      const merged = new Uint8Array(buf.length + d.length); merged.set(buf, 0); merged.set(new Uint8Array(d), buf.length); buf = merged;
      try {
        if (phase === 'method') {
          const m = parseMethodSelection(buf);
          if (!m) return;
          if (!m.ok) return fail(new Error('SOCKS: no acceptable auth method'));
          buf = buf.slice(2); phase = 'connect';
          socket.write(Buffer.from(buildConnectDomain(host, port)));
          return;
        }
        const r = parseConnectReply(buf);
        if (!r) return;
        if (!r.ok) return fail(new Error(`SOCKS CONNECT failed: ${socksReplyMessage(r.rep)}`));
        settled = true;
        socket.removeAllListeners('data');
        resolve(socket);
      } catch (e) { fail(e as Error); }
    });
  });
}
```

- [ ] **Step 4: Create `src/main/searchlight/probe.ts`**

```ts
import { request as httpsRequest } from 'node:https';
import { isPublicHttpUrl, assertResolvedPublic } from '../security/validate';
import { safeFetch } from '../net/safe-fetch';
import { socksDial } from './tor-socks';
import type { RawCheckResult, ProbeErrorType } from '@shared/searchlight/types';

const BODY_CAP = 65536;
const TIMEOUT_MS = 14000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface ProbeDeps {
  socksPort?: () => number | null;
  clearnetFetch?: typeof safeFetch;
  dial?: typeof socksDial;
}

export function classifyError(err: NodeJS.ErrnoException): ProbeErrorType {
  const code = err.code || '';
  if (code === 'ENOTFOUND') return 'DNS_ERROR';
  if (['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(code)) return 'SSL_ERROR';
  if (code === 'ECONNREFUSED') return 'CONNECTION_REFUSED';
  if (code === 'ETIMEDOUT') return 'TIMEOUT';
  return 'CONNECTION_ERROR';
}

const fail = (error: ProbeErrorType, statusMessage = ''): RawCheckResult =>
  ({ statusCode: 0, statusMessage, elapsed: 0, redirectUrl: null, error, body: '' });

async function guard(targetUrl: string): Promise<URL | null> {
  try {
    if (!isPublicHttpUrl(targetUrl)) return null;
    const u = new URL(targetUrl);
    await assertResolvedPublic(u.hostname);
    return u;
  } catch { return null; }
}

async function probeClearnet(targetUrl: string, fetchBody: boolean, headers: Record<string, string>, fetchImpl: typeof safeFetch): Promise<RawCheckResult> {
  const start = Date.now();
  try {
    const res = await fetchImpl(targetUrl, 4, { 'User-Agent': UA, ...headers });
    let body = '';
    if (fetchBody) body = (await res.text()).slice(0, BODY_CAP);
    return { statusCode: res.status, statusMessage: res.statusText, elapsed: Date.now() - start, redirectUrl: res.headers.get('location'), error: null, body };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const error: ProbeErrorType = e.name === 'TimeoutError' ? 'TIMEOUT' : classifyError(e);
    return { ...fail(error, e.message?.slice(0, 100) ?? ''), elapsed: Date.now() - start };
  }
}

/** Tor path: SOCKS5 CONNECT to host:443 then HTTPS over that socket (Node layers TLS).
 *  Integration-only (live Tor); not run in CI. */
async function probeTor(u: URL, fetchBody: boolean, headers: Record<string, string>, socksPort: number, dial: typeof socksDial): Promise<RawCheckResult> {
  const start = Date.now();
  const port = u.port ? parseInt(u.port, 10) : 443;
  let socket;
  try { socket = await dial(u.hostname, port, socksPort); }
  catch (e) { return { ...fail('CONNECTION_ERROR', (e as Error).message?.slice(0, 100)), elapsed: Date.now() - start }; }

  return await new Promise<RawCheckResult>((resolve) => {
    const req = httpsRequest({
      method: fetchBody ? 'GET' : 'HEAD',
      hostname: u.hostname,
      servername: u.hostname,
      path: u.pathname + u.search,
      createConnection: () => socket as never,
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.8', Connection: 'close', ...headers }
    }, (res) => {
      const code = res.statusCode ?? 0; const msg = res.statusMessage ?? ''; const loc = res.headers.location ?? null;
      if (!fetchBody) { res.destroy(); resolve({ statusCode: code, statusMessage: msg, elapsed: Date.now() - start, redirectUrl: loc, error: null, body: '' }); return; }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size < BODY_CAP) chunks.push(c); else res.destroy(); });
      res.on('end', () => resolve({ statusCode: code, statusMessage: msg, elapsed: Date.now() - start, redirectUrl: loc, error: null, body: Buffer.concat(chunks).toString('utf8', 0, BODY_CAP) }));
      res.on('error', () => resolve({ statusCode: code, statusMessage: msg, elapsed: Date.now() - start, redirectUrl: loc, error: 'READ_ERROR', body: Buffer.concat(chunks).toString('utf8', 0, BODY_CAP) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ...fail('TIMEOUT', 'Timeout'), elapsed: Date.now() - start }); });
    req.on('error', (err) => resolve({ ...fail(classifyError(err as NodeJS.ErrnoException), (err as Error).message?.slice(0, 100)), elapsed: Date.now() - start }));
    req.end();
  });
}

export async function probe(
  targetUrl: string,
  opts: { fetchBody: boolean; headers?: Record<string, string>; useTor: boolean },
  deps: ProbeDeps = {}
): Promise<RawCheckResult> {
  const u = await guard(targetUrl);
  if (!u) return fail('CONNECTION_ERROR', 'blocked non-public target');
  const headers = opts.headers ?? {};
  if (opts.useTor) {
    const port = (deps.socksPort ?? (() => null))();
    if (port == null) return fail('TOR_UNAVAILABLE', 'Tor SOCKS port unavailable');
    return probeTor(u, opts.fetchBody, headers, port, deps.dial ?? socksDial);
  }
  return probeClearnet(targetUrl, opts.fetchBody, headers, deps.clearnetFetch ?? safeFetch);
}
```

- [ ] **Step 5: Run test to verify it passes** — `pnpm exec vitest run test/searchlight-probe.test.ts` → PASS.

- [ ] **Step 6: Verify SOCKS5 helper names** — before committing, confirm `buildGreeting`, `parseMethodSelection`, `buildConnectDomain`, `parseConnectReply`, `socksReplyMessage` are exported from `src/main/chat/socks5.ts` (referenced by `transport-tor.ts`). If a name differs, fix the import in `tor-socks.ts` to match. Run `pnpm typecheck` to confirm.

- [ ] **Step 7: Commit**

```bash
git add src/main/searchlight/tor-socks.ts src/main/searchlight/probe.ts test/searchlight-probe.test.ts
git commit -m "feat(searchlight): main-process probe (Tor SOCKS + clearnet)"
```

---

## Task 4: Sweep service (pool, gate, streaming, cancel)

**Files:**
- Create: `src/main/searchlight/sweep.ts`
- Test: `test/searchlight-sweep.test.ts`

**Interfaces:**
- Consumes: `probe` (injectable); `buildProbeUrl` from `@shared/searchlight/sites`; `interpretResult` from `@shared/searchlight/interpret`; `MaigretSiteEntry`, `SweepResult` from `@shared/searchlight/types`.
- Produces:
  - `runSweep(args: { jobId: string; username: string; sites: MaigretSiteEntry[]; useTor: boolean; concurrency: number; networkEnabled: boolean; emit: (r: SweepResult) => void; onDone: (final: { jobId: string; status: 'completed' | 'cancelled'; checked: number }) => void; isCancelled: () => boolean; probeImpl?: typeof import('./probe').probe }): Promise<void>`
  - `startSweep(...)` / `cancelSweep(jobId)` — the electron-wired wrapper that resolves settings + Tor port and pushes via `webContents.send`; thin, not unit-tested (covered by manual smoke). Document its signature in the file.

- [ ] **Step 1: Write the failing test** — `test/searchlight-sweep.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { runSweep } from '../src/main/searchlight/sweep';
import type { MaigretSiteEntry, SweepResult } from '@shared/searchlight/types';

const mk = (name: string): MaigretSiteEntry => ({
  name, url: `https://${name}.com/{username}`, urlMain: '', urlProbe: '', category: 'x', tags: [],
  checkType: 'status_code', presenseStrs: [], absenceStrs: [], alexaRank: 1, headers: {}, usernameClaimed: ''
});

describe('runSweep', () => {
  it('emits NOTHING and completes when networkEnabled is false', async () => {
    const emit = vi.fn(); const onDone = vi.fn();
    const probeImpl = vi.fn();
    await runSweep({ jobId: 'j', username: 'u', sites: [mk('a'), mk('b')], useTor: true, concurrency: 4, networkEnabled: false, emit, onDone, isCancelled: () => false, probeImpl: probeImpl as never });
    expect(probeImpl).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith({ jobId: 'j', status: 'completed', checked: 0 });
  });

  it('probes every site and emits one interpreted result each', async () => {
    const results: SweepResult[] = [];
    const probeImpl = vi.fn(async () => ({ statusCode: 200, statusMessage: 'OK', elapsed: 1, redirectUrl: null, error: null, body: '' }));
    await runSweep({ jobId: 'j', username: 'u', sites: [mk('a'), mk('b'), mk('c')], useTor: false, concurrency: 2, networkEnabled: true, emit: (r) => results.push(r), onDone: () => {}, isCancelled: () => false, probeImpl: probeImpl as never });
    expect(probeImpl).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'found' && r.jobId === 'j')).toBe(true);
  });

  it('a probe that throws does not abort the sweep', async () => {
    let n = 0;
    const probeImpl = vi.fn(async () => { n++; if (n === 2) throw new Error('boom'); return { statusCode: 200, statusMessage: 'OK', elapsed: 1, redirectUrl: null, error: null, body: '' }; });
    const emit = vi.fn(); const onDone = vi.fn();
    await runSweep({ jobId: 'j', username: 'u', sites: [mk('a'), mk('b'), mk('c')], useTor: false, concurrency: 1, networkEnabled: true, emit, onDone, isCancelled: () => false, probeImpl: probeImpl as never });
    expect(emit).toHaveBeenCalledTimes(2); // the throwing site is skipped
    expect(onDone.mock.calls[0][0].status).toBe('completed');
  });

  it('stops scheduling once cancelled and reports cancelled', async () => {
    let cancelled = false;
    const probeImpl = vi.fn(async () => { cancelled = true; return { statusCode: 200, statusMessage: 'OK', elapsed: 1, redirectUrl: null, error: null, body: '' }; });
    const onDone = vi.fn();
    await runSweep({ jobId: 'j', username: 'u', sites: [mk('a'), mk('b'), mk('c'), mk('d')], useTor: false, concurrency: 1, networkEnabled: true, emit: () => {}, onDone, isCancelled: () => cancelled, probeImpl: probeImpl as never });
    expect(probeImpl.mock.calls.length).toBeLessThan(4);
    expect(onDone.mock.calls[0][0].status).toBe('cancelled');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm exec vitest run test/searchlight-sweep.test.ts` → FAIL.

- [ ] **Step 3: Create `src/main/searchlight/sweep.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { buildProbeUrl } from '@shared/searchlight/sites';
import { interpretResult } from '@shared/searchlight/interpret';
import type { MaigretSiteEntry, SweepResult } from '@shared/searchlight/types';
import { probe as defaultProbe } from './probe';

export interface RunSweepArgs {
  jobId: string;
  username: string;
  sites: MaigretSiteEntry[];
  useTor: boolean;
  concurrency: number;
  networkEnabled: boolean;
  emit: (r: SweepResult) => void;
  onDone: (final: { jobId: string; status: 'completed' | 'cancelled'; checked: number }) => void;
  isCancelled: () => boolean;
  probeImpl?: typeof defaultProbe;
}

export async function runSweep(args: RunSweepArgs): Promise<void> {
  const { jobId, username, sites, useTor, concurrency, networkEnabled, emit, onDone, isCancelled } = args;
  const probe = args.probeImpl ?? defaultProbe;

  if (!networkEnabled) { onDone({ jobId, status: 'completed', checked: 0 }); return; }

  const queue = [...sites];
  let checked = 0;
  let cancelledSeen = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (isCancelled()) { cancelledSeen = true; return; }
      const site = queue.shift();
      if (!site) return;
      const { url, probeUrl } = buildProbeUrl(username, site);
      const fetchBody = site.checkType === 'message';
      try {
        const raw = await probe(probeUrl, { fetchBody, headers: site.headers, useTor });
        const interp = interpretResult(site, raw, url);
        emit({
          id: randomUUID(), jobId, siteName: site.name, username, url,
          statusCode: raw.statusCode, statusMessage: raw.statusMessage, elapsed: raw.elapsed,
          redirectUrl: raw.redirectUrl, error: raw.error, category: site.category, tags: site.tags,
          checkType: site.checkType, found: interp.found, confidence: interp.confidence,
          status: interp.status, timestamp: Date.now()
        });
        checked++;
      } catch { /* isolate per-site failure */ }
    }
  };

  const n = Math.max(1, Math.min(concurrency, sites.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  onDone({ jobId, status: cancelledSeen || isCancelled() ? 'cancelled' : 'completed', checked });
}
```

(Use `Date.now()`/`randomUUID` only for result IDs/timestamps — display metadata, not a determinism-critical path; documented exception.)

- [ ] **Step 4: Run test to verify it passes** — `pnpm exec vitest run test/searchlight-sweep.test.ts` → PASS.

- [ ] **Step 5: Add the electron-wired `startSweep`/`cancelSweep` wrapper** to the same file (below `runSweep`). It is thin glue (resolves settings, Tor SOCKS port via the bgconn Tor accessor, tracks a `Map<jobId, {cancelled}>`, pushes via a passed `send` callback). Not unit-tested; manual smoke in Task 9.

```ts
const active = new Map<string, { cancelled: boolean }>();
export function cancelSweep(jobId: string): void { const e = active.get(jobId); if (e) e.cancelled = true; }
export function cancelAllSweeps(): void { for (const e of active.values()) e.cancelled = true; }

export interface StartSweepDeps {
  loadSites: (siteIds: string[]) => Promise<MaigretSiteEntry[]>;
  networkEnabled: () => Promise<boolean>;
  torSocksPort: () => number | null;
  defaultConcurrency: (useTor: boolean) => number;
  emit: (r: SweepResult) => void;
  onDone: (final: { jobId: string; status: 'completed' | 'cancelled'; checked: number }) => void;
}

/** Returns the jobId immediately; runs the sweep in the background. */
export async function startSweep(
  args: { username: string; siteIds: string[]; useTor: boolean },
  deps: StartSweepDeps
): Promise<{ jobId: string; total: number }> {
  const jobId = randomUUID();
  const sites = await deps.loadSites(args.siteIds);
  const networkEnabled = await deps.networkEnabled();
  const entry = { cancelled: false }; active.set(jobId, entry);
  void runSweep({
    jobId, username: args.username, sites, useTor: args.useTor,
    concurrency: deps.defaultConcurrency(args.useTor), networkEnabled,
    emit: deps.emit, onDone: (f) => { active.delete(jobId); deps.onDone(f); },
    isCancelled: () => entry.cancelled
  });
  return { jobId, total: sites.length };
}
```

- [ ] **Step 6: Run typecheck** — `pnpm typecheck` → clean. (The wrapper compiles; the Tor port accessor wiring lands in Task 7.)

- [ ] **Step 7: Commit**

```bash
git add src/main/searchlight/sweep.ts test/searchlight-sweep.test.ts
git commit -m "feat(searchlight): sweep service (pool, gate, streaming, cancel)"
```

---

## Task 5: Site DB loader (bundled + merged custom sites)

**Files:**
- Create: `src/main/searchlight/site-db.ts`
- Create: `resources/searchlight/maigret_sites.json` (copy of the staged DB)
- Test: `test/searchlight-site-db.test.ts`

**Interfaces:**
- Consumes: `parseMaigretData`, `validateImportedSites`, `toCatalog` from `@shared/searchlight/sites`; `secureReadFile`, `secureWriteFile` from `../storage/secure-fs`; `dataRoot` from `../storage/paths`; `MaigretSiteEntry`, `SiteCatalogEntry` from `@shared/searchlight/types`.
- Produces: `loadBundled(readJson?: () => unknown): MaigretSiteEntry[]`; `customSitesFile(): string`; `fullSites(): Promise<MaigretSiteEntry[]>` (bundled + custom, custom overriding by name); `catalog(): Promise<SiteCatalogEntry[]>`; `sitesByName(names: string[]): Promise<MaigretSiteEntry[]>`; `importCustomSites(rawJsonText: string): Promise<{ added: number; rejected: number }>`; `_resetForTest(): void`.

- [ ] **Step 1: Write the failing test** — `test/searchlight-site-db.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'sl-db-'));
vi.mock('electron', () => ({ app: { getPath: () => DATA, getAppPath: () => DATA } }));

import * as db from '../src/main/searchlight/site-db';

const BUNDLED = { GitHub: { url: 'https://github.com/{username}', tags: ['coding'] }, X: { url: 'https://x.com/{username}', tags: ['social'] } };

beforeEach(() => db._resetForTest());

describe('site-db', () => {
  it('loadBundled parses the injected JSON', () => {
    expect(db.loadBundled(() => BUNDLED).map((s) => s.name).sort()).toEqual(['GitHub', 'X']);
  });
  it('importCustomSites validates and merges; catalog reflects merge', async () => {
    // seed bundled via injection by stubbing loadBundled is not needed: importing custom + reading back
    const res = await db.importCustomSites(JSON.stringify({ MySite: { url: 'https://mysite/{username}' }, Bad: { url: 'http://no/{username}' } }));
    expect(res).toEqual({ added: 1, rejected: 1 });
    const full = await db.fullSites();
    expect(full.some((s) => s.name === 'MySite')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm exec vitest run test/searchlight-site-db.test.ts` → FAIL.

- [ ] **Step 3: Copy the DB resource**

```bash
mkdir -p resources/searchlight
cp .searchlight-source/src/renderer/data/maigret_sites.json resources/searchlight/maigret_sites.json
```

- [ ] **Step 4: Create `src/main/searchlight/site-db.ts`**

```ts
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { app } from 'electron';
import { secureReadFile, secureWriteFile } from '../storage/secure-fs';
import { parseMaigretData, validateImportedSites, toCatalog } from '@shared/searchlight/sites';
import type { MaigretSiteEntry, SiteCatalogEntry } from '@shared/searchlight/types';

let bundledCache: MaigretSiteEntry[] | null = null;
let customCache: MaigretSiteEntry[] | null = null;

/** resources/searchlight/maigret_sites.json — under resourcesPath when packaged, repo root in dev. */
function bundledPath(): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return join(base, app.isPackaged ? 'searchlight' : 'resources/searchlight', 'maigret_sites.json');
}

export function loadBundled(readJson?: () => unknown): MaigretSiteEntry[] {
  if (readJson) return parseMaigretData(readJson());
  if (!bundledCache) {
    try { bundledCache = parseMaigretData(JSON.parse(readFileSync(bundledPath(), 'utf8'))); }
    catch { bundledCache = []; }
  }
  return bundledCache;
}

export function customSitesFile(): string { return join(app.getPath('userData'), 'searchlight', 'custom-sites.json'); }

async function loadCustom(): Promise<MaigretSiteEntry[]> {
  if (customCache) return customCache;
  try { customCache = parseMaigretData(JSON.parse(await secureReadFile(customSitesFile()).then((b) => b.toString('utf8')))); }
  catch { customCache = []; }
  return customCache;
}

export async function fullSites(): Promise<MaigretSiteEntry[]> {
  const byName = new Map<string, MaigretSiteEntry>();
  for (const s of loadBundled()) byName.set(s.name, s);
  for (const s of await loadCustom()) byName.set(s.name, s); // custom overrides
  return [...byName.values()];
}

export async function catalog(): Promise<SiteCatalogEntry[]> { return toCatalog(await fullSites()); }

export async function sitesByName(names: string[]): Promise<MaigretSiteEntry[]> {
  const want = new Set(names);
  return (await fullSites()).filter((s) => want.has(s.name));
}

export async function importCustomSites(rawJsonText: string): Promise<{ added: number; rejected: number }> {
  let parsed: unknown; try { parsed = JSON.parse(rawJsonText); } catch { return { added: 0, rejected: 0 }; }
  const { sites, rejected } = validateImportedSites(parsed);
  const existing = await loadCustom();
  const byName = new Map(existing.map((s) => [s.name, s]));
  for (const s of sites) byName.set(s.name, s);
  const merged = [...byName.values()];
  customCache = merged;
  const asObj: Record<string, unknown> = {};
  for (const s of merged) asObj[s.name] = s;
  await secureWriteFile(customSitesFile(), JSON.stringify(asObj));
  return { added: sites.length, rejected };
}

export function _resetForTest(): void { bundledCache = null; customCache = null; }
```

- [ ] **Step 5: Run test to verify it passes** — `pnpm exec vitest run test/searchlight-site-db.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/searchlight/site-db.ts resources/searchlight/maigret_sites.json test/searchlight-site-db.test.ts
git commit -m "feat(searchlight): bundled + custom site database"
```

---

## Task 6: Encrypted case store

**Files:**
- Create: `src/main/searchlight/store.ts`
- Test: `test/searchlight-store.test.ts`

**Interfaces:**
- Consumes: `secureReadFile`, `secureWriteFile` from `../storage/secure-fs`; `app` from electron for `userData`; `SearchlightCase`, `SearchlightCaseSummary` from `@shared/searchlight/types`.
- Produces: `listCases(): Promise<SearchlightCaseSummary[]>`; `loadCase(id): Promise<SearchlightCase | null>`; `saveCase(c: SearchlightCase): Promise<void>`; `deleteCase(id): Promise<void>`; `exportCase(id): Promise<string | null>` (JSON text); `importCase(jsonText: string): Promise<SearchlightCase | null>`; `_resetForTest(): void`.

- [ ] **Step 1: Write the failing test** — `test/searchlight-store.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'sl-store-'));
vi.mock('electron', () => ({ app: { getPath: () => DATA, getAppPath: () => DATA } }));

import * as store from '../src/main/searchlight/store';
import type { SearchlightCase } from '@shared/searchlight/types';

const mkCase = (id: string, name: string): SearchlightCase => ({
  id, name, description: '', createdAt: 1, updatedAt: 2, searches: [], graphNodes: [], graphEdges: [],
  whiteboardFiles: [], whiteboardNotes: [], notes: '', tags: []
});

beforeEach(() => store._resetForTest());

describe('searchlight store', () => {
  it('saves and lists and loads a case', async () => {
    await store.saveCase(mkCase('a', 'Alpha'));
    expect((await store.listCases()).map((s) => s.name)).toEqual(['Alpha']);
    expect((await store.loadCase('a'))?.name).toBe('Alpha');
  });
  it('deletes a case', async () => {
    await store.saveCase(mkCase('a', 'Alpha'));
    await store.deleteCase('a');
    expect(await store.listCases()).toEqual([]);
    expect(await store.loadCase('a')).toBeNull();
  });
  it('round-trips through export/import with a fresh id collision rejected', async () => {
    await store.saveCase(mkCase('a', 'Alpha'));
    const text = await store.exportCase('a');
    expect(text).toBeTruthy();
    const imported = await store.importCase(text as string);
    expect(imported?.name).toBe('Alpha');
    expect((await store.listCases()).length).toBe(1); // re-import same id overwrites, not duplicates
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm exec vitest run test/searchlight-store.test.ts` → FAIL.

- [ ] **Step 3: Create `src/main/searchlight/store.ts`**

```ts
import { join } from 'node:path';
import { readdir, unlink } from 'node:fs/promises';
import { app } from 'electron';
import { secureReadFile, secureWriteFile } from '../storage/secure-fs';
import type { SearchlightCase, SearchlightCaseSummary } from '@shared/searchlight/types';

function dir(): string { return join(app.getPath('userData'), 'searchlight', 'cases'); }
function caseFile(id: string): string { return join(dir(), `${encodeURIComponent(id)}.json`); }

async function readCase(id: string): Promise<SearchlightCase | null> {
  try { return JSON.parse((await secureReadFile(caseFile(id))).toString('utf8')) as SearchlightCase; }
  catch { return null; }
}

export async function listCases(): Promise<SearchlightCaseSummary[]> {
  let names: string[];
  try { names = await readdir(dir()); } catch { return []; }
  const out: SearchlightCaseSummary[] = [];
  for (const f of names.filter((n) => n.endsWith('.json'))) {
    const c = await readCase(decodeURIComponent(f.replace(/\.json$/, '')));
    if (c) out.push({ id: c.id, name: c.name, updatedAt: c.updatedAt });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadCase(id: string): Promise<SearchlightCase | null> { return readCase(id); }

export async function saveCase(c: SearchlightCase): Promise<void> {
  await secureWriteFile(caseFile(c.id), JSON.stringify(c));
}

export async function deleteCase(id: string): Promise<void> {
  try { await unlink(caseFile(id)); } catch { /* already gone */ }
}

export async function exportCase(id: string): Promise<string | null> {
  const c = await readCase(id);
  return c ? JSON.stringify(c, null, 2) : null;
}

export async function importCase(jsonText: string): Promise<SearchlightCase | null> {
  let c: SearchlightCase;
  try { c = JSON.parse(jsonText) as SearchlightCase; } catch { return null; }
  if (!c || typeof c.id !== 'string' || typeof c.name !== 'string') return null;
  await saveCase(c);
  return c;
}

export function _resetForTest(): void { /* fs-backed; temp dir per run */ }
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm exec vitest run test/searchlight-store.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/searchlight/store.ts test/searchlight-store.test.ts
git commit -m "feat(searchlight): encrypted case store"
```

---

## Task 7: IPC contracts, handlers, preload bridge

**Files:**
- Modify: `src/shared/ipc-contracts.ts` (add `searchlight` group to `channels` + `MessagePayloads`)
- Modify: `src/main/ipc/register.ts` (add `safeHandle` registrations + Tor port accessor + push wiring)
- Modify: `src/preload/index.ts` (add `api.searchlight` + subscriptions)
- Test: `test/searchlight-contracts.test.ts`

**Interfaces:**
- Consumes: `site-db` (`catalog`, `importCustomSites`), `sweep` (`startSweep`, `cancelSweep`, `cancelAllSweeps`), `store` (all), the live bgconn Tor SOCKS port accessor.
- Produces: `channels.searchlight.*` strings; `window.api.searchlight.*` methods + `onSweepResult(cb)` / `onSweepDone(cb)` subscriptions.

- [ ] **Step 1: Write the failing test** — `test/searchlight-contracts.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';

describe('searchlight channels', () => {
  it('exposes the expected channel set, all namespaced under searchlight:', () => {
    const g = (channels as Record<string, Record<string, string>>).searchlight;
    expect(g).toBeTruthy();
    const expected = ['catalog', 'startSweep', 'cancelSweep', 'importSites', 'listCases', 'saveCase', 'loadCase', 'deleteCase', 'exportCase', 'importCase', 'onSweepResult', 'onSweepDone'];
    expect(Object.keys(g).sort()).toEqual([...expected].sort());
    for (const v of Object.values(g)) expect(v.startsWith('searchlight:')).toBe(true);
  });
  it('channel values are globally unique', () => {
    const all = Object.values(channels as Record<string, Record<string, string>>).flatMap((grp) => Object.values(grp));
    expect(new Set(all).size).toBe(all.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm exec vitest run test/searchlight-contracts.test.ts` → FAIL.

- [ ] **Step 3: Add the channel group** to `src/shared/ipc-contracts.ts` `channels` object (place after the `livefeeds` group):

```ts
  searchlight: {
    catalog: 'searchlight:catalog',
    startSweep: 'searchlight:startSweep',
    cancelSweep: 'searchlight:cancelSweep',
    importSites: 'searchlight:importSites',
    listCases: 'searchlight:listCases',
    saveCase: 'searchlight:saveCase',
    loadCase: 'searchlight:loadCase',
    deleteCase: 'searchlight:deleteCase',
    exportCase: 'searchlight:exportCase',
    importCase: 'searchlight:importCase',
    onSweepResult: 'searchlight:onSweepResult',
    onSweepDone: 'searchlight:onSweepDone'
  },
```

- [ ] **Step 4: Add `MessagePayloads` typing** (import the shared types at the top of `ipc-contracts.ts` and add rows):

```ts
import type { SiteCatalogEntry, SweepResult, SearchlightCase, SearchlightCaseSummary } from './searchlight/types';
// ... inside MessagePayloads:
  [channels.searchlight.catalog]: { args: []; returns: SiteCatalogEntry[] };
  [channels.searchlight.startSweep]: { args: [{ username: string; siteIds: string[]; useTor: boolean }]; returns: { jobId: string; total: number } };
  [channels.searchlight.cancelSweep]: { args: [string]; returns: void };
  [channels.searchlight.importSites]: { args: [string]; returns: { added: number; rejected: number } };
  [channels.searchlight.listCases]: { args: []; returns: SearchlightCaseSummary[] };
  [channels.searchlight.saveCase]: { args: [SearchlightCase]; returns: void };
  [channels.searchlight.loadCase]: { args: [string]; returns: SearchlightCase | null };
  [channels.searchlight.deleteCase]: { args: [string]; returns: void };
  [channels.searchlight.exportCase]: { args: [string]; returns: string | null };
  [channels.searchlight.importCase]: { args: [string]; returns: SearchlightCase | null };
  [channels.searchlight.onSweepResult]: { args: [(r: SweepResult) => void]; returns: () => void };
  [channels.searchlight.onSweepDone]: { args: [(f: { jobId: string; status: 'completed' | 'cancelled'; checked: number }) => void]; returns: () => void };
```

- [ ] **Step 5: Run test to verify it passes** — `pnpm exec vitest run test/searchlight-contracts.test.ts` → PASS.

- [ ] **Step 6: Register handlers** in `src/main/ipc/register.ts` (mirror the GeoINT block; gate `startSweep` on `settings.searchlight.networkEnabled`; resolve the live Tor SOCKS port from the bgconn Tor instance). Add near the GeoINT handlers:

```ts
import * as slSiteDb from '../searchlight/site-db';
import * as slStore from '../searchlight/store';
import { startSweep, cancelSweep, cancelAllSweeps } from '../searchlight/sweep';

// Resolve the live Tor SOCKS port. getBgTor() is the persistent background Tor
// instance (bgconn.defaultRouting === 'tor'); returns null if not bootstrapped.
function searchlightSocksPort(): number | null {
  const t = getBgTor();
  return t && typeof t.socksPort === 'number' ? t.socksPort : null;
}

safeHandle(channels.searchlight.catalog, async () => slSiteDb.catalog());
safeHandle(channels.searchlight.importSites, async (...a) => slSiteDb.importCustomSites(String(a[0] ?? '')));
safeHandle(channels.searchlight.startSweep, async (...a) => {
  const req = a[0] as { username: string; siteIds: string[]; useTor: boolean };
  const username = String(req?.username ?? '').trim();
  if (!username) return { jobId: '', total: 0 };
  const siteIds = Array.isArray(req?.siteIds) ? req.siteIds.filter((x): x is string => typeof x === 'string') : [];
  const useTor = req?.useTor !== false; // Tor default
  const win = getWindow();
  return startSweep({ username, siteIds, useTor }, {
    loadSites: (ids) => slSiteDb.sitesByName(ids),
    networkEnabled: async () => (await settingsStore.read()).searchlight.networkEnabled,
    torSocksPort: searchlightSocksPort,
    defaultConcurrency: (tor) => tor ? (settingsCache?.searchlight.torConcurrency ?? 8) : (settingsCache?.searchlight.clearnetConcurrency ?? 16),
    emit: (r) => win?.webContents.send(channels.searchlight.onSweepResult, r),
    onDone: (f) => win?.webContents.send(channels.searchlight.onSweepDone, f)
  });
});
safeHandle(channels.searchlight.cancelSweep, async (...a) => { cancelSweep(ensureUuid(a[0], 'jobId')); });
safeHandle(channels.searchlight.listCases, async () => slStore.listCases());
safeHandle(channels.searchlight.saveCase, async (...a) => slStore.saveCase(a[0] as never));
safeHandle(channels.searchlight.loadCase, async (...a) => slStore.loadCase(ensureUuid(a[0], 'caseId')));
safeHandle(channels.searchlight.deleteCase, async (...a) => slStore.deleteCase(ensureUuid(a[0], 'caseId')));
safeHandle(channels.searchlight.exportCase, async (...a) => slStore.exportCase(ensureUuid(a[0], 'caseId')));
safeHandle(channels.searchlight.importCase, async (...a) => slStore.importCase(String(a[0] ?? '')));
```

Notes for the implementer:
- `getBgTor`, `getWindow`, `settingsStore`, `ensureUuid`, `safeHandle`, `channels` already exist in `register.ts`. Confirm `getBgTor()`'s returned object exposes the SOCKS port (property name may be `socksPort`); if the name differs, adjust `searchlightSocksPort`. If no port property is exposed, add a small accessor next to `getBgTor` returning the configured `bgSocksPort`.
- `defaultConcurrency` reads the settings concurrency added in Task 8. If a `settingsCache` is not in scope, read via `await settingsStore.read()` inside `startSweep`’s `networkEnabled` deps instead and pass concurrency through; simplest: compute concurrency from `(await settingsStore.read()).searchlight` before calling `startSweep` and pass constants into `defaultConcurrency`.
- Wire teardown: in `src/main/index.ts`, call `cancelAllSweeps()` on `mainWindow.webContents.on('render-process-gone', …)`, `('did-start-navigation', …)`, and `mainWindow.on('closed', …)` — mirror the existing `stopAis()` hooks.

- [ ] **Step 7: Add the preload bridge** in `src/preload/index.ts` (mirror the chat `on*` pattern):

```ts
    searchlight: {
      catalog: () => ipcRenderer.invoke(channels.searchlight.catalog),
      startSweep: (req: { username: string; siteIds: string[]; useTor: boolean }) => ipcRenderer.invoke(channels.searchlight.startSweep, req),
      cancelSweep: (jobId: string) => ipcRenderer.invoke(channels.searchlight.cancelSweep, jobId),
      importSites: (jsonText: string) => ipcRenderer.invoke(channels.searchlight.importSites, jsonText),
      listCases: () => ipcRenderer.invoke(channels.searchlight.listCases),
      saveCase: (c: unknown) => ipcRenderer.invoke(channels.searchlight.saveCase, c),
      loadCase: (id: string) => ipcRenderer.invoke(channels.searchlight.loadCase, id),
      deleteCase: (id: string) => ipcRenderer.invoke(channels.searchlight.deleteCase, id),
      exportCase: (id: string) => ipcRenderer.invoke(channels.searchlight.exportCase, id),
      importCase: (jsonText: string) => ipcRenderer.invoke(channels.searchlight.importCase, jsonText),
      onSweepResult: (cb: (r: unknown) => void) => {
        const l = (_e: unknown, r: unknown) => cb(r);
        ipcRenderer.on(channels.searchlight.onSweepResult, l);
        return () => ipcRenderer.removeListener(channels.searchlight.onSweepResult, l);
      },
      onSweepDone: (cb: (f: unknown) => void) => {
        const l = (_e: unknown, f: unknown) => cb(f);
        ipcRenderer.on(channels.searchlight.onSweepDone, l);
        return () => ipcRenderer.removeListener(channels.searchlight.onSweepDone, l);
      }
    },
```

- [ ] **Step 8: Typecheck + full test run** — `pnpm typecheck && pnpm exec vitest run` → clean; all searchlight tests green.

- [ ] **Step 9: Commit**

```bash
git add src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/main/index.ts test/searchlight-contracts.test.ts
git commit -m "feat(searchlight): IPC contracts, handlers, preload bridge, teardown"
```

---

## Task 8: Settings, module registration, packaging, empty shell

**Files:**
- Modify: `src/shared/types.ts` (add `AppSettings.searchlight` + default)
- Modify: `src/renderer/state/store.ts` (ModuleKey)
- Modify: `src/renderer/shell/Icon.tsx` (glyph)
- Modify: `src/renderer/shell/Desktop.tsx` (desktop shortcut)
- Modify: `src/renderer/modules/register-builtins.tsx` (adapter + register)
- Modify: `package.json` (`react-rnd` dep + `extraResources`)
- Create: `src/renderer/modules/searchlight/SearchlightModule.tsx` (empty tabbed shell)
- Create: `src/renderer/modules/searchlight/searchlight.css`
- Test: `test/searchlight-registry.test.ts`

**Interfaces:**
- Produces: a registered `searchlight` module rendering a Win98 tab bar (Dashboard/Sweep/Graph/Whiteboard/Reports/Cases) with empty panels; `settings.searchlight`.

- [ ] **Step 1: Add settings type** to `src/shared/types.ts` `AppSettings` (after `markets`):

```ts
  searchlight: {
    /** Master opt-in egress gate. Off by default ⇒ no probe is sent. */
    networkEnabled: boolean;
    /** Concurrent probes over Tor (slower exits) and over clearnet. */
    torConcurrency: number;
    clearnetConcurrency: number;
  };
```

and the default (after the `markets` default block):

```ts
  searchlight: { networkEnabled: false, torConcurrency: 8, clearnetConcurrency: 16 },
```

- [ ] **Step 2: Write the failing test** — `test/searchlight-registry.test.ts`

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { registerBuiltins } from '../src/renderer/modules/register-builtins';
import { getModule } from '../src/renderer/state/registry';

describe('searchlight registration', () => {
  beforeAll(() => registerBuiltins());
  it('searchlight resolves to a builtin descriptor with title + glyph', () => {
    const d = getModule('searchlight');
    expect(d).toBeTruthy();
    expect(d?.title).toBe('Searchlight');
    expect(d?.glyph).toBe('🔎');
    expect(d?.builtin).toBe(true);
  });
});
```

If `registerBuiltins`/`getModule` import React-bound modules that break under the node test env, mirror the existing `test/module-host.test.ts` setup instead (use its exact import + harness). Confirm by reading that file first.

- [ ] **Step 3: Run test to verify it fails** — `pnpm exec vitest run test/searchlight-registry.test.ts` → FAIL.

- [ ] **Step 4: ModuleKey** — add `| 'searchlight'` to the `ModuleKey` union in `src/renderer/state/store.ts`.

- [ ] **Step 5: Glyph** — in `src/renderer/shell/Icon.tsx`, add to `glyphNodeFor()` a `SearchlightGlyph` (inline SVG — a magnifier; keep it simple, ~16×16) and return it for `m === 'searchlight'`. (The emoji `🔎` in the registry is the fallback.)

- [ ] **Step 6: Desktop shortcut** — add `{ module: 'searchlight', label: 'Searchlight' }` to `desktopShortcutDefaults` in `src/renderer/shell/Desktop.tsx`.

- [ ] **Step 7: Create the empty shell** `src/renderer/modules/searchlight/SearchlightModule.tsx`

```tsx
import { useState } from 'react';
import './searchlight.css';

type Tab = 'dashboard' | 'sweep' | 'graph' | 'whiteboard' | 'reports' | 'cases';
const TABS: { key: Tab; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' }, { key: 'sweep', label: 'Sweep' }, { key: 'graph', label: 'Graph' },
  { key: 'whiteboard', label: 'Whiteboard' }, { key: 'reports', label: 'Reports' }, { key: 'cases', label: 'Cases' }
];

export function SearchlightModule({ caseId: _caseId }: { caseId?: string }): JSX.Element {
  const [tab, setTab] = useState<Tab>('sweep');
  return (
    <div className="sl-root">
      <div className="sl-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key}
            className={`sl-tab${tab === t.key ? ' sl-tab-active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <div className="sl-body">
        {/* Panels wired in Tasks 9–12 */}
        <div className="sl-placeholder">{tab} — coming up</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Create `searchlight.css`** — Win98 tab strip + a dark `.sl-body` canvas:

```css
.sl-root { display: flex; flex-direction: column; height: 100%; }
.sl-tabs { display: flex; gap: 2px; padding: 2px; flex: 0 0 auto; }
.sl-tab { font: inherit; padding: 2px 10px; }
.sl-tab-active { font-weight: bold; }
.sl-body { flex: 1 1 auto; overflow: auto; background: #0a0a14; color: #d8d8e0; }
.sl-placeholder { padding: 16px; opacity: 0.6; }
```

- [ ] **Step 9: Register the module** in `src/renderer/modules/register-builtins.tsx` — add the import, an adapter, and the `registerModule` call:

```tsx
import { SearchlightModule } from './searchlight/SearchlightModule';
// adapter (with the others):
function SearchlightAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return <SearchlightModule caseId={spec.props?.['caseId'] as string | undefined} />;
}
// in registerBuiltins():
registerModule({ key: 'searchlight', title: 'Searchlight', glyph: '🔎', component: SearchlightAdapter, builtin: true, defaultWidth: 1100, defaultHeight: 720 });
```

- [ ] **Step 10: Add the dependency + packaging** — `pnpm add react-rnd`. In `package.json` `build.extraResources`, add:

```json
      { "from": "resources/searchlight", "to": "searchlight" }
```

- [ ] **Step 11: Run test + typecheck + build** — `pnpm exec vitest run test/searchlight-registry.test.ts` → PASS; `pnpm typecheck` → clean; `pnpm build` → renderer builds (module opens as an empty tabbed window).

- [ ] **Step 12: Commit**

```bash
git add src/shared/types.ts src/renderer/state/store.ts src/renderer/shell/Icon.tsx src/renderer/shell/Desktop.tsx src/renderer/modules/register-builtins.tsx src/renderer/modules/searchlight/SearchlightModule.tsx src/renderer/modules/searchlight/searchlight.css package.json pnpm-lock.yaml test/searchlight-registry.test.ts
git commit -m "feat(searchlight): settings, registration, packaging, module shell"
```

---

## Task 9: Renderer store + Sweep panel

**Files:**
- Create: `src/renderer/modules/searchlight/store.ts`
- Create: `src/renderer/modules/searchlight/panels/SweepPanel.tsx`
- Modify: `src/renderer/modules/searchlight/SearchlightModule.tsx` (mount the panel)
- Reference: `.searchlight-source/src/renderer/store/appStore.ts`, `.searchlight-source/src/renderer/components/Search/SearchPanel.tsx`

**Port transforms (apply to the staged originals):**
1. **Store** (`store.ts`): port the zustand store from `appStore.ts` but remove the `persist` middleware. Keep the in-memory shape (cases, activeCaseId, search jobs, graph, whiteboard, settings). Persist by calling `window.api.searchlight.saveCase(activeCase)` (debounced ~500 ms) on mutating actions; hydrate via `loadCase`/`listCases`. Replace every `uuidv4()` with `crypto.randomUUID()`.
2. **Sweep execution**: delete the renderer-side `useSearchEngine` per-site loop. The panel calls `window.api.searchlight.startSweep({ username, siteIds, useTor })` once and subscribes via `window.api.searchlight.onSweepResult` / `onSweepDone` (subscribe in a `useEffect`, unsubscribe on cleanup). Append each pushed `SweepResult` to the active job; on done, mark the job and persist.
3. **Site selection**: load the picker list from `window.api.searchlight.catalog()` (names/categories), not the bundled JSON import. Category filter operates on the catalog.
4. **Tor/clearnet toggle**: add a labeled checkbox **"Direct (clearnet) — exposes your IP"**, default **off** (Tor). Pass `useTor: !directChecked` into `startSweep`.
5. **Network gate awareness**: if `settings.searchlight.networkEnabled` is false, disable the Launch button and show a Win98 inline notice "GeoINT/Searchlight network is off — enable it in Settings." (Read the setting via the existing settings API the renderer already uses; mirror how GeoINT reads `networkEnabled`.)
6. **`TOR_UNAVAILABLE` / `blocked` rendering**: the results filter gains `BLOCKED` and `ERROR` buckets driven by `SweepResult.status`; a result with `status==='error'` and `error==='TOR_UNAVAILABLE'` shows an actionable "Tor not ready" row, not a not-found.
7. **Maigret import**: the "LOAD MAIGRET DB" button now reads the file text and calls `window.api.searchlight.importSites(text)`, then refreshes the catalog.
8. **Aesthetic**: Win98 controls (`className="ga98-text"`/`98.css` buttons) on the toolbar; results table/list on the dark `.sl-*` canvas.
9. Drop `framer-motion` (use CSS); inline any `lucide-react` icons as SVG.

- [ ] **Step 1: Read the staged originals** — `appStore.ts` and `SearchPanel.tsx` in `.searchlight-source`, plus how the renderer currently reads settings (grep an existing module for the settings hook).
- [ ] **Step 2: Create `store.ts`** with the transforms above (no `persist`; IPC-backed).
- [ ] **Step 3: Create `SweepPanel.tsx`** with the transforms above.
- [ ] **Step 4: Mount** `SweepPanel` for the `sweep` tab in `SearchlightModule.tsx`.
- [ ] **Step 5: Typecheck + build** — `pnpm typecheck && pnpm build` → clean.
- [ ] **Step 6: Manual smoke (record results in the task report)** — with `searchlight.networkEnabled` on: run a small sweep over a few selected sites on **Tor** (expect results stream in; Tor-blocked sites show `blocked`), then toggle **Direct (clearnet)** and re-run (expect faster results). Toggle the gate off → Launch disabled. This is the first end-to-end exercise of the Task 3 Tor path.
- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/searchlight/store.ts src/renderer/modules/searchlight/panels/SweepPanel.tsx src/renderer/modules/searchlight/SearchlightModule.tsx
git commit -m "feat(searchlight): renderer store + sweep panel (IPC-streamed)"
```

---

## Task 10: Graph panel

**Files:**
- Create: `src/renderer/modules/searchlight/panels/GraphView.tsx`
- Modify: `SearchlightModule.tsx` (mount)
- Reference: `.searchlight-source/src/renderer/components/Graph/GraphView.tsx`

**Port transforms:**
1. Port the SVG graph verbatim except: source nodes/edges from the searchlight `store.ts` (Task 9), not the old appStore.
2. Replace `uuidv4()` → `crypto.randomUUID()`; drop `framer-motion`; inline `lucide-react` icons as SVG.
3. "Auto-import found results" reads the active job's results with `status==='found'`.
4. Win98 chrome for the side panel / buttons; dark SVG canvas (already dark).

- [ ] **Step 1: Read the staged original.**
- [ ] **Step 2: Create `GraphView.tsx`** with transforms.
- [ ] **Step 3: Mount** for the `graph` tab.
- [ ] **Step 4: Typecheck + build** → clean.
- [ ] **Step 5: Manual smoke (record in report)** — push a found result into the graph, drag/zoom/pan, add+remove an edge.
- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/searchlight/panels/GraphView.tsx src/renderer/modules/searchlight/SearchlightModule.tsx
git commit -m "feat(searchlight): relationship graph panel"
```

---

## Task 11: Whiteboard panel

**Files:**
- Create: `src/renderer/modules/searchlight/panels/Whiteboard.tsx`
- Modify: `SearchlightModule.tsx` (mount)
- Reference: `.searchlight-source/src/renderer/components/Whiteboard/Whiteboard.tsx`

**Port transforms:**
1. Port the infinite-canvas whiteboard; keep `react-rnd` (the one new dep) for card drag/resize.
2. File ingestion: the original reads files via an Electron `read-file` IPC. Use the platform's existing file-read IPC instead (grep for how `doc-viewer`/`whiteboard` core module reads a file → reuse that channel). Do **not** add a new file IPC. Files are stored as data URLs inside the case (already the original's model) and thus persist encrypted via the case store.
3. `uuidv4()` → `crypto.randomUUID()`; drop `framer-motion`; inline icons.
4. Source/persist board state from the searchlight `store.ts`.
5. Win98 toolbar; dark grid canvas.

- [ ] **Step 1: Read the staged original + the core file-read IPC.**
- [ ] **Step 2: Create `Whiteboard.tsx`** with transforms.
- [ ] **Step 3: Mount** for the `whiteboard` tab.
- [ ] **Step 4: Typecheck + build** → clean.
- [ ] **Step 5: Manual smoke (record in report)** — drop a PNG and a TXT onto the canvas, move/resize a card, add a sticky note, reopen the case → board restored.
- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/searchlight/panels/Whiteboard.tsx src/renderer/modules/searchlight/SearchlightModule.tsx
git commit -m "feat(searchlight): whiteboard panel"
```

---

## Task 12: Reports, Cases, Dashboard panels + finalization

**Files:**
- Create: `src/renderer/modules/searchlight/panels/ReportsPanel.tsx`
- Create: `src/renderer/modules/searchlight/panels/CasesPanel.tsx`
- Create: `src/renderer/modules/searchlight/panels/Dashboard.tsx`
- Modify: `SearchlightModule.tsx` (mount all three)
- Reference: the three staged originals under `.searchlight-source/src/renderer/components/{Reports,Cases,Dashboard}/`

**Port transforms:**
1. **Reports**: keep HTML/CSV/JSON/TXT generators; **remove the jspdf/jszip PDF path** (operator decision). Save via the platform's existing save-file dialog IPC (grep for how another module saves a file; reuse it). Found-only filter + per-sweep selection preserved.
2. **Cases**: create/rename/delete + `.gic` import/export. Wire to `window.api.searchlight.{listCases,saveCase,loadCase,deleteCase,exportCase,importCase}`. Export writes via the save-file dialog IPC; import reads file text → `importCase`. Active-case selection drives the store.
3. **Dashboard**: port the summary view; source stats from the store.
4. `uuidv4()` → `crypto.randomUUID()`; drop `framer-motion`; inline icons; Win98 chrome + dark canvas.

- [ ] **Step 1: Read the three staged originals + the save-file IPC.**
- [ ] **Step 2: Create the three panels** with transforms.
- [ ] **Step 3: Mount** all three tabs.
- [ ] **Step 4: Typecheck + full test run + build** — `pnpm typecheck && pnpm exec vitest run && pnpm build` → all clean/green.
- [ ] **Step 5: Manual smoke (record in report)** — export each report format; create/rename/delete a case; export a `.gic` and re-import it; confirm everything persists encrypted (lock vault → data unreadable; unlock → restored).
- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/searchlight/panels/ReportsPanel.tsx src/renderer/modules/searchlight/panels/CasesPanel.tsx src/renderer/modules/searchlight/panels/Dashboard.tsx src/renderer/modules/searchlight/SearchlightModule.tsx
git commit -m "feat(searchlight): reports, cases, dashboard panels"
```

---

## Final verification (whole-branch)

- `pnpm typecheck` clean; `pnpm exec vitest run` green (7 new suites: interpret, sites, probe, sweep, site-db, store, contracts, registry); `pnpm build` clean.
- Charter checks: no probe fires with `searchlight.networkEnabled` off; Tor is default; `TOR_UNAVAILABLE` never falls back to clearnet; renderer makes no network calls; case data is encrypted at rest (lock/unlock smoke); no telemetry; exactly one new dep (`react-rnd`).
- Manual end-to-end smoke list from Tasks 9–12 completed and recorded.

---

## Self-Review

**Spec coverage:** Scope (full self-contained module) → Tasks 8–12. Encrypted persistence → Tasks 6, 9, 12 (lock/unlock smoke). Tor-default + clearnet opt-out + master gate → Tasks 3, 4, 7, 9. Win98 chrome + dark canvas → Tasks 8–12. Dropped regex pre-filter → Task 1 (type) + Task 2 (no compile). Import validation → Task 2 + Task 5. One dep / no uuid/electron-store/framer-motion → Tasks 8–12 transforms. Tests → every task. No gaps.

**Placeholder scan:** No "TBD/TODO". Two integration seams are explicitly flagged as manual-smoke (the live Tor HTTP dial in Task 3; renderer panels in 9–12) with concrete transform lists and the staged source as the reference — not placeholders.

**Type consistency:** `MaigretSiteEntry`, `RawCheckResult`, `SweepResult`, `SweepStatus`, `SearchlightCase`, `SearchlightCaseSummary` defined in Task 1 and used unchanged in Tasks 2–7. `probe(targetUrl, {fetchBody,headers,useTor}, deps)` signature consistent across Tasks 3–4. `channels.searchlight.*` keys in Task 7 match preload + handlers + the registry test.

## Notes for the executor (verify against the live tree)

These names came from an architecture map; confirm before relying on them and adjust the import/accessor if they differ:
- `getBgTor()` and its SOCKS-port property (Task 7). If absent, expose the configured `bgSocksPort` via a tiny accessor.
- SOCKS5 helper export names in `src/main/chat/socks5.ts` (Task 3).
- The renderer settings-read hook and the core file-read / save-file IPC channels (Tasks 9, 11, 12) — reuse existing channels; do not add new ones.
- `getModule`/`registerBuiltins` test ergonomics under node env (Task 8) — mirror `test/module-host.test.ts`.
