# Camera Host Resolution (IP/DNS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve a CCTV camera's hosting (IP, reverse DNS, RDAP org/ASN/country/range) from its `stream_url`, shown inline+collapsible in the GeoINT camera window and in a right-click window in EyeSpy — every lookup routed through Tor.

**Architecture:** A new main-process service `src/main/services/hostinfo/` (pure `extract`/`parse`, an injectable `resolve` orchestrator, a vault-backed `store`, and a cache-first facade) reachable via one `hostinfo:resolve` IPC channel. Every DoH/RDAP lookup routes through the existing `tor-egress.ts` `torFetch`/`ensurePluginTor` (the recon path) on an isolated circuit — never the core clearnet `safeFetch`, never a connection to the camera. A shared `HostInfoView` renders the result inline in the camera-view window (GeoINT) and in a new `host-info` window (EyeSpy).

**Tech Stack:** TypeScript, React, Electron, Vitest. No new dependency.

## Global Constraints

- **Egress = Tor only.** Every lookup goes through `ensurePluginTor()` + `torFetch(url, init)` (`src/main/plugins/tor-egress.ts`). NEVER `safeFetch`, NEVER `globalThis.fetch`, NEVER a connection to the camera. The lookups hit only `https://cloudflare-dns.com` (DoH) and `https://rdap.org` (RDAP) — the recon host set. No other outbound host.
- **`torFetch` returns `{ status: number; body: string; finalUrl: string; blocked?: boolean }`** — `body` is a RAW STRING; you must `JSON.parse(resp.body)` yourself, and check `resp.blocked` (Tor exit refusal) before parsing.
- **On-demand only** — a resolution fires when the user expands the panel / opens the window, never auto-fired for every camera.
- **No new Electron capability, no telemetry.** Persist resolutions in the encrypted vault via `secureReadText`/`secureWriteFile` (`src/main/storage/secure-fs.ts`); `secureReadText` THROWS `ENOENT` on a missing file (treat as empty), and `secureWriteFile` auto-creates parent dirs.
- **Determinism:** `resolvedAt` is injected (no `Date.now()` inside the service path); pure parsers/extractor; TTL is a constant (30 days).
- **Fail-soft:** any lookup failure records into `errors[]` and the partial `HostInfo` is still returned/rendered; the resolver NEVER throws to the caller and NEVER falls back to a non-Tor fetch.
- This is a core `/dcs98` change on branch `feat/camera-host-resolution` — the operator merges/ships (no push, no release here).

## Reference signatures (verified 2026-06-20)

- `src/main/plugins/tor-egress.ts`: `export function torFetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResponse & { location?: string }>` (raw `body` string, `status`, `finalUrl`, `blocked?`); `export function ensurePluginTor(): Promise<void>`.
- `src/main/plugins/context.ts`: `interface PluginFetchInit { method?: string; headers?: Record<string,string>; body?: string; direct?: boolean }`; `interface PluginFetchResponse { status: number; body: string; finalUrl: string; blocked?: boolean }`.
- `src/main/storage/secure-fs.ts`: `export async function secureReadText(path: string): Promise<string>` (throws ENOENT if absent); `export async function secureWriteFile(path: string, data: Buffer|string, opts?: { durable?: boolean }): Promise<void>` (mkdirs).
- `src/shared/ipc-contracts.ts`: `channels` object; `geoint: { ... }` namespace at ~line 248.
- `src/main/ipc/register.ts`: `safeHandle(channel, fn)` (auto-gates on vault lock); pattern `safeHandle(channels.system.openExternal, async (...args) => { ... })`.
- `src/preload/index.ts`: `geoint: { snapshot: () => ipcRenderer.invoke(channels.geoint.snapshot), ... }` (~line 282).
- `src/preload/api.d.ts`: `GhostApi` interface with `geoint: { ... }` (~line 342).
- `src/shared/post-mvp-types.ts:111`: `interface CameraStream { id; label; url; kind; caseId; addedAt; notes; country?; region?; city?; lat?; lon?; source? }`.
- `src/renderer/modules/eyespy/Finder.tsx`: `export type FeedAction = 'add'|'play'|'edit'|'setloc'|'delete'` (line 5); the menu action list (line ~115); `onFeedAction(a, menu.s)` callback.
- `src/renderer/modules/eyespy/EyeSpyModule.tsx`: `function onFeedAction(action: FeedAction, s: CameraStream): void { switch(action){...} }` (~line 200).
- `src/renderer/modules/cameraview/CameraViewModule.tsx`: `export function CameraViewModule({ stream }: { stream: CameraStream }): JSX.Element` — header `<div className="ga98-panel">` then a `<div style={{ flex:1, minHeight:0, background:'#000' }}>` viewer.
- `src/renderer/modules/register-builtins.tsx`: `function CameraViewAdapter({ spec }) { return <CameraViewModule stream={spec.props?.['stream'] as ...} /> }` + `registerModule({ key:'camera-view', title, glyph, component, builtin:true, defaultWidth, defaultHeight })`.
- `src/renderer/modules/geoint/GeoIntModule.tsx`: `onCameraOpen` opens `useWindows.getState().open({ module:'camera-view', id: cameraWindowId(streamId), title, props:{ stream }, width, height })`.
- Tests: vitest, `test/**/*.test.ts`; mock via `vi.fn()`; inject `fetch`/`now` deps (no live network).
- Scripts: `pnpm typecheck`, `pnpm test`, `pnpm build` (core app). Commit identity: standard (Dezirae-Stark); end messages with the two trailers (Co-Authored-By + Claude-Session).

---

### Task 1: Types + host extraction (`hostinfo/types.ts`, `hostinfo/extract.ts`)

**Files:**
- Create: `src/main/services/hostinfo/types.ts`
- Create: `src/main/services/hostinfo/extract.ts`
- Test: `test/hostinfo-extract.test.ts`

