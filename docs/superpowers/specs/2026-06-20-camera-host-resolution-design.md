# Camera Host Resolution (IP / DNS) — Design Spec (2026-06-20)

> Feature requested by GhostExodus for the core Ghost Intel 98 app (`/dcs98`). When you click a CCTV
> camera in GeoINT, an inline collapsible panel shows how/where the camera is hosted (IP, reverse
> DNS, RDAP org/ASN/country). In EyeSpy, right-clicking a feed pops the same resolution in its own
> window. All resolution lookups route through Tor — the same path the OSINT plugin's recon
> transforms use. Grounded against verified core code (file:line in the seam map below).

---

## Goal

Resolve a CCTV camera's hosting from its `stream_url` and present it at two surfaces:

- **GeoINT** — clicking a camera shows an inline, collapsible (`‹ ›`) "Host resolution" panel inherently
  attached to that feed.
- **EyeSpy** — right-clicking a CCTV feed opens its host resolution in its own draggable window (the
  camera-view window schema).

The "host profile" answers *how/where is this camera hosted*: the IP(s) behind the host, the reverse
DNS (PTR), and the RDAP network record (org, ASN, country, CIDR range).

---

## Charter-critical: egress routes through Tor (the recon path)

**Finding (verified):** the core app's *default* egress (`safeFetch`, `src/main/net/safe-fetch.ts:27`)
is SSRF-guarded **clearnet** — NOT Tor. The only Tor in the app is the plugin-egress machinery
`src/main/plugins/tor-egress.ts` (`torFetch` line 136, `ensurePluginTor` line 167), which is exactly
what the OSINT plugin's recon transforms (`recon-dns`/`recon-rdap`) route through.

**Decision (operator-confirmed):** the camera resolver routes **every** DoH/RDAP lookup through that
Tor machinery — not `safeFetch`. Concretely: the resolver calls `ensurePluginTor()` then `torFetch(url)`
for each lookup. To keep the layering clean, the implementation MAY extract a thin shared
`src/main/net/tor-fetch.ts` re-exporting/owning `torFetch`+`ensurePluginTor` so both the plugin egress
and the camera resolver depend on it (rather than a core service reaching into `src/main/plugins/`);
either way the runtime Tor path is identical to recon. Each resolution uses an **isolated circuit**
(the per-request RFC1929 credential isolation `torFetch` already supports), mirroring recon's per-call
isolation.

**Why private camera IPs are not an SSRF problem:** the lookups query *public* services (DoH at
`cloudflare-dns.com`, RDAP at `rdap.org`) *about* the camera's IP — they never connect to the camera.
The camera IP is a query parameter, not a fetch target. No new egress host beyond the recon set.

**No new egress host, no new capability, no telemetry, on-demand only** (a resolution fires when the
user expands the panel / opens the window — never auto-fired for every camera; a country can hold
hundreds of cameras and auto-resolution would be an egress storm).

---

## Architecture

```
src/main/services/hostinfo/
  resolve.ts     — resolveHost(streamUrl, deps) → HostInfo   (orchestration; Tor lookups)
  parse.ts       — pure parsers: parseDohA, parseDohPtr, parseIpRdap  (no I/O, unit-tested)
  extract.ts     — pure hostFromStreamUrl(url) → { host, isIpLiteral, port? }
  store.ts       — persist/load HostInfo in the encrypted vault, keyed by host, with a TTL
  types.ts       — HostInfo, HostInfoError

src/renderer/modules/hostinfo/
  HostInfoView.tsx     — shared presentational component (used inline AND in the window)
  HostInfoModule.tsx   — window-module wrapper (EyeSpy surface)
  useHostInfo.ts       — renderer hook: invoke('hostinfo:resolve', url) + loading/error state
```

- **Main service** owns all egress + parsing + persistence; pure functions (`parse.ts`, `extract.ts`)
  are unit-tested with no network. `resolve.ts` takes an injected `fetch` (the Tor `torFetch`) + an
  injected `now()` so tests are deterministic and network-free.
- **Renderer** renders the same `HostInfoView` inline (GeoINT) and in a window (EyeSpy). It never does
  any lookup itself — it calls one IPC method.

---

## Components

### `src/main/services/hostinfo/types.ts`

```ts
export interface HostInfo {
  host: string;            // extracted from stream_url (hostname or IP literal)
  isIpLiteral: boolean;
  port?: string;
  ips: string[];           // DNS A results (or [host] when host is already an IP literal)
  ptr?: string;            // reverse-DNS hostname for the primary IP
  rdap?: { org?: string; asn?: string; country?: string; range?: string };
  resolvedAt: string;      // ISO; injected (no Date.now() in the service path)
  errors: string[];        // per-lookup failures (e.g. 'dns-failed', 'rdap-failed'); partial results still returned
}
```

