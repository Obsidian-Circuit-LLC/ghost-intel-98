# Tor-Routed Plugin Egress (Plan 03) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route plugin `ctx.egress` through a dedicated bundled-Tor SOCKS proxy by default — resolving the `wire-deps.ts:20-24` TODO — so the OSINT plugin's network transforms (Plan 04) run over Tor.

**Architecture:** Add RFC 1929 username/password auth to the pure `socks5.ts` codec (for Tor `IsolateSOCKSAuth` per-request circuit isolation). A new `src/main/plugins/tor-egress.ts` provides an HTTP(S)-over-SOCKS Node `Agent` (built-ins only — `net`/`tls`/`http`/`https`) plus a lazily-started dedicated `BgconnTor` instance, and a `torFetch()` that maps results to `PluginFetchResponse` with three-valued `blocked` semantics. `wire-deps.ts` `rawFetch` is rewired: Tor by default, `init.direct === true` → existing direct fetch, both still behind the `isPublicHttpUrl` SSRF gate.

**Tech Stack:** TypeScript, Node `net`/`tls`/`http`/`https` (no new dependency), the existing `BgconnTor` class + bundled Tor, vitest. This is a **core `/dcs98` (public MIT)** change.

**Security note:** this is a new network path in security-critical core. A red-team pass on `tor-egress.ts` + the rewired `rawFetch` is a required end-gate (DNS/SSRF over Tor, credential leakage on redirect, fail-open on Tor-down, port confusion).

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/main/chat/socks5.ts` (modify) | Add RFC 1929 username/password greeting + auth codec (keep no-auth helpers for chat) |
| `src/main/plugins/tor-egress.ts` (new) | SOCKS5 handshake driver, HTTP(S)-over-SOCKS `Agent`, dedicated-Tor lifecycle, `torFetch()` |
| `src/main/plugins/wire-deps.ts` (modify) | Rewire `rawFetch`: Tor default vs `direct`; keep SSRF + credential-strip |
| `src/main/index.ts` (modify) | Lazy-init the plugin-egress Tor + `registerTeardown` to kill it at quit |
| `test/socks5-auth.test.ts` | RFC 1929 codec |
| `test/plugin-tor-egress.test.ts` | handshake driver over a mock socket; `blocked`/`direct` mapping |

---

### Task 1: SOCKS5 username/password auth codec (RFC 1929)

**Files:**
- Modify: `src/main/chat/socks5.ts`
- Test: `test/socks5-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/socks5-auth.test.ts
import { describe, it, expect } from 'vitest';
import { buildGreeting, parseMethodSelection, buildUserPassAuth, parseUserPassReply } from '../src/main/chat/socks5';