**Interfaces:**
- Produces: `HostInfo`, `RdapInfo`; `hostFromStreamUrl(streamUrl: string): { host: string; isIpLiteral: boolean; port?: string } | null`.

- [ ] **Step 1: Write the failing test** — `test/hostinfo-extract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hostFromStreamUrl } from '../src/main/services/hostinfo/extract';

describe('hostFromStreamUrl', () => {
  it('extracts an IP literal + port from a stream url', () => {
    expect(hostFromStreamUrl('http://190.210.250.149:91/mjpg/video.mjpg')).toEqual({ host: '190.210.250.149', isIpLiteral: true, port: '91' });
  });
  it('extracts a hostname (no port) and marks it non-literal', () => {
    expect(hostFromStreamUrl('https://cam.example.com/stream')).toEqual({ host: 'cam.example.com', isIpLiteral: false });
  });
  it('detects an IPv6 literal', () => {
    const r = hostFromStreamUrl('http://[2001:db8::1]:8080/v');
    expect(r?.isIpLiteral).toBe(true);
    expect(r?.host).toBe('2001:db8::1');
  });
  it('returns null for an unparseable url', () => {
    expect(hostFromStreamUrl('not a url')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test → FAIL** — `pnpm test -- hostinfo-extract` (Expected: module not found).

- [ ] **Step 3: Implement** — `src/main/services/hostinfo/types.ts`:

```typescript
export interface RdapInfo { org?: string; asn?: string; country?: string; range?: string }

export interface HostInfo {
  host: string;            // hostname or IP literal extracted from stream_url
  isIpLiteral: boolean;
  port?: string;
  ips: string[];           // DNS A results, or [host] when host is already an IP literal
  ptr?: string;            // reverse-DNS hostname for the primary IP
  rdap?: RdapInfo;
  resolvedAt: string;      // ISO; injected (no Date.now() in the service)
  errors: string[];        // per-lookup failures; partial results still returned
}
```

Create `src/main/services/hostinfo/extract.ts`:

```typescript
import { isIP } from 'node:net';

/** Pure: pull the host (hostname or IP literal) + optional port out of a camera stream URL.
 *  URL parsing brackets IPv6 hosts ([::1]) — strip the brackets for the bare host. Returns null
 *  for anything that isn't a parseable URL. */
export function hostFromStreamUrl(streamUrl: string): { host: string; isIpLiteral: boolean; port?: string } | null {
  let u: URL;
  try { u = new URL(streamUrl); } catch { return null; }
  if (!u.hostname) return null;
  const host = u.hostname.startsWith('[') && u.hostname.endsWith(']') ? u.hostname.slice(1, -1) : u.hostname;
  const isIpLiteral = isIP(host) !== 0;
  return u.port ? { host, isIpLiteral, port: u.port } : { host, isIpLiteral };
}
```

- [ ] **Step 4: Run test → PASS** — `pnpm test -- hostinfo-extract`; then `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git -C /dcs98 add src/main/services/hostinfo/types.ts src/main/services/hostinfo/extract.ts test/hostinfo-extract.test.ts
git -C /dcs98 commit -m "feat(hostinfo): HostInfo types + pure host/IP extraction from stream_url

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

### Task 2: Pure DoH/RDAP parsers (`hostinfo/parse.ts`)

**Files:**
- Create: `src/main/services/hostinfo/parse.ts`
- Test: `test/hostinfo-parse.test.ts`

**Interfaces:**
- Consumes: `RdapInfo` from `./types`.
- Produces: `parseDohA(json: unknown): string[]`; `parseDohPtr(json: unknown): string | undefined`; `parseIpRdap(json: unknown): RdapInfo`.

- [ ] **Step 1: Write the failing test** — `test/hostinfo-parse.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseDohA, parseDohPtr, parseIpRdap } from '../src/main/services/hostinfo/parse';

describe('parseDohA', () => {
  it('returns A-record IPs (type 1) and ignores other types', () => {
    expect(parseDohA({ Answer: [{ type: 1, data: '1.2.3.4' }, { type: 5, data: 'cname.example.' }, { type: 1, data: '5.6.7.8' }] })).toEqual(['1.2.3.4', '5.6.7.8']);
  });
  it('returns [] for no Answer / malformed', () => {
    expect(parseDohA({})).toEqual([]);
    expect(parseDohA('nope')).toEqual([]);
  });
});

describe('parseDohPtr', () => {
  it('returns the first PTR (type 12) hostname with the trailing dot stripped', () => {
    expect(parseDohPtr({ Answer: [{ type: 12, data: 'host149.telecom.com.ar.' }] })).toBe('host149.telecom.com.ar');
  });
  it('returns undefined when no PTR present', () => {
    expect(parseDohPtr({ Answer: [{ type: 1, data: '1.2.3.4' }] })).toBeUndefined();
    expect(parseDohPtr('nope')).toBeUndefined();
  });
});

describe('parseIpRdap', () => {
  it('extracts org (vcard fn), country, range, and asn', () => {
    const json = {
      handle: '190.210.0.0 - 190.210.255.255',
      startAddress: '190.210.0.0', endAddress: '190.210.255.255',
      country: 'AR',
      arin_originas0_originautnums: [7303],
      entities: [{ roles: ['registrant'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'Telecom Argentina S.A.']]] }]
    };
    expect(parseIpRdap(json)).toEqual({ org: 'Telecom Argentina S.A.', asn: 'AS7303', country: 'AR', range: '190.210.0.0 - 190.210.255.255' });
  });
  it('omits fields it cannot find; never throws on malformed input', () => {
    expect(parseIpRdap({})).toEqual({});
    expect(parseIpRdap('nope')).toEqual({});
  });
  it('derives range from start/end when handle is absent', () => {
    expect(parseIpRdap({ startAddress: '5.0.0.0', endAddress: '5.0.0.255' }).range).toBe('5.0.0.0 - 5.0.0.255');
  });
});
```