### `src/main/services/hostinfo/extract.ts` (pure)

`hostFromStreamUrl(streamUrl): { host: string; isIpLiteral: boolean; port?: string } | null` — `new
URL(streamUrl)`; `isIpLiteral` via `isIP()` (`node:net`, already imported in `security/validate.ts`).
Returns `null` for an unparseable URL.

### `src/main/services/hostinfo/parse.ts` (pure — mirrors the plugin recon parsers)

- `parseDohA(json): string[]` — RFC 8484 JSON `Answer[]` where `type === 1` (A) → IPs. (Mirrors the
  plugin `parseDoh` A-branch, `recon/parse.ts:42`.)
- `parseDohPtr(json): string | undefined` — `Answer[]` where `type === 12` (PTR) → first hostname
  (trailing-dot stripped).
- `parseIpRdap(json): { org?; asn?; country?; range? }` — RDAP **IP** object: `name`/`handle` → range,
  `country`, `entities[].vcardArray` org (fn), `arin`-style `autnums`/`startAddress`-`endAddress` →
  range; ASN from the RDAP network's autnum if present. (IP RDAP, distinct from the plugin's *domain*
  RDAP parser — documented difference.)

### `src/main/services/hostinfo/resolve.ts`

```ts
export interface ResolveDeps {
  fetch: (url: string, init?: { headers?: Record<string,string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  now: () => string;       // ISO timestamp injector
}
export async function resolveHost(streamUrl: string, deps: ResolveDeps): Promise<HostInfo>;
```

Steps (each independent; a failure records into `errors[]` and continues — partial result still
returned, never throws):
1. `hostFromStreamUrl` → host. If unparseable → `HostInfo` with `errors: ['bad-url']`.
2. If host is a domain: DoH A query (`cloudflare-dns.com/dns-query?name={host}&type=A`, header
   `Accept: application/dns-json`) → `ips`. If host is an IP literal: `ips = [host]`, skip A.
3. Reverse PTR: DoH PTR query on the primary IP (the `in-addr.arpa` name) → `ptr`.
4. RDAP IP: `rdap.org/ip/{primaryIp}` → `rdap { org, asn, country, range }`.
5. Stamp `resolvedAt = deps.now()`; return.

The IPC handler injects `deps.fetch = (u, init) => torFetch(u, init)` (after `ensurePluginTor()`) and
`deps.now = () => new Date().toISOString()`.

### `src/main/services/hostinfo/store.ts` (vault persistence)

Persist resolutions in the encrypted vault (reuse the app's existing secure-fs util — the same one the
chat stores use, e.g. `secureWriteFile`/`secureReadText`), in a single keyed file
`hostinfo/index.json` → `Record<host, HostInfo>`. `load(host)` returns a cached `HostInfo` if present
**and** fresh (`resolvedAt` within a TTL, default **30 days**); otherwise the caller re-resolves.
`save(info)` upserts by host. Corrupt read → treated as cache-miss (re-resolve), never throws.

### IPC

- Contract: add `hostinfo: { resolve: 'hostinfo:resolve' }` to `src/shared/ipc-contracts.ts` (channels,
  alongside `geoint` at line 248).
- Preload: `hostinfo: { resolve: (url, opts?) => ipcRenderer.invoke(channels.hostinfo.resolve, url, opts) }`
  in `src/preload/index.ts`.
- Main: `safeHandle(channels.hostinfo.resolve, async (url, opts) => hostinfo.resolve(String(url), { force: !!opts?.force }))`
  in `src/main/ipc/register.ts`. The handler: `load(host)` (fresh cache → return it unless
  `opts.force`); else `ensurePluginTor()` → `resolveHost(url, { fetch: torFetch, now })` → `save()` →
  return. A `force` flag (re-resolve, ignore cache) backs a "refresh" affordance.

### Renderer surfaces

- **Shared `HostInfoView`**: renders `host`, `ips`, `ptr`, RDAP `org · ASN · country · range`, the
  `resolvedAt` timestamp, a "Refresh" button (calls with `force`), and any `errors` as a muted
  "couldn't resolve via Tor" note. Loading state while in flight.
- **GeoINT (inline, collapsible):** in `GeoIntModule.tsx`, the camera click already opens a camera-view
  window (`onCameraOpen`, line 218). Add a collapsible `‹ ›` "Host resolution" section into the
  camera-view window's chrome (or the camera info area) that lazily calls `useHostInfo(stream.url)` on
  first expand. Collapsed by default.