describe('SOCKS5 RFC 1929 username/password', () => {
  it('buildGreeting() with auth offers both no-auth (0x00) and userpass (0x02)', () => {
    expect(Array.from(buildGreeting({ auth: true }))).toEqual([0x05, 0x02, 0x00, 0x02]);
    expect(Array.from(buildGreeting())).toEqual([0x05, 0x01, 0x00]); // default unchanged (chat)
  });
  it('parseMethodSelection reports the selected method', () => {
    expect(parseMethodSelection(Uint8Array.of(0x05, 0x00))).toEqual({ ok: true, method: 0x00 });
    expect(parseMethodSelection(Uint8Array.of(0x05, 0x02))).toEqual({ ok: true, method: 0x02 });
    expect(parseMethodSelection(Uint8Array.of(0x05, 0xff))).toEqual({ ok: false, method: 0xff });
    expect(parseMethodSelection(Uint8Array.of(0x05))).toBeNull();
  });
  it('buildUserPassAuth encodes VER=1, ulen, user, plen, pass', () => {
    expect(Array.from(buildUserPassAuth('ab', 'cde'))).toEqual([0x01, 2, 0x61, 0x62, 3, 0x63, 0x64, 0x65]);
  });
  it('rejects over-long credentials', () => {
    expect(() => buildUserPassAuth('x'.repeat(256), 'p')).toThrow();
  });
  it('parseUserPassReply: status 0 ok, non-zero not ok, <2 bytes null', () => {
    expect(parseUserPassReply(Uint8Array.of(0x01, 0x00))).toEqual({ ok: true });
    expect(parseUserPassReply(Uint8Array.of(0x01, 0x01))).toEqual({ ok: false });
    expect(parseUserPassReply(Uint8Array.of(0x01))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test test/socks5-auth.test.ts`
Expected: FAIL ("buildUserPassAuth is not a function"; `buildGreeting` rejects an argument).

- [ ] **Step 3: Implement** — edit `src/main/chat/socks5.ts`. Add `const METHOD_USERPASS = 0x02;` near the other method constants. Replace `buildGreeting` + `parseMethodSelection`, and append the auth codec:

```ts
/** Client greeting. Default offers only "no authentication" (chat onion dialing).
 *  `{ auth: true }` additionally offers username/password (RFC 1929) for Tor IsolateSOCKSAuth. */
export function buildGreeting(opts: { auth?: boolean } = {}): Uint8Array {
  return opts.auth ? Uint8Array.of(VER, 2, METHOD_NOAUTH, METHOD_USERPASS) : Uint8Array.of(VER, 1, METHOD_NOAUTH);
}

/** Parse the server's method selection. Returns null until 2 bytes; `ok` iff a method we offered
 *  was chosen (not 0xFF), and the chosen `method` so the caller knows whether to do the userpass
 *  sub-negotiation. */
export function parseMethodSelection(buf: Uint8Array): { ok: boolean; method: number } | null {
  if (buf.length < 2) return null;
  if (buf[0] !== VER) throw new Socks5Error(`bad SOCKS version ${buf[0]}`);
  return { ok: buf[1] !== 0xff, method: buf[1] };
}

/** RFC 1929 auth request: VER(0x01) ULEN user PLEN pass. */
export function buildUserPassAuth(user: string, pass: string): Uint8Array {
  const u = new TextEncoder().encode(user), p = new TextEncoder().encode(pass);
  if (u.length < 1 || u.length > 255 || p.length < 1 || p.length > 255) throw new Socks5Error('SOCKS credential length out of range');
  const out = new Uint8Array(1 + 1 + u.length + 1 + p.length);
  out[0] = 0x01; out[1] = u.length; out.set(u, 2); out[2 + u.length] = p.length; out.set(p, 3 + u.length);
  return out;
}

/** RFC 1929 auth reply: VER STATUS. Returns null until 2 bytes; `ok` iff STATUS === 0. */
export function parseUserPassReply(buf: Uint8Array): { ok: boolean } | null {
  if (buf.length < 2) return null;
  return { ok: buf[1] === 0x00 };
}
```

> Note: `parseMethodSelection`'s return shape changed (added `method`). Update its only existing caller in `src/main/chat/transport-tor.ts` to read `.ok` (it already checks `.ok`); confirm by `pnpm typecheck`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test test/socks5-auth.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean (the no-auth chat path still compiles + works).

- [ ] **Step 5: Commit**

```bash
git add src/main/chat/socks5.ts test/socks5-auth.test.ts
git commit -m "feat(socks5): RFC 1929 username/password auth codec (for Tor circuit isolation)"
```

---

### Task 2: SOCKS5 handshake driver (over an injected duplex)

**Files:**
- Create: `src/main/plugins/tor-egress.ts`
- Test: `test/plugin-tor-egress.test.ts`

The driver runs the SOCKS5 + RFC 1929 + CONNECT handshake on an already-connected duplex (injected, so it's unit-testable without a real Tor). It resolves when the tunnel to `host:port` is open, or rejects with a typed reason (`blocked` vs `error`).

- [ ] **Step 1: Write the failing test**

```ts
// test/plugin-tor-egress.test.ts
import { describe, it, expect, vi } from 'vitest';
import { socksConnect, SocksBlockedError } from '../src/main/plugins/tor-egress';

// A fake duplex: records writes, lets the test push reply bytes via emit('data').
function fakeSock() {
  const listeners: Record<string, ((d?: unknown) => void)[]> = {};
  return {
    writes: [] as Uint8Array[],
    on(ev: string, fn: (d?: unknown) => void) { (listeners[ev] ??= []).push(fn); return this; },
    once(ev: string, fn: (d?: unknown) => void) { (listeners[ev] ??= []).push(fn); return this; },
    removeListener() { return this; },
    write(b: Uint8Array) { this.writes.push(b); return true; },
    emit(ev: string, d?: unknown) { (listeners[ev] ?? []).forEach((f) => f(d)); },
    destroy: vi.fn()
  };
}

describe('socksConnect', () => {
  it('runs greeting → userpass auth → CONNECT and resolves on success', async () => {
    const s = fakeSock();
    const p = socksConnect(s as never, { host: 'example.com', port: 443, user: 'u', pass: 'p' });
    s.emit('data', Uint8Array.of(0x05, 0x02));           // method selection: userpass
    await Promise.resolve();
    s.emit('data', Uint8Array.of(0x01, 0x00));           // auth OK
    await Promise.resolve();
    s.emit('data', Uint8Array.of(0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0)); // CONNECT success (IPv4 bnd)
    await expect(p).resolves.toBeUndefined();
    expect(s.writes.length).toBe(3); // greeting, auth, connect
  });
  it('maps a CONNECT failure (REP!=0) to SocksBlockedError (Tor exit refused)', async () => {
    const s = fakeSock();
    const p = socksConnect(s as never, { host: 'x.onion', port: 80, user: 'u', pass: 'p' });
    s.emit('data', Uint8Array.of(0x05, 0x02)); await Promise.resolve();
    s.emit('data', Uint8Array.of(0x01, 0x00)); await Promise.resolve();
    s.emit('data', Uint8Array.of(0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0)); // REP=5 connection refused
    await expect(p).rejects.toBeInstanceOf(SocksBlockedError);
  });
  it('rejects (not blocked) if auth is refused', async () => {
    const s = fakeSock();
    const p = socksConnect(s as never, { host: 'x', port: 80, user: 'u', pass: 'p' });
    s.emit('data', Uint8Array.of(0x05, 0x02)); await Promise.resolve();
    s.emit('data', Uint8Array.of(0x01, 0x01)); // auth FAIL
    await expect(p).rejects.toThrow(/auth/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test test/plugin-tor-egress.test.ts`
Expected: FAIL ("socksConnect is not a function").

- [ ] **Step 3: Implement** — create `src/main/plugins/tor-egress.ts` with the driver (the Agent + lifecycle + torFetch are added in later tasks):

```ts
// src/main/plugins/tor-egress.ts — route plugin egress through a dedicated bundled Tor SOCKS proxy.
import type { Duplex } from 'node:stream';
import { buildGreeting, parseMethodSelection, buildUserPassAuth, parseUserPassReply, buildConnectDomain, parseConnectReply, socksReplyMessage } from '../chat/socks5';

/** Tor refused to reach the target (SOCKS REP != 0). Distinct from a transport error so callers
 *  can surface three-valued found/not-found/BLOCKED instead of a false negative. */
export class SocksBlockedError extends Error { constructor(m: string) { super(m); this.name = 'SocksBlockedError'; } }

interface SocksTarget { host: string; port: number; user: string; pass: string }

/** Drive the SOCKS5 + RFC 1929 + CONNECT handshake on an already-connected socket. Resolves when
 *  the tunnel is open. Per-request {user,pass} → a distinct Tor circuit (IsolateSOCKSAuth). */
export function socksConnect(sock: Duplex, t: SocksTarget): Promise<void> {
  return new Promise((resolve, reject) => {
    type Phase = 'method' | 'auth' | 'connect';
    let phase: Phase = 'method';
    let buf = new Uint8Array(0);
    const onErr = (e: unknown): void => { cleanup(); reject(e instanceof Error ? e : new Error(String(e))); };
    const cleanup = (): void => { sock.removeListener('data', onData); sock.removeListener('error', onErr); };
    function onData(chunk: Buffer): void {
      buf = Uint8Array.from([...buf, ...chunk]);
      try {
        if (phase === 'method') {
          const m = parseMethodSelection(buf); if (!m) return;
          if (!m.ok) { onErr(new Error('SOCKS: no acceptable auth method')); return; }
          buf = buf.subarray(2);
          if (m.method === 0x02) { phase = 'auth'; sock.write(buildUserPassAuth(t.user, t.pass)); }
          else { phase = 'connect'; sock.write(buildConnectDomain(t.host, t.port)); }
        }
        if (phase === 'auth') {
          const a = parseUserPassReply(buf); if (!a) return;
          if (!a.ok) { onErr(new Error('SOCKS: username/password auth failed')); return; }
          buf = buf.subarray(2); phase = 'connect'; sock.write(buildConnectDomain(t.host, t.port));
          return;
        }
        if (phase === 'connect') {
          const r = parseConnectReply(buf); if (!r) return;
          cleanup();
          if (!r.ok) reject(new SocksBlockedError(`Tor exit: ${socksReplyMessage(r.rep)}`)); else resolve();
        }
      } catch (e) { onErr(e); }
    }
    sock.on('data', onData); sock.on('error', onErr);
    sock.write(buildGreeting({ auth: true }));
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test test/plugin-tor-egress.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/plugins/tor-egress.ts test/plugin-tor-egress.test.ts
git commit -m "feat(tor-egress): SOCKS5+RFC1929 CONNECT handshake driver (blocked vs error)"
```

---

### Task 3: HTTP(S)-over-SOCKS Agent + dedicated-Tor lifecycle + torFetch

**Files:**
- Modify: `src/main/plugins/tor-egress.ts`

> Integration glue around real sockets/TLS/Tor — verified by `pnpm typecheck` + the Task 2 unit tests staying green + the manual live-Tor smoke (no headless test can reach a real exit). No new unit test; do NOT fake your way to a green test against real network.

- [ ] **Step 1: Implement** — append to `src/main/plugins/tor-egress.ts`:

```ts
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { randomBytes } from 'node:crypto';
import type { PluginFetchInit, PluginFetchResponse } from './context';
import { BgconnTor } from '../bgconn/tor';

const MAX_BODY = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

// --- dedicated plugin-egress Tor (compartmented from chat/bgconn circuits) ---
let pluginTor: BgconnTor | null = null;
/** Inject the started, bootstrapped dedicated Tor (wired in index.ts). null ⇒ egress unavailable. */
export function setPluginTor(t: BgconnTor | null): void { pluginTor = t; }
export function getPluginTorSocksPort(): number | null { return pluginTor ? pluginTor.socksPort() : null; }

/** A custom Agent whose createConnection tunnels through the plugin Tor SOCKS proxy with a
 *  per-request credential (→ a distinct Tor circuit), then (for https) TLS-wraps the tunnel. */
function makeSocksAgent(socksPort: number, secure: boolean): HttpAgent | HttpsAgent {
  const Base = secure ? HttpsAgent : HttpAgent;
  const agent = new Base({ keepAlive: false, maxSockets: 8 });
  // @ts-expect-error createConnection is the documented Agent override hook
  agent.createConnection = (opts: { host: string; port: number; servername?: string }, cb: (err: Error | null, sock?: unknown) => void): void => {
    const raw = netConnect({ host: '127.0.0.1', port: socksPort });
    raw.once('error', (e) => cb(e));
    socksConnect(raw, { host: opts.host, port: Number(opts.port), user: randomBytes(8).toString('hex'), pass: randomBytes(16).toString('hex') })
      .then(() => {
        if (!secure) { cb(null, raw); return; }
        const tls = tlsConnect({ socket: raw, servername: opts.servername ?? opts.host });
        tls.once('secureConnect', () => cb(null, tls));
        tls.once('error', (e) => cb(e));
      })
      .catch((e) => { raw.destroy(); cb(e); });
  };
  return agent;
}

/** Fetch `url` over Tor. Returns a PluginFetchResponse; a Tor-exit refusal / SOCKS / TLS / timeout
 *  failure → { blocked:true } (three-valued), a real HTTP response → status+body. Throws only if
 *  the dedicated Tor isn't available. Does NOT follow redirects — wire-deps owns redirect policy. */
export function torFetch(url: string, init: PluginFetchInit = {}): Promise<PluginFetchResponse> {
  const socksPort = getPluginTorSocksPort();
  if (socksPort === null) return Promise.reject(new Error('plugin Tor egress not started'));
  const u = new URL(url);
  const secure = u.protocol === 'https:';
  const agent = makeSocksAgent(socksPort, secure);
  const reqFn = secure ? httpsRequest : httpRequest;
  return new Promise((resolve) => {
    const blocked = (): void => resolve({ status: 0, body: '', finalUrl: url, blocked: true });
    const req = reqFn(url, { method: init.method ?? 'GET', headers: init.headers, agent: agent as never, timeout: TIMEOUT_MS }, (res) => {
      const chunks: Buffer[] = []; let len = 0;
      res.on('data', (c: Buffer) => { len += c.length; if (len > MAX_BODY) { req.destroy(); resolve({ status: res.statusCode ?? 0, body: '', finalUrl: url }); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), finalUrl: url }));
      res.on('error', blocked);
    });
    req.on('error', (e) => (e instanceof SocksBlockedError ? blocked() : blocked())); // SOCKS/connection error → blocked
    req.on('timeout', () => { req.destroy(); blocked(); });
    if (init.body) req.write(init.body);
    req.end();
  });
}
```

- [ ] **Step 2: Typecheck + the unit suite**

Run: `pnpm typecheck && pnpm test test/plugin-tor-egress.test.ts`
Expected: clean; 3 tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/main/plugins/tor-egress.ts
git commit -m "feat(tor-egress): HTTP(S)-over-SOCKS agent + dedicated-Tor torFetch (blocked semantics)"
```

---

### Task 4: Dedicated-Tor lifecycle wiring (index.ts) + rewire rawFetch (wire-deps.ts)

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/plugins/wire-deps.ts`

- [ ] **Step 1: Lazy-start the dedicated Tor in `index.ts`.** Mirror the existing bgconn Tor instantiation (`src/main/index.ts:280-290`) — same bundled-tor resolver and `listen(0)` free-port helper, but a DISTINCT `dataDir` and freshly-allocated ports (so the plugin-egress circuits are compartmented from chat AND bgconn). Start lazily on first plugin egress (no Tor process when no plugin uses the network). Add (top-level in `index.ts`, exported so `wire-deps.ts` can call it):

```ts
import { BgconnTor } from './bgconn/tor';
import { setPluginTor } from './plugins/tor-egress';
import { registerTeardown } from './plugins/loader';

let pluginTorStarting: Promise<void> | null = null;
/** Lazily start a dedicated, compartmented Tor for plugin egress. Retryable after a failed start. */
export function ensurePluginTor(): Promise<void> {
  if (pluginTorStarting) return pluginTorStarting;
  pluginTorStarting = (async () => {
    const { torPaths } = await import('./chat/transport-tor');
    const net = await import('node:net');
    const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
    const bundleDir = join(base, 'tor', 'win-x64');
    const dataDir = join(app.getPath('userData'), 'plugin-egress', 'tor-data');
    const freePort = (): Promise<number> => new Promise((res, rej) => {
      const s = net.createServer();
      s.once('error', rej);
      s.listen(0, '127.0.0.1', () => { const p = (s.address() as import('node:net').AddressInfo).port; s.close(() => res(p)); });
    });
    const [socksPort, controlPort] = await Promise.all([freePort(), freePort()]);
    const tor = new BgconnTor({ torExe: torPaths(bundleDir).torExe, dataDir, socksPort, controlPort });
    await tor.start(); // resolves on "Bootstrapped 100%" (BgconnTor.start)
    setPluginTor(tor);
    registerTeardown('__plugin-egress-tor__', async () => { setPluginTor(null); await tor.stop(); });
  })().catch((e) => { pluginTorStarting = null; throw e; }); // null-out so a later egress can retry
  return pluginTorStarting;
}
```

Also confirm the before-quit path tears it down: `disableAllPlugins()` (already called at quit) runs the registered `__plugin-egress-tor__` teardown, which `await tor.stop()`s (kills the tor.exe → frees the data-dir lock), mirroring the chat/bgTor `.stop()` at `index.ts:355-357`. If the quit path does NOT call `disableAllPlugins`, add an explicit `await getPluginTor()?.stop()` there.

- [ ] **Step 2: Rewire `rawFetch` in `wire-deps.ts`.** Replace the direct-only `rawFetch` with: ensure the dedicated Tor is up, then `torFetch`; `init.direct === true` keeps the existing direct global-fetch path (still SSRF-validated upstream + here). Keep the cross-origin credential-strip on redirects. The contract: a Tor-down/SOCKS/exit failure is surfaced as `{ blocked:true }` (already from `torFetch`); the direct path is unchanged.

```ts
// in fullDeps(...): rawFetch becomes —
rawFetch: async (url, init) => {
  if (init.direct === true) return directFetch(url, init);          // existing direct path (extracted/kept)
  await ensurePluginTor();                                          // lazy-start the dedicated Tor
  return torFetch(url, init);                                       // Tor by default, blocked-on-refusal
},
```

(`directFetch` = the current global-fetch implementation, factored out unchanged; it still runs behind `isPublicHttpUrl` (context.ts validates before rawFetch) and applies the credential-strip on cross-origin redirects.)

- [ ] **Step 3: Typecheck + full suite**

Run: `pnpm typecheck && pnpm test`
Expected: clean; all existing tests green (no plugin currently has the `egress` cap, so production behavior is unchanged until a plugin opts in; the chat no-auth SOCKS path is untouched).

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/main/plugins/wire-deps.ts
git commit -m "feat(plugins): route ctx.egress through a dedicated Tor by default (direct opt-out)"
```

---

### Task 5: Red-team end-gate + manual live-Tor smoke

- [ ] **Step 1: Red-team review** (dispatch the `red-teamer`; this is a new core network path). Must check: (a) **fail-closed** — if the dedicated Tor fails to start, does egress fall back to *direct* (leak) or fail/`blocked`? It must NOT silently go direct. (b) **SSRF over Tor** — `isPublicHttpUrl` runs on the URL host before fetch; confirm a private/loopback target can't be reached even via the Tor exit's DNS. (c) **credential leakage** — the per-request SOCKS creds are random throwaways (fine); confirm request `Authorization`/`Cookie` headers are stripped on cross-origin redirect (redirect handling lives where? confirm `torFetch` does NOT auto-follow and wire-deps owns it). (d) **`direct:true`** — is it reachable by a plugin without consent? It's gated by the `egress` cap + `networkEnabled`; confirm `direct` doesn't bypass `isPublicHttpUrl`. (e) **port confusion** — the dedicated Tor's ports are distinct from chat/bgconn; a collision must fail-closed, not cross-wire circuits. Fix every finding before proceeding.

- [ ] **Step 2: Manual live-Tor smoke** (operator/dev, owed — can't run headless): a dev plugin with the `egress` cap + `networkEnabled` calls `ctx.egress.fetch('https://check.torproject.org/api/ip')` → confirm the JSON reports a Tor exit IP (`IsTor: true`); call with `{ direct: true }` → confirm a non-Tor IP; point at an unreachable host → confirm `blocked: true`, not a thrown error or a false "not found".

- [ ] **Step 3: Final commit** (only if Step 1 produced fixes; otherwise nothing to commit).

---

## Self-review notes
- **Determinism:** N/A to correctness — the only randomness is the throwaway per-request SOCKS creds (intended, for circuit isolation; `randomBytes`, not `Math.random`).
- **No new dependency:** `net`/`tls`/`http`/`https`/`crypto` built-ins + the existing `BgconnTor` + `socks5.ts`.
- **Backward-compatible:** chat's no-auth SOCKS path is untouched (default `buildGreeting()` unchanged); no plugin has the `egress` cap today, so shipped behavior is unchanged until a plugin opts in.
- **Grounded:** `socks5.ts` codec, `BgconnTor` ({torExe,dataDir,socksPort,controlPort} + start/kill), `PluginFetchInit.direct?`/`PluginFetchResponse.blocked?`, `isPublicHttpUrl` SSRF gate, credential-strip on redirect — all verified in core 2026-06-12.
- **Open (build-time):** the implementer must read the existing BgconnTor instantiation + bundled-tor path resolver + port selection and fill Task 4 Step 1 from them — do NOT invent the tor exe path or ports.
```