- [ ] **Step 2: Run test → FAIL** — `pnpm test -- hostinfo-parse`.

- [ ] **Step 3: Implement** — `src/main/services/hostinfo/parse.ts`:

```typescript
// Pure parsers for the resolver. RFC 8484 DoH JSON (cloudflare-dns) + RDAP-IP JSON (rdap.org). Each is
// defensive: malformed input yields empty/undefined, never throws. RDAP-IP field shapes vary by RIR;
// we target the common fields and omit what we can't find (see [speculative] in the spec).
import type { RdapInfo } from './types';

interface DohAnswer { type?: number; data?: string }
function answers(json: unknown): DohAnswer[] {
  const a = (json as { Answer?: unknown })?.Answer;
  return Array.isArray(a) ? (a as DohAnswer[]) : [];
}

export function parseDohA(json: unknown): string[] {
  return answers(json).filter((r) => r?.type === 1 && typeof r.data === 'string').map((r) => r.data as string);
}

export function parseDohPtr(json: unknown): string | undefined {
  const ptr = answers(json).find((r) => r?.type === 12 && typeof r.data === 'string')?.data;
  return ptr ? ptr.replace(/\.$/, '') : undefined;
}

/** Extract a vCard 'fn' (full name / org) from an RDAP entity's vcardArray. */
function vcardFn(entity: unknown): string | undefined {
  const arr = (entity as { vcardArray?: unknown }).vcardArray;
  if (!Array.isArray(arr) || !Array.isArray(arr[1])) return undefined;
  for (const field of arr[1] as unknown[]) {
    if (Array.isArray(field) && field[0] === 'fn' && typeof field[3] === 'string') return field[3];
  }
  return undefined;
}

export function parseIpRdap(json: unknown): RdapInfo {
  const out: RdapInfo = {};
  if (!json || typeof json !== 'object') return out;
  const o = json as Record<string, unknown>;
  // range: prefer handle, else start–end
  if (typeof o['handle'] === 'string' && (o['handle'] as string).includes('-')) out.range = (o['handle'] as string).trim();
  else if (typeof o['startAddress'] === 'string' && typeof o['endAddress'] === 'string') out.range = `${o['startAddress']} - ${o['endAddress']}`;
  if (typeof o['country'] === 'string') out.country = o['country'] as string;
  // asn: ARIN-style originas0 autnums
  const autnums = o['arin_originas0_originautnums'];
  if (Array.isArray(autnums) && typeof autnums[0] === 'number') out.asn = `AS${autnums[0]}`;
  // org: first entity vcard fn
  const entities = o['entities'];
  if (Array.isArray(entities)) {
    for (const e of entities) { const fn = vcardFn(e); if (fn) { out.org = fn; break; } }
  }
  return out;
}
```

- [ ] **Step 4: Run test → PASS**; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git -C /dcs98 add src/main/services/hostinfo/parse.ts test/hostinfo-parse.test.ts
git -C /dcs98 commit -m "feat(hostinfo): pure DoH-A/DoH-PTR/RDAP-IP parsers (defensive, never throw)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

### Task 3: Resolver orchestration (`hostinfo/resolve.ts`)

**Files:**
- Create: `src/main/services/hostinfo/resolve.ts`
- Test: `test/hostinfo-resolve.test.ts`

**Interfaces:**
- Consumes: `hostFromStreamUrl` (T1); `parseDohA`/`parseDohPtr`/`parseIpRdap` (T2); `HostInfo` (T1).
- Produces: `ResolveDeps`; `resolveHost(streamUrl: string, deps: ResolveDeps): Promise<HostInfo>`. `ResolveDeps = { fetchJson(url: string): Promise<unknown>; now(): string }` where `fetchJson` resolves the JSON of a Tor GET (throws on a blocked/non-200/parse failure — the resolver catches per-lookup).

- [ ] **Step 1: Write the failing test** — `test/hostinfo-resolve.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { resolveHost } from '../src/main/services/hostinfo/resolve';

const TS = '2026-02-02T00:00:00Z';
const now = () => TS;
function fetchRouter(map: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    for (const k of Object.keys(map)) if (url.includes(k)) return map[k];
    throw new Error('unexpected url: ' + url);
  });
}

describe('resolveHost', () => {
  it('IP literal: skips DNS-A, does PTR + RDAP, full profile', async () => {
    const fetchJson = fetchRouter({
      'PTR': { Answer: [{ type: 12, data: 'host149.telecom.com.ar.' }] },
      'rdap.org/ip/190.210.250.149': { handle: '190.210.0.0 - 190.210.255.255', country: 'AR', entities: [{ vcardArray: ['vcard', [['fn', {}, 'text', 'Telecom']]] }] }
    });
    const info = await resolveHost('http://190.210.250.149:91/v', { fetchJson, now });
    expect(info.host).toBe('190.210.250.149');
    expect(info.isIpLiteral).toBe(true);
    expect(info.ips).toEqual(['190.210.250.149']);
    expect(info.ptr).toBe('host149.telecom.com.ar');
    expect(info.rdap?.org).toBe('Telecom');
    expect(info.resolvedAt).toBe(TS);
    expect(info.errors).toEqual([]);
    // IP literal → no DNS-A query issued
    expect(fetchJson.mock.calls.find((c) => String(c[0]).includes('type=A'))).toBeUndefined();
  });
  it('hostname: does DNS-A then PTR+RDAP on the first IP', async () => {
    const fetchJson = fetchRouter({
      'type=A': { Answer: [{ type: 1, data: '5.6.7.8' }] },
      'PTR': { Answer: [{ type: 12, data: 'h.example.' }] },
      'rdap.org/ip/5.6.7.8': { country: 'US' }
    });
    const info = await resolveHost('https://cam.example.com/s', { fetchJson, now });
    expect(info.ips).toEqual(['5.6.7.8']);
    expect(info.ptr).toBe('h.example');
    expect(info.rdap?.country).toBe('US');
  });
  it('records per-lookup failures and still returns a partial (never throws)', async () => {
    const fetchJson = vi.fn(async (url: string) => { if (url.includes('rdap')) throw new Error('tor blocked'); return { Answer: [{ type: 12, data: 'h.' }] }; });
    const info = await resolveHost('http://1.2.3.4/v', { fetchJson, now });
    expect(info.ptr).toBe('h');
    expect(info.rdap).toBeUndefined();
    expect(info.errors).toContain('rdap-failed');
  });
  it('bad url → errors:[bad-url], no lookups', async () => {
    const fetchJson = vi.fn();
    const info = await resolveHost('not a url', { fetchJson, now });
    expect(info.errors).toEqual(['bad-url']);
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test → FAIL** — `pnpm test -- hostinfo-resolve`.

- [ ] **Step 3: Implement** — `src/main/services/hostinfo/resolve.ts`:

```typescript
// Resolver orchestration. Pure over injected deps (fetchJson = a Tor GET→JSON; now = ISO clock), so
// tests need no network. Each lookup is independent: a failure records into errors[] and the rest
// proceed; the partial HostInfo is always returned, never thrown. fetchJson MUST route through Tor
// (wired in the IPC handler) — this module never imports a fetch directly.
import { hostFromStreamUrl } from './extract';
import { parseDohA, parseDohPtr, parseIpRdap } from './parse';
import type { HostInfo } from './types';