- **EyeSpy (right-click → window):** in `eyespy/Finder.tsx` add a `'resolve'` action to the feed
  context menu (line 115 list); `EyeSpyModule`'s `onFeedAction` opens a new `host-info` window
  (`useWindows.getState().open({ module: 'host-info', id: 'hostinfo:'+stream.id, props: { stream } })`).
  Register the `host-info` module in `register-builtins.tsx` (the 5-point pattern; camera-view at line
  201 is the template) → `HostInfoModule` renders `HostInfoView` for `props.stream.url`.

---

## Data flow

```
GeoINT expand ‹ › / EyeSpy right-click 'resolve'
  → useHostInfo(stream.url) → window.api.hostinfo.resolve(url)
  → main safeHandle → hostinfo.resolve:
       load(host) fresh? → return cached
       else ensurePluginTor() → resolveHost(url, { fetch: torFetch (isolated circuit), now }):
            DoH A → ips ; DoH PTR → ptr ; RDAP ip → org/asn/country/range   (all via Tor)
       → save(info) to vault → return HostInfo
  → HostInfoView renders (host profile + resolvedAt + refresh + partial-error note)
```

No lookup ever leaves Tor. No connection is ever made to the camera itself.

---

## Error handling

- **Tor unavailable / a lookup fails:** that lookup records into `errors[]`; other lookups proceed;
  the partial `HostInfo` is returned and rendered with a "couldn't resolve via Tor" note. The resolver
  NEVER throws to the caller and NEVER falls back to a non-Tor fetch.
- **Unparseable `stream_url`:** `HostInfo` with `errors: ['bad-url']`, no lookups attempted.
- **Private/RFC1918 camera IP:** lookups still run (they query public DoH/RDAP about the IP); RDAP may
  return no useful network record → `rdap` omitted, recorded as a soft note. Not an error state.
- **Corrupt vault cache:** treated as a cache miss (re-resolve), never throws.
- **Malformed DoH/RDAP JSON:** the pure parsers return empty/undefined; recorded as a per-lookup error.

---

## Testing

All tests on Linux, no live network (injected `fetch`):
- `extract.test.ts` — IP literal vs hostname vs port vs unparseable.
- `parse.test.ts` — `parseDohA` (A records), `parseDohPtr` (PTR, trailing-dot strip), `parseIpRdap`
  (org/asn/country/range from a real RDAP-IP fixture; missing fields omitted; malformed → empty).
- `resolve.test.ts` — full profile via a mock `fetch` returning canned DoH/RDAP; IP-literal path skips
  the A query; a failing lookup records into `errors[]` and the rest still resolve; `resolvedAt` is the
  injected value; never throws.
- `store.test.ts` — save→load round-trip on an in-memory secure-fs mock; fresh-within-TTL hit; stale
  (past TTL) → miss; corrupt → miss; no throw.
- Renderer (`HostInfoView`, surfaces): typecheck + manual smoke (no React-render harness), per the
  established posture.

---

## Charter alignment

- **Egress through Tor** (operator-confirmed): every lookup via `torFetch`/`ensurePluginTor` — the recon
  path — with an isolated circuit. Never `safeFetch`, never a raw fetch, never a connection to the camera.
- **No new egress host** (cloudflare-dns.com + rdap.org already used by recon), **no new capability**,
  **no telemetry**, **on-demand only**.
- **Encrypted at rest:** resolutions persist via the existing vault secure-fs util.
- **Determinism where it matters:** `resolvedAt` injected; pure parsers/extractor; TTL is a constant.
- **No silent weakening:** if Tor is down, the feature degrades to a visible "couldn't resolve" note —
  it does not silently exit clearnet.

## New capability / core change

The resolver reuses the existing `tor-egress.ts` Tor machinery (optionally extracted to a shared
`src/main/net/tor-fetch.ts` for clean layering). New: the `hostinfo` service + IPC channel + the
`host-info` window module + the GeoINT inline panel + the EyeSpy menu action. No new Electron
permission, no new outbound host, no change to the plugin egress capability.

## [speculative] flags

- `[speculative]` RDAP-IP field extraction varies by RIR (ARIN/RIPE/APNIC/LACNIC/AFRINIC) JSON shape;
  `parseIpRdap` targets the common fields (org via vCard `fn`, `country`, `startAddress`/`endAddress` or
  `handle` for range, autnum for ASN) and omits what it can't find. Real-world coverage is a field-test
  finding; the parser degrades to partial, never throws.
- `[speculative]` 30-day TTL is a default; hosting can change. A "Refresh" button forces re-resolution.