export interface ResolveDeps { fetchJson(url: string): Promise<unknown>; now(): string }

const DOH = 'https://cloudflare-dns.com/dns-query';

/** Build the in-addr.arpa / ip6.arpa PTR query name for an IPv4 address (IPv6 omitted — best effort). */
function ptrName(ip: string): string | null {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  return m ? `${m[4]}.${m[3]}.${m[2]}.${m[1]}.in-addr.arpa` : null;
}

export async function resolveHost(streamUrl: string, deps: ResolveDeps): Promise<HostInfo> {
  const parsed = hostFromStreamUrl(streamUrl);
  if (!parsed) {
    return { host: '', isIpLiteral: false, ips: [], resolvedAt: deps.now(), errors: ['bad-url'] };
  }
  const errors: string[] = [];
  let ips: string[] = [];
  // 1. DNS A (only when host is a domain).
  if (parsed.isIpLiteral) {
    ips = [parsed.host];
  } else {
    try {
      ips = parseDohA(await deps.fetchJson(`${DOH}?name=${encodeURIComponent(parsed.host)}&type=A`));
      if (ips.length === 0) errors.push('dns-no-a');
    } catch { errors.push('dns-failed'); }
  }
  const primary = ips[0];
  let ptr: string | undefined;
  let rdap: HostInfo['rdap'];
  if (primary) {
    // 2. Reverse PTR.
    const pn = ptrName(primary);
    if (pn) {
      try { ptr = parseDohPtr(await deps.fetchJson(`${DOH}?name=${encodeURIComponent(pn)}&type=PTR`)); }
      catch { errors.push('ptr-failed'); }
    }
    // 3. RDAP on the IP.
    try {
      const r = parseIpRdap(await deps.fetchJson(`https://rdap.org/ip/${encodeURIComponent(primary)}`));
      if (Object.keys(r).length > 0) rdap = r;
    } catch { errors.push('rdap-failed'); }
  }
  return { host: parsed.host, isIpLiteral: parsed.isIpLiteral, ...(parsed.port ? { port: parsed.port } : {}), ips, ...(ptr ? { ptr } : {}), ...(rdap ? { rdap } : {}), resolvedAt: deps.now(), errors };
}
```

- [ ] **Step 4: Run test → PASS**; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git -C /dcs98 add src/main/services/hostinfo/resolve.ts test/hostinfo-resolve.test.ts
git -C /dcs98 commit -m "feat(hostinfo): resolver orchestration (injected Tor fetch, per-lookup fail-soft)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

### Task 4: Vault-backed store (`hostinfo/store.ts`)

**Files:**
- Create: `src/main/services/hostinfo/store.ts`
- Test: `test/hostinfo-store.test.ts`

**Interfaces:**
- Consumes: `HostInfo` from `./types`.
- Produces: `TTL_MS` (30 days); `makeHostInfoStore(deps: { readText(path:string): Promise<string>; writeFile(path:string, data:string): Promise<void>; now(): number })` → `{ load(host: string): Promise<HostInfo | null>; save(info: HostInfo): Promise<void> }`. `load` returns a cached `HostInfo` only if fresh (`now - Date.parse(resolvedAt) < TTL_MS`), else `null`.

- [ ] **Step 1: Write the failing test** — `test/hostinfo-store.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { makeHostInfoStore, TTL_MS } from '../src/main/services/hostinfo/store';
import type { HostInfo } from '../src/main/services/hostinfo/types';

function memFs(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    readText: vi.fn(async (p: string) => { if (!m.has(p)) { const e = new Error('no'); (e as NodeJS.ErrnoException).code = 'ENOENT'; throw e; } return m.get(p)!; }),
    writeFile: vi.fn(async (p: string, d: string) => { m.set(p, d); }),
    _m: m
  };
}
const info = (host: string, resolvedAt: string): HostInfo => ({ host, isIpLiteral: true, ips: [host], resolvedAt, errors: [] });
const NOW = Date.parse('2026-02-02T00:00:00Z');

describe('hostinfo store', () => {
  it('save then load returns a fresh entry', async () => {
    const fs = memFs(); const store = makeHostInfoStore({ ...fs, now: () => NOW });
    await store.save(info('1.2.3.4', '2026-02-01T00:00:00Z'));
    expect((await store.load('1.2.3.4'))?.host).toBe('1.2.3.4');
  });
  it('load returns null for a missing host', async () => {
    const store = makeHostInfoStore({ ...memFs(), now: () => NOW });
    expect(await store.load('9.9.9.9')).toBeNull();
  });
  it('load returns null for a stale entry (past TTL)', async () => {
    const stale = JSON.stringify({ '1.2.3.4': info('1.2.3.4', new Date(NOW - TTL_MS - 1).toISOString()) });
    const store = makeHostInfoStore({ ...memFs({ 'hostinfo/index.json': stale }), now: () => NOW });
    expect(await store.load('1.2.3.4')).toBeNull();
  });
  it('a missing index file (ENOENT) is treated as empty, not an error', async () => {
    const store = makeHostInfoStore({ ...memFs(), now: () => NOW });
    expect(await store.load('1.2.3.4')).toBeNull(); // no throw
  });
  it('corrupt index is treated as empty (cache miss)', async () => {
    const store = makeHostInfoStore({ ...memFs({ 'hostinfo/index.json': '{ not json' }), now: () => NOW });
    expect(await store.load('1.2.3.4')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test → FAIL** — `pnpm test -- hostinfo-store`.

- [ ] **Step 3: Implement** — `src/main/services/hostinfo/store.ts`:

```typescript
// Vault-backed cache of resolutions, one file hostinfo/index.json → Record<host, HostInfo>. Reads are
// fail-soft: a missing (ENOENT) or corrupt index is a cache miss (return null / treat as {}), never a
// throw. Freshness gated by TTL so stale hosting info re-resolves. fs deps + now() injected for tests;
// the real wiring passes secureReadText/secureWriteFile + Date.now.
import type { HostInfo } from './types';

export const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const INDEX = 'hostinfo/index.json';

export function makeHostInfoStore(deps: { readText(path: string): Promise<string>; writeFile(path: string, data: string): Promise<void>; now(): number }) {
  async function readIndex(): Promise<Record<string, HostInfo>> {
    let raw: string;
    try { raw = await deps.readText(INDEX); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw e; }
    try { return JSON.parse(raw) as Record<string, HostInfo>; }
    catch { return {}; } // corrupt → cache miss
  }
  return {
    async load(host: string): Promise<HostInfo | null> {
      const idx = await readIndex();
      const hit = idx[host];
      if (!hit) return null;
      const age = deps.now() - Date.parse(hit.resolvedAt);
      return Number.isFinite(age) && age >= 0 && age < TTL_MS ? hit : null;
    },
    async save(info: HostInfo): Promise<void> {
      const idx = await readIndex();
      idx[info.host] = info;
      await deps.writeFile(INDEX, JSON.stringify(idx, null, 2));
    }
  };
}

export type HostInfoStore = ReturnType<typeof makeHostInfoStore>;
```

- [ ] **Step 4: Run test → PASS**; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git -C /dcs98 add src/main/services/hostinfo/store.ts test/hostinfo-store.test.ts
git -C /dcs98 commit -m "feat(hostinfo): vault-backed resolution cache (TTL, ENOENT/corrupt = cache miss)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

### Task 5: Service facade + IPC wiring (`hostinfo/index.ts`, ipc-contracts, register, preload, api.d.ts)

**Files:**
- Create: `src/main/services/hostinfo/index.ts`
- Modify: `src/shared/ipc-contracts.ts` (add `hostinfo` channel)
- Modify: `src/main/ipc/register.ts` (register `hostinfo:resolve`)
- Modify: `src/preload/index.ts` (bridge) + `src/preload/api.d.ts` (type)
- Test: `test/hostinfo-service.test.ts`

**Interfaces:**
- Consumes: `resolveHost`/`ResolveDeps` (T3); `makeHostInfoStore` (T4); `hostFromStreamUrl` (T1); `ensurePluginTor`/`torFetch` (tor-egress); `secureReadText`/`secureWriteFile` (secure-fs).
- Produces: `makeHostInfoService(deps)` → `{ resolve(streamUrl: string, opts?: { force?: boolean }): Promise<HostInfo> }`; a real `hostInfoService` singleton; the `hostinfo:resolve` IPC channel returning `HostInfo`.

> The facade is cache-first: `load(host)` (unless `force`) → on miss, `resolveHost` via Tor → `save` → return. The Tor `fetchJson` adapter lives here: `ensurePluginTor()` once, then each call `torFetch(url, { headers: { Accept: 'application/dns-json' } })` → if `resp.blocked || resp.status !== 200` throw → else `JSON.parse(resp.body)`.

- [ ] **Step 1: Write the failing test** — `test/hostinfo-service.test.ts` (facade with injected resolver+store; verifies cache-first, force, and that a fresh cache hit skips the resolver):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { makeHostInfoService } from '../src/main/services/hostinfo/index';
import type { HostInfo } from '../src/main/services/hostinfo/types';

const info = (host: string): HostInfo => ({ host, isIpLiteral: true, ips: [host], resolvedAt: '2026-02-02T00:00:00Z', errors: [] });

function deps(cached: HostInfo | null) {
  const resolveHost = vi.fn(async (_url: string) => info('1.2.3.4'));
  const load = vi.fn(async (_host: string) => cached);
  const save = vi.fn(async (_i: HostInfo) => {});
  return { resolveHost, store: { load, save }, hostOf: (_url: string) => '1.2.3.4' };
}

describe('hostinfo service', () => {
  it('cache hit (fresh) returns cached and does NOT resolve', async () => {
    const d = deps(info('1.2.3.4'));
    const svc = makeHostInfoService(d as never);
    const r = await svc.resolve('http://1.2.3.4/v');
    expect(r.host).toBe('1.2.3.4');
    expect(d.resolveHost).not.toHaveBeenCalled();
  });
  it('cache miss resolves then saves', async () => {
    const d = deps(null);
    const svc = makeHostInfoService(d as never);
    await svc.resolve('http://1.2.3.4/v');
    expect(d.resolveHost).toHaveBeenCalledOnce();
    expect(d.store.save).toHaveBeenCalledOnce();
  });
  it('force bypasses the cache', async () => {
    const d = deps(info('1.2.3.4'));
    const svc = makeHostInfoService(d as never);
    await svc.resolve('http://1.2.3.4/v', { force: true });
    expect(d.resolveHost).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test → FAIL** — `pnpm test -- hostinfo-service`.

- [ ] **Step 3: Implement.**

`src/main/services/hostinfo/index.ts`:

```typescript
import { ensurePluginTor, torFetch } from '../../plugins/tor-egress';
import { secureReadText, secureWriteFile } from '../../storage/secure-fs';
import { hostFromStreamUrl } from './extract';
import { resolveHost as resolveHostImpl } from './resolve';
import { makeHostInfoStore } from './store';
import type { HostInfo } from './types';

export interface HostInfoServiceDeps {
  resolveHost(streamUrl: string): Promise<HostInfo>;
  store: { load(host: string): Promise<HostInfo | null>; save(info: HostInfo): Promise<void> };
  hostOf(streamUrl: string): string;
}

/** Cache-first facade. Pure over injected deps for testing; the real singleton (hostInfoService)
 *  wires the Tor fetch + vault store below. */
export function makeHostInfoService(deps: HostInfoServiceDeps) {
  return {
    async resolve(streamUrl: string, opts: { force?: boolean } = {}): Promise<HostInfo> {
      const host = deps.hostOf(streamUrl);
      if (!opts.force && host) {
        const cached = await deps.store.load(host);
        if (cached) return cached;
      }
      const info = await deps.resolveHost(streamUrl);
      if (info.host) await deps.store.save(info);
      return info;
    }
  };
}

/** Tor JSON GET — the recon egress path. Throws on blocked / non-200 / parse failure so the resolver
 *  records a per-lookup error and continues. */
async function torFetchJson(url: string): Promise<unknown> {
  await ensurePluginTor();
  const resp = await torFetch(url, { headers: { Accept: 'application/dns-json' } });
  if (resp.blocked || resp.status !== 200) throw new Error(`hostinfo lookup ${resp.status}${resp.blocked ? ' blocked' : ''}`);
  return JSON.parse(resp.body);
}

const store = makeHostInfoStore({ readText: secureReadText, writeFile: (p, d) => secureWriteFile(p, d), now: () => Date.now() });

export const hostInfoService = makeHostInfoService({
  resolveHost: (streamUrl) => resolveHostImpl(streamUrl, { fetchJson: torFetchJson, now: () => new Date().toISOString() }),
  store,
  hostOf: (streamUrl) => hostFromStreamUrl(streamUrl)?.host ?? ''
});

export type { HostInfo } from './types';
```

In `src/shared/ipc-contracts.ts`, add a `hostinfo` sibling next to `geoint`:

```typescript
  hostinfo: { resolve: 'hostinfo:resolve' },
```

In `src/main/ipc/register.ts`, register the handler (import `hostInfoService`):

```typescript
  safeHandle(channels.hostinfo.resolve, async (...args) => {
    const url = String(args[0] ?? '');
    const force = !!(args[1] as { force?: boolean } | undefined)?.force;
    return hostInfoService.resolve(url, { force });
  });
```

In `src/preload/index.ts`, add the bridge:

```typescript
  hostinfo: {
    resolve: (url: string, opts?: { force?: boolean }) => ipcRenderer.invoke(channels.hostinfo.resolve, url, opts)
  },
```

In `src/preload/api.d.ts`, add to the `GhostApi` interface (import/define `HostInfo` — re-export the type from a shared-safe location, or duplicate the structural type here to avoid a main→preload import; mirror how other main types reach api.d.ts):

```typescript
  hostinfo: {
    resolve(url: string, opts?: { force?: boolean }): Promise<HostInfo>;
  };
```

> Verify how api.d.ts imports types today (it references `GeoSnapshot` etc.). Follow that convention for `HostInfo` — if api.d.ts imports from `@shared/*`, move `HostInfo` to a shared types file; if it imports main types directly, import from `../main/services/hostinfo/types`. Pick the convention already in api.d.ts; do NOT introduce a new cross-boundary import style.

- [ ] **Step 4: Run test + full suite + typecheck** — `pnpm test -- hostinfo-service` → PASS; `pnpm test` → green (report count); `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git -C /dcs98 add src/main/services/hostinfo/index.ts src/shared/ipc-contracts.ts src/main/ipc/register.ts src/preload/index.ts src/preload/api.d.ts test/hostinfo-service.test.ts
git -C /dcs98 commit -m "feat(hostinfo): cache-first service facade + hostinfo:resolve IPC (Tor fetch, vault store)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

### Task 6: Renderer view + hook + `host-info` window module

**Files:**
- Create: `src/renderer/modules/hostinfo/HostInfoView.tsx`
- Create: `src/renderer/modules/hostinfo/HostInfoModule.tsx`
- Create: `src/renderer/modules/hostinfo/useHostInfo.ts`
- Modify: `src/renderer/modules/register-builtins.tsx` (register `host-info` + import + adapter)
- Modify: the `ModuleKey` union (add `'host-info'`)
- Test: none new (logic covered by T1–T5; renderer is typecheck + manual smoke — no React-render harness)

**Interfaces:**
- Consumes: `window.api.hostinfo.resolve` (T5); `HostInfo` type; `CameraStream`.
- Produces: `HostInfoView({ stream, defaultOpen? })`; `HostInfoModule({ stream })`; `useHostInfo()` hook; the `host-info` registered module.

- [ ] **Step 1: `useHostInfo` hook** — `src/renderer/modules/hostinfo/useHostInfo.ts`:

```typescript
import * as React from 'react';
import type { HostInfo } from '../../../preload/api.d'; // or the shared HostInfo type per api.d.ts convention

/** On-demand host resolution: call run() (e.g. when a panel expands) → resolve via Tor (IPC). */
export function useHostInfo(streamUrl: string): { info: HostInfo | null; loading: boolean; run: (force?: boolean) => void } {
  const [info, setInfo] = React.useState<HostInfo | null>(null);
  const [loading, setLoading] = React.useState(false);
  const run = React.useCallback((force?: boolean) => {
    setLoading(true);
    void window.api.hostinfo.resolve(streamUrl, force ? { force: true } : undefined)
      .then((r) => setInfo(r as HostInfo))
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, [streamUrl]);
  return { info, loading, run };
}
```

- [ ] **Step 2: `HostInfoView`** — `src/renderer/modules/hostinfo/HostInfoView.tsx`. A collapsible `<details>` (so it works inline in the camera window AND standalone). Lazily resolves on first open. Renders host profile, `resolvedAt`, a Refresh button, and a muted "couldn't resolve via Tor" note when `info.errors` is non-empty / `info` is null:

```tsx
import * as React from 'react';
import type { CameraStream } from '@shared/post-mvp-types';
import { useHostInfo } from './useHostInfo';

export function HostInfoView({ stream, defaultOpen = false }: { stream: CameraStream; defaultOpen?: boolean }): JSX.Element {
  const { info, loading, run } = useHostInfo(stream.url);
  const [opened, setOpened] = React.useState(false);
  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>): void => {
    if (e.currentTarget.open && !opened) { setOpened(true); run(); }
  };
  return (
    <details open={defaultOpen} onToggle={onToggle} style={{ fontSize: 11, padding: '4px 6px', borderTop: '1px solid #808080' }}>
      <summary style={{ cursor: 'pointer' }}>Host resolution{loading ? ' — resolving via Tor…' : ''}</summary>
      {info ? (
        <div style={{ marginTop: 4 }}>
          <div><b>host:</b> {info.host}{info.port ? `:${info.port}` : ''}{info.isIpLiteral ? ' (IP)' : ''}</div>
          {info.ips.length > 0 && <div><b>IP:</b> {info.ips.join(', ')}</div>}
          {info.ptr && <div><b>PTR:</b> {info.ptr}</div>}
          {info.rdap && <div><b>host:</b> {[info.rdap.org, info.rdap.asn, info.rdap.country, info.rdap.range].filter(Boolean).join(' · ')}</div>}
          {info.errors.length > 0 && <div style={{ color: '#a33' }}>Couldn’t fully resolve via Tor ({info.errors.join(', ')}).</div>}
          <button style={{ marginTop: 4 }} onClick={() => run(true)}>Refresh</button>
          <span style={{ opacity: 0.6, marginLeft: 6 }}>{info.resolvedAt}</span>
        </div>
      ) : (
        !loading && opened && <div style={{ color: '#a33', marginTop: 4 }}>Couldn’t resolve via Tor.</div>
      )}
    </details>
  );
}
```

- [ ] **Step 3: `HostInfoModule`** (EyeSpy window) — `src/renderer/modules/hostinfo/HostInfoModule.tsx`, mirroring `CameraViewModule`'s shell:

```tsx
import type { CameraStream } from '@shared/post-mvp-types';
import { HostInfoView } from './HostInfoView';

export function HostInfoModule({ stream }: { stream: CameraStream }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-panel" style={{ padding: '2px 6px', fontSize: 11, borderBottom: '1px solid #808080' }}>
        Host resolution — {stream.label}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 4 }}>
        <HostInfoView stream={stream} defaultOpen />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Register the module.** In `src/renderer/modules/register-builtins.tsx`: add the import, the adapter, and the `registerModule` call (mirror `camera-view`):

```typescript
import { HostInfoModule } from './hostinfo/HostInfoModule';
// …
function HostInfoAdapter({ spec }: { spec: WindowSpec }): JSX.Element {
  return <HostInfoModule stream={spec.props?.['stream'] as import('@shared/post-mvp-types').CameraStream} />;
}
// … alongside the other registerModule calls:
registerModule({ key: 'host-info', title: 'Host Info', glyph: '🖥', component: HostInfoAdapter, builtin: true, defaultWidth: 460, defaultHeight: 360 });
```

Add `'host-info'` to the `ModuleKey` union (locate it: `grep -rn "type ModuleKey" src/renderer`).

- [ ] **Step 5: Typecheck + full suite** — `pnpm typecheck` → clean; `pnpm test` → green (report count). Commit:

```bash
git -C /dcs98 add src/renderer/modules/hostinfo/ src/renderer/modules/register-builtins.tsx
# + the ModuleKey union file
git -C /dcs98 commit -m "feat(hostinfo): HostInfoView + useHostInfo + host-info window module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

### Task 7: Wire the two surfaces (GeoINT camera window + EyeSpy right-click)

**Files:**
- Modify: `src/renderer/modules/cameraview/CameraViewModule.tsx` (mount collapsible `HostInfoView`)
- Modify: `src/renderer/modules/eyespy/Finder.tsx` (`FeedAction` += `'resolve'`; menu entry)
- Modify: `src/renderer/modules/eyespy/EyeSpyModule.tsx` (`onFeedAction` `'resolve'` case → open `host-info` window)
- Test: none new (typecheck + manual smoke)

**Interfaces:**
- Consumes: `HostInfoView` (T6); `host-info` module (T6); `useWindows.getState().open` (existing).

- [ ] **Step 1: GeoINT inline (camera window).** In `CameraViewModule.tsx`, render `HostInfoView` as a collapsible section below the viewer (so clicking a camera in GeoINT → camera-view window → collapsible "Host resolution"):

```tsx
import { HostInfoView } from '../hostinfo/HostInfoView';
// … inside the returned tree, after the viewer <div>:
      <HostInfoView stream={stream} />
```

- [ ] **Step 2: EyeSpy `FeedAction` + menu.** In `Finder.tsx`: extend the union and add the menu entry:

```typescript
export type FeedAction = 'add' | 'play' | 'edit' | 'setloc' | 'delete' | 'resolve';
```
Add `['resolve', 'Resolve host (IP/DNS)']` to the menu action list array (the `[FeedAction, string][]` at ~line 115).

- [ ] **Step 3: EyeSpy `onFeedAction` case.** In `EyeSpyModule.tsx`, add a `case 'resolve'` that opens a `host-info` window (re-focus if already open), mirroring the camera-view open pattern:

```typescript
    case 'resolve': {
      const id = `hostinfo:${s.id}`;
      const existing = useWindows.getState().windows.find((w) => w.id === id);
      if (existing) useWindows.getState().focus(existing.id);
      else useWindows.getState().open({ module: 'host-info', id, title: `Host: ${s.label}`, props: { stream: s }, width: 460, height: 360 });
      break;
    }
```

> Verify `useWindows` is imported in EyeSpyModule (the camera-view `play`/window path or GeoInt shows the import); reuse `focus`/`open` exactly as the existing code does. If EyeSpy opens windows elsewhere already, match that call shape.

- [ ] **Step 4: Typecheck + full suite** — `pnpm typecheck` → clean; `pnpm test` → green (report count). Commit:

```bash
git -C /dcs98 add src/renderer/modules/cameraview/CameraViewModule.tsx src/renderer/modules/eyespy/Finder.tsx src/renderer/modules/eyespy/EyeSpyModule.tsx
git -C /dcs98 commit -m "feat(hostinfo): GeoINT camera-window inline panel + EyeSpy right-click 'Resolve host'

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZuGtL6z6QGEstpzHfRTnF"
```

---

### Task 8: Build, verify, egress audit

**Files:** none. Run from `/dcs98`.

- [ ] **Step 1:** `pnpm typecheck` → clean. `pnpm test` → all pass (report count; the new hostinfo-extract/parse/resolve/store/service suites + all existing).
- [ ] **Step 2:** `pnpm build` → builds with no errors (main + renderer + preload bundles).
- [ ] **Step 3: Egress audit (the charter check).** Grep the built main bundle for outbound hosts the hostinfo code introduced: `grep -rnoE 'https?://[a-zA-Z0-9.-]+' src/main/services/hostinfo` and confirm the ONLY hosts are `https://cloudflare-dns.com` and `https://rdap.org` — both already used by the recon path, both reached via `torFetch` (Tor). Confirm the hostinfo code contains NO `safeFetch`, NO bare `fetch(`, and NO connection to the camera's own URL: `grep -rnE 'safeFetch|globalThis.fetch|[^.]fetch\(' src/main/services/hostinfo` → expect ZERO matches (only `torFetch`/`fetchJson`). If any clearnet fetch or the camera URL is fetched, STOP and report.
- [ ] **Step 4:** Confirm no new Electron permission / capability was added (the feature is pure IPC + the existing Tor egress). `git -C /dcs98 diff --stat main` — review the file set matches this plan; nothing in `package.json`/entitlements changed.
- [ ] **Step 5:** Report the branch state (`git -C /dcs98 log --oneline main..HEAD`) and that it is LEFT ON THE BRANCH `feat/camera-host-resolution` for the operator to merge (core change — operator merges/ships). Do NOT merge, do NOT push.

## Manual verification (after Task 8 — needs the app + Tor)

1. GeoINT: click a CCTV camera → the camera window opens → expand "Host resolution" → IP/PTR/RDAP org·ASN·country·range appears (with Tor running). Collapse/expand works; Refresh re-resolves.
2. EyeSpy: right-click a CCTV feed → "Resolve host (IP/DNS)" → a Host window opens with the same profile.
3. With Tor unavailable: expanding shows "Couldn’t resolve via Tor" — no crash, no clearnet fallback.
4. Re-expanding the same camera within 30 days is instant (vault cache); Refresh forces a fresh Tor resolution.
5. Confirm (devtools network / Tor logs) the lookups go to cloudflare-dns.com + rdap.org over Tor only, and the app never connects to the camera's own IP for resolution.

## Notes / deviations (documented)

- **Egress reuses the plugin-egress Tor machinery** (`tor-egress.ts` `torFetch`/`ensurePluginTor`) from a core service — the only Tor in the app and exactly the recon path the operator pointed at. A future cleanup may extract a shared `src/main/net/tor-fetch.ts`; not required for v1 (YAGNI).
- **`torFetch` body is a raw string** → the `torFetchJson` adapter does `JSON.parse(resp.body)` and throws on `blocked`/non-200 so the resolver records a per-lookup error.
- **IPv6 PTR omitted** (`ptrName` handles IPv4 only) — best-effort; IPv6 cameras still get DNS-A(none, they're literals)/RDAP. Documented `[speculative]`-adjacent simplification.
- **RDAP-IP field extraction is best-effort across RIRs** (spec `[speculative]`) — `parseIpRdap` targets common fields, omits the rest, never throws.
- **Egress for the core app is genuinely new** (cloudflare-dns.com + rdap.org) but operator-approved (the feature IS host resolution) and routed through Tor — the audit confirms no host beyond the recon set and no clearnet path.
- **Core change — operator merges.** Left on `feat/camera-host-resolution`; no push, no release.
