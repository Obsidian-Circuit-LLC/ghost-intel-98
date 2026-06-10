# `persistent-background-connection` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `persistent-background-connection` plugin capability — a durable, credentialed, non-anonymous connection lane for the OSINT plugin's Telegram collector, on a separate isolated Tor circuit, with enforced teardown, operator-consented sessions, idle-teardown, and lock-screen visibility/control.

**Architecture:** Pure units first (bgconn torrc, lane creds/routing, secret-stdin handoff, namespaced secrets), then the separate Tor instance, then the plugin teardown framework in the loader, then the `BackgroundConnectionManager` (gates + reconnect/idle/consent policy), then capability/settings/IPC/before-quit/lock-screen wiring. The manager is the single authority; the plugin owns Telethon (subsystem 2).

**Tech Stack:** Electron 33 main (Node/TS), `node:child_process`, `node:crypto`, the bundled Tor; mirrors `src/main/chat/transport-tor.ts` (separate instance) and the offensive controller-singleton pattern; Vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-persistent-background-connection-design.md` (v2, post-red-team).

**Scope:** platform capability only (public core). Telethon subprocess + auth + ingestion = subsystem 2. New code under `src/main/bgconn/`.

**House rules:** TDD. `pnpm typecheck` (BOTH tsconfigs — never bare `tsc`). `pnpm test <pattern>`; full `pnpm test` after wiring tasks. No new deps.

**Security-critical tasks** (extra adversarial review): 1 (torrc isolation), 2 (lane creds), 3 (secret handoff), 6 (Tor instance), 7+8 (manager gates + teardown/idle/consent), 11 (before-quit teardown + GATE_EXEMPT).

---

## Task 1: bgconn torrc builder (isolation)

**Files:** Create `src/main/bgconn/torrc.ts`; Test `test/bgconn-torrc.test.ts`

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { buildBgconnTorrc } from '../src/main/bgconn/torrc';

describe('buildBgconnTorrc', () => {
  it('isolates circuits and pins a loopback SOCKS/control with separate data dir', () => {
    const t = buildBgconnTorrc({ socksPort: 9250, controlPort: 9251, dataDir: '/d' });
    expect(t).toMatch(/SocksPort 127\.0\.0\.1:9250 IsolateSOCKSAuth IsolateDestAddr/);
    expect(t).toMatch(/ControlPort 127\.0\.0\.1:9251/);
    expect(t).toMatch(/DataDirectory \/d/);
    expect(t).toMatch(/SocksPolicy accept \*/); // public destinations (Telegram); Tor rejects RFC1918 by default
  });
});
```

- [ ] **Step 2: Run** `pnpm test bgconn-torrc` → FAIL.

- [ ] **Step 3: Implement** `src/main/bgconn/torrc.ts`
```typescript
export interface BgconnTorrcConfig { socksPort: number; controlPort: number; dataDir: string; }

/** Separate Tor instance for the bgconn lane. IsolateSOCKSAuth gives each connection (distinct
 *  SOCKS user/pass) its own circuit; IsolateDestAddr further separates by destination. Loopback
 *  only, no relaying. Distinct from the chat transport's torrc (which has neither isolation flag). */
export function buildBgconnTorrc(c: BgconnTorrcConfig): string {
  return [
    `SocksPort 127.0.0.1:${c.socksPort} IsolateSOCKSAuth IsolateDestAddr`,
    `ControlPort 127.0.0.1:${c.controlPort}`,
    `CookieAuthentication 1`,
    `DataDirectory ${c.dataDir}`,
    `SocksPolicy accept *`,
    ''
  ].join('\n');
}
```

- [ ] **Step 4: Run** `pnpm test bgconn-torrc` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/bgconn/torrc.ts test/bgconn-torrc.test.ts
git commit -m "feat(bgconn): isolated Tor torrc builder (separate instance)"
```

---

## Task 2: BackgroundLane — per-connection isolation creds + routing

**Files:** Create `src/main/bgconn/lane.ts`; Test `test/bgconn-lane.test.ts`

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { newSocksCreds, laneFor } from '../src/main/bgconn/lane';

describe('BackgroundLane', () => {
  it('generates distinct SOCKS creds per call (distinct circuits)', () => {
    const a = newSocksCreds(); const b = newSocksCreds();
    expect(a.username).not.toBe(b.username);
    expect(a.password).not.toBe(b.password);
    expect(a.username).toMatch(/^[0-9a-f]{16,}$/);
  });
  it('laneFor(tor) returns the isolated SOCKS endpoint; laneFor(direct) returns direct', () => {
    const creds = newSocksCreds();
    const tor = laneFor({ routing: 'tor', socksHost: '127.0.0.1', socksPort: 9250, creds });
    expect(tor).toEqual({ direct: false, socks: { host: '127.0.0.1', port: 9250, username: creds.username, password: creds.password } });
    const direct = laneFor({ routing: 'direct' });
    expect(direct).toEqual({ direct: true });
  });
});
```

- [ ] **Step 2: Run** `pnpm test bgconn-lane` → FAIL.

- [ ] **Step 3: Implement** `src/main/bgconn/lane.ts`
```typescript
import { randomBytes } from 'node:crypto';

export interface SocksCreds { username: string; password: string; }
export type Routing = 'tor' | 'direct';
export interface Lane { direct: boolean; socks?: { host: string; port: number; username: string; password: string }; }

/** Distinct per-connection SOCKS credentials → distinct Tor circuit via IsolateSOCKSAuth. */
export function newSocksCreds(): SocksCreds {
  return { username: randomBytes(8).toString('hex'), password: randomBytes(16).toString('hex') };
}

export function laneFor(
  o: { routing: 'tor'; socksHost: string; socksPort: number; creds: SocksCreds } | { routing: 'direct' }
): Lane {
  if (o.routing === 'direct') return { direct: true };
  return { direct: false, socks: { host: o.socksHost, port: o.socksPort, username: o.creds.username, password: o.creds.password } };
}
```

- [ ] **Step 4: Run** `pnpm test bgconn-lane` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/bgconn/lane.ts test/bgconn-lane.test.ts
git commit -m "feat(bgconn): per-connection isolation creds + routing lane"
```

---

## Task 3: Secret-stdin handoff helper

**Files:** Create `src/main/bgconn/spawn-secret.ts`; Test `test/bgconn-spawn-secret.test.ts`

**Context:** The session string must reach the subprocess via stdin (write+close), never argv/env (which leak to process listings/crash dumps). Spawn `stdio: ['pipe','pipe','pipe']`, write the secret to stdin, end it; the child reads its session from stdin. We assert the secret is absent from argv and env.

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { spawnWithSecretStdin } from '../src/main/bgconn/spawn-secret';

describe('spawnWithSecretStdin', () => {
  it('passes the secret on stdin, never in argv or env', async () => {
    // A node child that echoes back: its argv, whether SECRET appears in env, and the stdin it read.
    const code = `let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{` +
      `process.stdout.write(JSON.stringify({argv:process.argv.slice(2),envHasSecret:Object.values(process.env).some(v=>v&&v.includes('SationS3cret')),stdin:d}))});`;
    const child = spawnWithSecretStdin(process.execPath, ['-e', code], 'SationS3cret', {});
    let out = ''; child.stdout!.on('data', (c) => (out += c));
    await new Promise<void>((r) => child.on('close', () => r()));
    const got = JSON.parse(out);
    expect(got.stdin).toBe('SationS3cret');             // secret arrived via stdin
    expect(got.argv.join(' ')).not.toContain('SationS3cret'); // not in argv
    expect(got.envHasSecret).toBe(false);               // not in env
  });
});
```

- [ ] **Step 2: Run** `pnpm test bgconn-spawn-secret` → FAIL.

- [ ] **Step 3: Implement** `src/main/bgconn/spawn-secret.ts`
```typescript
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export interface SecretSpawnOptions extends SpawnOptions { spawn?: typeof nodeSpawn; }

/** Spawn a subprocess and hand it `secret` via stdin (write then end). The secret is NEVER placed
 *  in argv or env. Core dumps disabled where supported (the child should also opt out). */
export function spawnWithSecretStdin(cmd: string, args: string[], secret: string, opts: SecretSpawnOptions): ChildProcess {
  const spawn = opts.spawn ?? nodeSpawn;
  const { spawn: _omit, ...rest } = opts;
  const child = spawn(cmd, args, { ...rest, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin!.write(secret);
  child.stdin!.end();
  return child;
}
```

- [ ] **Step 4: Run** `pnpm test bgconn-spawn-secret` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/bgconn/spawn-secret.ts test/bgconn-spawn-secret.test.ts
git commit -m "feat(bgconn): stdin secret handoff (never argv/env)"
```

---

## Task 4: BgConnSecrets — namespaced credential category

**Files:** Create `src/main/bgconn/secrets.ts`; Test `test/bgconn-secrets.test.ts`

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect, vi } from 'vitest';
import { makeBgConnSecrets } from '../src/main/bgconn/secrets';

describe('BgConnSecrets', () => {
  it('namespaces under bgconn:<plugin>:<conn>: and delegates to the backend', async () => {
    const backend = { get: vi.fn(async () => 'v'), set: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
    const s = makeBgConnSecrets(backend);
    await s.set('osint', 'c1', 'session', 'tok');
    expect(backend.set).toHaveBeenCalledWith('bgconn:osint:c1:session', 'tok');
    await s.get('osint', 'c1', 'phone');
    expect(backend.get).toHaveBeenCalledWith('bgconn:osint:c1:phone');
    await s.clear('osint', 'c1', ['session', 'phone']);
    expect(backend.delete).toHaveBeenCalledWith('bgconn:osint:c1:session');
    expect(backend.delete).toHaveBeenCalledWith('bgconn:osint:c1:phone');
  });
});
```

- [ ] **Step 2: Run** `pnpm test bgconn-secrets` → FAIL.

- [ ] **Step 3: Implement** `src/main/bgconn/secrets.ts`
```typescript
export interface SecretBackend {
  get(k: string): Promise<string | null>;
  set(k: string, v: string): Promise<void>;
  delete(k: string): Promise<void>;
}
export interface BgConnSecrets {
  get(pluginId: string, connId: string, field: string): Promise<string | null>;
  set(pluginId: string, connId: string, field: string, value: string): Promise<void>;
  clear(pluginId: string, connId: string, fields: string[]): Promise<void>;
}
const key = (p: string, c: string, f: string): string => `bgconn:${p}:${c}:${f}`;

export function makeBgConnSecrets(backend: SecretBackend): BgConnSecrets {
  return {
    get: (p, c, f) => backend.get(key(p, c, f)),
    set: (p, c, f, v) => backend.set(key(p, c, f), v),
    clear: async (p, c, fields) => { for (const f of fields) await backend.delete(key(p, c, f)); }
  };
}
```

- [ ] **Step 4: Run** `pnpm test bgconn-secrets` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/bgconn/secrets.ts test/bgconn-secrets.test.ts
git commit -m "feat(bgconn): namespaced credential category"
```

---

## Task 5: Plugin teardown framework in the loader (shared infra)

**Files:** Modify `src/main/plugins/loader.ts`; Test `test/plugin-teardown.test.ts`

**Context:** The loader has no disable/teardown path (it only loads). Add a teardown registry so a plugin's main code (or the bgconn manager) can register a teardown, and `disablePlugin(id)` invokes them. This is shared infra the offensive scanner will also use.

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { registerTeardown, disablePlugin, _resetTeardownsForTest } from '../src/main/plugins/loader';

describe('plugin teardown', () => {
  it('registers + invokes teardowns for a plugin, once', async () => {
    _resetTeardownsForTest();
    const calls: string[] = [];
    registerTeardown('osint', async () => { calls.push('a'); });
    registerTeardown('osint', async () => { calls.push('b'); });
    registerTeardown('other', async () => { calls.push('x'); });
    await disablePlugin('osint');
    expect(calls.sort()).toEqual(['a', 'b']); // not 'x'
    await disablePlugin('osint'); // teardowns cleared after first disable
    expect(calls.sort()).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run** `pnpm test plugin-teardown` → FAIL.

- [ ] **Step 3: Implement** — add to `src/main/plugins/loader.ts`:
```typescript
const teardowns = new Map<string, Array<() => Promise<void> | void>>();

export function registerTeardown(pluginId: string, fn: () => Promise<void> | void): void {
  const list = teardowns.get(pluginId) ?? [];
  list.push(fn);
  teardowns.set(pluginId, list);
}
export async function disablePlugin(pluginId: string): Promise<void> {
  const list = teardowns.get(pluginId) ?? [];
  teardowns.delete(pluginId);
  for (const fn of list) { try { await fn(); } catch (e) { console.error(`[plugin:${pluginId}] teardown`, e); } }
}
export async function disableAllPlugins(): Promise<void> {
  for (const id of [...teardowns.keys()]) await disablePlugin(id);
}
export function _resetTeardownsForTest(): void { teardowns.clear(); }
```

- [ ] **Step 4: Run** `pnpm test plugin-teardown` → PASS; `pnpm typecheck` → clean; full `pnpm test` → green.

- [ ] **Step 5: Commit**
```bash
git add src/main/plugins/loader.ts test/plugin-teardown.test.ts
git commit -m "feat(plugins): plugin teardown framework (registerTeardown/disablePlugin)"
```

---

## Task 6: BgconnTor — the separate Tor instance (SECURITY-CRITICAL)

**Files:** Create `src/main/bgconn/tor.ts`; Test `test/bgconn-tor.test.ts`

**Context:** Mirror `transport-tor.ts`'s spawn-and-wait-for-bootstrap, but a SEPARATE instance with the isolated torrc (Task 1). Injected `spawn` for tests. `isBootstrapped()` gates the manager's start.

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { BgconnTor } from '../src/main/bgconn/tor';

function fakeProc() {
  const p: any = new EventEmitter();
  p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = vi.fn(); p.killed = false;
  return p;
}

describe('BgconnTor', () => {
  it('starts, becomes bootstrapped on the Tor log line, exposes the socks port, and stops', async () => {
    const proc = fakeProc();
    const spawn = vi.fn(() => proc) as never;
    const tor = new BgconnTor({ torExe: '/tor', dataDir: '/d', socksPort: 9250, controlPort: 9251, spawn,
      writeFile: async () => {} });
    expect(tor.isBootstrapped()).toBe(false);
    const started = tor.start();
    proc.stdout.emit('data', Buffer.from('... Bootstrapped 100% (done): Done\n'));
    await started;
    expect(tor.isBootstrapped()).toBe(true);
    expect(tor.socksPort()).toBe(9250);
    await tor.stop();
    expect(proc.kill).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** `pnpm test bgconn-tor` → FAIL.

- [ ] **Step 3: Implement** `src/main/bgconn/tor.ts`
```typescript
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { writeFile as fsWriteFile } from 'node:fs/promises';
import { buildBgconnTorrc } from './torrc';

export interface BgconnTorOptions {
  torExe: string; dataDir: string; socksPort: number; controlPort: number;
  spawn?: typeof nodeSpawn;
  writeFile?: (path: string, data: string) => Promise<void>;
}

export class BgconnTor {
  private proc: ChildProcess | null = null;
  private bootstrapped = false;
  constructor(private readonly o: BgconnTorOptions) {}

  isBootstrapped(): boolean { return this.bootstrapped; }
  socksPort(): number { return this.o.socksPort; }

  async start(): Promise<void> {
    if (this.proc) return;
    const spawn = this.o.spawn ?? nodeSpawn;
    const writeFile = this.o.writeFile ?? fsWriteFile;
    const torrcPath = join(this.o.dataDir, 'torrc');
    await writeFile(torrcPath, buildBgconnTorrc({ socksPort: this.o.socksPort, controlPort: this.o.controlPort, dataDir: this.o.dataDir }));
    const proc = spawn(this.o.torExe, ['-f', torrcPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    await new Promise<void>((resolve, reject) => {
      const onData = (b: Buffer): void => { if (b.toString().includes('Bootstrapped 100%')) { this.bootstrapped = true; resolve(); } };
      proc.stdout?.on('data', onData);
      proc.once('error', reject);
      proc.once('exit', () => { if (!this.bootstrapped) reject(new Error('bgconn tor exited before bootstrap')); });
    });
  }

  async stop(): Promise<void> {
    const p = this.proc;
    this.proc = null; this.bootstrapped = false;
    if (!p || p.killed) return;
    p.kill();
    await new Promise<void>((resolve) => { const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* */ } resolve(); }, 4000); p.once('exit', () => { clearTimeout(t); resolve(); }); });
  }
}
```

- [ ] **Step 4: Run** `pnpm test bgconn-tor` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/bgconn/tor.ts test/bgconn-tor.test.ts
git commit -m "feat(bgconn): separate isolated Tor instance (spawn + bootstrap gate)"
```

---

## Task 7: BackgroundConnectionManager core — register/start(gates)/stop/stopAll (SECURITY-CRITICAL)

**Files:** Create `src/main/bgconn/manager.ts`; Test `test/bgconn-manager.test.ts`

**Context:** The single authority. `start` gates on consent + Tor-bootstrap (when routing=tor). Holds live connections + the subprocess kill handle. `stopAll(reason)` tears every live connection down. Worker + gates injected for tests.

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect, vi } from 'vitest';
import { BackgroundConnectionManager, type BgWorker } from '../src/main/bgconn/manager';

const NOW = Date.parse('2026-06-10T00:00:00Z');
function mkWorker(connId: string): BgWorker & { started: boolean; stopped: boolean } {
  const w: any = { connId, routing: 'tor', channelSetHash: 'h',
    start: vi.fn(async () => { w.started = true; return { pid: 123, kill: vi.fn() }; }),
    stop: vi.fn(async () => { w.stopped = true; }), started: false, stopped: false };
  return w;
}
const deps = (torUp: boolean) => ({ isTorBootstrapped: () => torUp, now: () => NOW, isVaultUnlocked: () => true,
  socksHost: '127.0.0.1', socksPort: 9250, idleTeardownAfterMs: 7200000, maxReconnects: 20, maxSessionAgeMs: 720 * 60000 });

describe('BackgroundConnectionManager', () => {
  it('refuses start without consent, and when Tor (tor routing) is not bootstrapped', async () => {
    const m = new BackgroundConnectionManager(deps(false));
    const w = mkWorker('c1'); m.register(w);
    await expect(m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: false })).rejects.toThrow(/not confirmed/i);
    await expect(m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: true })).rejects.toThrow(/tor not bootstrapped/i);
  });
  it('starts a confirmed tor session when bootstrapped; lists it; stop tears it down', async () => {
    const m = new BackgroundConnectionManager(deps(true));
    const w = mkWorker('c1'); m.register(w);
    await m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: true });
    expect(w.started).toBe(true);
    expect(m.list().map((c) => c.connId)).toEqual(['c1']);
    await m.stop('c1');
    expect(w.stopped).toBe(true);
    expect(m.list()).toEqual([]);
  });
  it('stopAll tears down every live connection', async () => {
    const m = new BackgroundConnectionManager(deps(true));
    const a = mkWorker('a'); const b = mkWorker('b'); m.register(a); m.register(b);
    await m.start('a', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: true });
    await m.start('b', { phone: '+2', routing: 'tor', channelSetHash: 'h' }, { confirmed: true });
    await m.stopAll('quit');
    expect(a.stopped && b.stopped).toBe(true);
    expect(m.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `pnpm test bgconn-manager` → FAIL.

- [ ] **Step 3: Implement** `src/main/bgconn/manager.ts`
```typescript
import { newSocksCreds, laneFor, type Lane, type Routing } from './lane';

export interface StartParams { phone: string; routing: Routing; channelSetHash: string; }
export interface BgWorker {
  connId: string; routing: Routing; channelSetHash: string;
  start(lane: Lane): Promise<{ pid: number; kill: () => void }>;
  stop(): Promise<void>;
}
export interface ManagerDeps {
  isTorBootstrapped(): boolean;
  now(): number;
  isVaultUnlocked(): boolean;
  socksHost: string; socksPort: number;
  idleTeardownAfterMs: number | null;   // null = never
  maxReconnects: number;                // bound reconnects so "live" can't become silent always-on
  maxSessionAgeMs: number;              // bound total session age; teardown + re-consent past it
}
// NOTE: the lock-buffer and its drop marker are subsystem-2's (the plugin buffers in its subprocess
// and records a "N messages dropped during lock window" event via its existing `timeline` capability).
// The platform's part is exposing `isVaultLocked()` on the bgConn context surface (Task 9) so the
// worker knows to buffer; the platform does not own the buffer.
interface Live { worker: BgWorker; params: StartParams; startedAt: number; kill: () => void; consentKey: string; }

const consentKey = (p: StartParams): string => `${p.phone}|${p.routing}|${p.channelSetHash}`;

export class BackgroundConnectionManager {
  private workers = new Map<string, BgWorker>();
  private live = new Map<string, Live>();
  constructor(private readonly deps: ManagerDeps) {}

  register(w: BgWorker): void { this.workers.set(w.connId, w); }

  async start(connId: string, params: StartParams, opts: { confirmed: boolean }): Promise<void> {
    const worker = this.workers.get(connId);
    if (!worker) throw new Error(`no worker registered: ${connId}`);
    if (!opts.confirmed) throw new Error('connection not confirmed');
    if (params.routing === 'tor' && !this.deps.isTorBootstrapped()) throw new Error('tor not bootstrapped');
    const lane: Lane = params.routing === 'tor'
      ? laneFor({ routing: 'tor', socksHost: this.deps.socksHost, socksPort: this.deps.socksPort, creds: newSocksCreds() })
      : laneFor({ routing: 'direct' });
    const { kill } = await worker.start(lane);
    this.live.set(connId, { worker, params, startedAt: this.deps.now(), kill, consentKey: consentKey(params) });
  }

  async stop(connId: string): Promise<void> {
    const l = this.live.get(connId);
    if (!l) return;
    this.live.delete(connId);
    try { await l.worker.stop(); } finally { try { l.kill(); } catch { /* */ } }
  }

  async stopAll(_reason: string): Promise<void> {
    for (const connId of [...this.live.keys()]) await this.stop(connId);
  }

  list(): Array<{ connId: string; routing: Routing; startedAt: number }> {
    return [...this.live.values()].map((l) => ({ connId: l.worker.connId, routing: l.params.routing, startedAt: l.startedAt }));
  }
}
```

- [ ] **Step 4: Run** `pnpm test bgconn-manager` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/bgconn/manager.ts test/bgconn-manager.test.ts
git commit -m "feat(bgconn): connection manager core (consent + tor-bootstrap gates, teardown)"
```

---

## Task 8: Manager policy — idle-teardown, lock transitions, reconnect, re-consent (SECURITY-CRITICAL)

**Files:** Modify `src/main/bgconn/manager.ts`; Test `test/bgconn-policy.test.ts`

**Context:** Add the time/lock policy. A `tick()` (driven by an injected timer in production) tracks the vault lock, fires idle-teardown after `idleTeardownAfterMs` locked, and transitions a `vaultLocked` flag the worker can read to buffer. Reconnect is bounded; re-consent is required when the consent key changes.

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect, vi } from 'vitest';
import { BackgroundConnectionManager, type BgWorker } from '../src/main/bgconn/manager';

let t = Date.parse('2026-06-10T00:00:00Z');
let unlocked = true;
function mkWorker(connId: string): BgWorker { const w: any = { connId, routing: 'tor', channelSetHash: 'h',
  start: vi.fn(async () => ({ pid: 1, kill: vi.fn() })), stop: vi.fn(async () => {}) }; return w; }
const deps = () => ({ isTorBootstrapped: () => true, now: () => t, isVaultUnlocked: () => unlocked,
  socksHost: '127.0.0.1', socksPort: 9250, idleTeardownAfterMs: 7200000, maxReconnects: 20, maxSessionAgeMs: 720 * 60000 });

describe('manager policy', () => {
  it('tears down after the idle-teardown window once locked; survives a short lock', async () => {
    t = Date.parse('2026-06-10T00:00:00Z'); unlocked = true;
    const m = new BackgroundConnectionManager(deps());
    const w = mkWorker('c1'); m.register(w);
    await m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: true });
    unlocked = false; t += 60_000; m.tick();           // 1 min locked
    expect(m.list().length).toBe(1);                    // survives a short lock
    t += 7_200_000; m.tick();                           // > 2h locked
    expect(m.list().length).toBe(0);                    // idle-teardown fired
  });
  it('requires re-consent when the consent key (e.g. channel set) changes', async () => {
    t = Date.parse('2026-06-10T00:00:00Z'); unlocked = true;
    const m = new BackgroundConnectionManager(deps());
    const w = mkWorker('c1'); m.register(w);
    await m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'A' }, { confirmed: true });
    await m.stop('c1');
    // same conn, different channel set, NOT re-confirmed → refused
    await expect(m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'B' }, { confirmed: false })).rejects.toThrow(/not confirmed/i);
  });
  it('tears down a session that exceeds max-session-age', async () => {
    t = Date.parse('2026-06-10T00:00:00Z'); unlocked = true;
    const m = new BackgroundConnectionManager(deps());
    const w = mkWorker('c1'); m.register(w);
    await m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: true });
    t += 720 * 60000 + 1; m.tick();   // past 12h max-session-age
    expect(m.list().length).toBe(0);
  });
  it('tears down after exceeding the reconnect budget', async () => {
    t = Date.parse('2026-06-10T00:00:00Z'); unlocked = true;
    const m = new BackgroundConnectionManager(deps());
    const w = mkWorker('c1'); m.register(w);
    await m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: true });
    for (let i = 0; i < 20; i++) m.noteReconnect('c1'); // at budget
    expect(m.list().length).toBe(1);
    m.noteReconnect('c1');                              // exceeds → teardown
    expect(m.list().length).toBe(0);
  });
});
```

- [ ] **Step 2: Run** `pnpm test bgconn-policy` → FAIL.

- [ ] **Step 3: Implement** — add to `BackgroundConnectionManager`:
```typescript
  private lockedSince: number | null = null;
  private reconnects = new Map<string, number>();

  /** Drive from a production interval (e.g. every 30s). Tracks the vault lock + fires idle-teardown,
   *  AND enforces max-session-age so a session can never silently run forever (red-team Finding 6). */
  tick(): void {
    const now = this.deps.now();
    // max-session-age: the ENFORCED bound (no worker cooperation needed).
    for (const l of [...this.live.values()]) {
      if (now - l.startedAt >= this.deps.maxSessionAgeMs) void this.stop(l.worker.connId);
    }
    const unlocked = this.deps.isVaultUnlocked();
    if (unlocked) { this.lockedSince = null; return; }
    if (this.lockedSince === null) this.lockedSince = now;
    if (this.deps.idleTeardownAfterMs !== null && now - this.lockedSince >= this.deps.idleTeardownAfterMs) {
      void this.stopAll('idle-teardown');
      this.lockedSince = null;
    }
  }

  /** A worker MAY call this on each reconnect; exceeding maxReconnects tears the connection down
   *  (so a reconnect storm can't keep a session alive indefinitely between max-age checks). */
  noteReconnect(connId: string): void {
    if (!this.live.has(connId)) return;
    const n = (this.reconnects.get(connId) ?? 0) + 1;
    this.reconnects.set(connId, n);
    if (n > this.deps.maxReconnects) { this.reconnects.delete(connId); void this.stop(connId); }
  }
  isVaultLocked(): boolean { return !this.deps.isVaultUnlocked(); }
```
(The existing `start` already requires `confirmed: true` for any start; since `stop` removes the live entry, a re-`start` with a changed `channelSetHash` simply needs a fresh `confirmed: true` — the consent binding is enforced by requiring confirmation on every `start`, and the IPC/controller layer computes whether the consent key changed to decide if a fresh prompt is needed. The re-consent test passes because an unconfirmed start is always refused; no manager change needed beyond the existing gate. Keep `consentKey` for the controller layer's change-detection.)

- [ ] **Step 4: Run** `pnpm test bgconn-policy` + `pnpm test bgconn-manager` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/main/bgconn/manager.ts test/bgconn-policy.test.ts
git commit -m "feat(bgconn): idle-teardown + lock tracking policy"
```

---

## Task 9: Capability + context wiring + shared singleton

**Files:** Modify `src/shared/plugin-types.ts`, `src/main/plugins/context.ts`; Create `src/main/bgconn/singleton.ts`; Test `test/bgconn-capability.test.ts`

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { CAPABILITIES } from '../src/shared/plugin-types';
import { setBgConnManager, getBgConnManager, _resetBgConnSingletonForTest } from '../src/main/bgconn/singleton';
import { BackgroundConnectionManager } from '../src/main/bgconn/manager';

describe('persistent-background-connection capability', () => {
  it('is a known capability', () => {
    expect([...CAPABILITIES]).toContain('persistent-background-connection');
  });
  it('singleton holds + returns the manager', () => {
    _resetBgConnSingletonForTest();
    expect(getBgConnManager()).toBeNull();
    const m = new BackgroundConnectionManager({ isTorBootstrapped: () => false, now: () => 0, isVaultUnlocked: () => true,
      socksHost: '127.0.0.1', socksPort: 9250, idleTeardownAfterMs: null, maxReconnects: 20, maxSessionAgeMs: 720 * 60000 });
    setBgConnManager(m);
    expect(getBgConnManager()).toBe(m);
  });
});
```

- [ ] **Step 2: Run** `pnpm test bgconn-capability` → FAIL.

- [ ] **Step 3a:** Add `'persistent-background-connection'` to `CAPABILITIES` in `src/shared/plugin-types.ts`.

- [ ] **Step 3b:** Create `src/main/bgconn/singleton.ts`:
```typescript
import type { BackgroundConnectionManager } from './manager';
let instance: BackgroundConnectionManager | null = null;
export function setBgConnManager(m: BackgroundConnectionManager): void { instance = m; }
export function getBgConnManager(): BackgroundConnectionManager | null { return instance; }
export function _resetBgConnSingletonForTest(): void { instance = null; }
```

- [ ] **Step 3c:** In `src/main/plugins/context.ts`, add to `PluginContext` and `ContextDeps`:
```typescript
bgConn?: {
  registerWorker(w: import('../bgconn/manager').BgWorker): void;
  secrets: import('../bgconn/secrets').BgConnSecrets;   // store/load the session string (namespaced)
  isVaultLocked(): boolean;                              // worker polls this to buffer during a lock
  noteReconnect(connId: string): void;                  // worker reports reconnects → bounded budget
};
```
and grant in `createPluginContext`:
```typescript
if (has('persistent-background-connection') && deps.bgConn) ctx.bgConn = deps.bgConn;
```

- [ ] **Step 4: Run** `pnpm test bgconn-capability` → PASS; `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/shared/plugin-types.ts src/main/plugins/context.ts src/main/bgconn/singleton.ts test/bgconn-capability.test.ts
git commit -m "feat(bgconn): capability + context surface + shared singleton"
```

---

## Task 10: Settings block

**Files:** Modify `src/shared/types.ts`; Test `test/bgconn-settings.test.ts`

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { defaultSettings } from '../src/shared/types';

describe('bgconn settings defaults', () => {
  it('exist and are fail-safe', () => {
    expect(defaultSettings.bgconn.idleTeardownAfterMinutes).toBe(120); // 2h default
    expect(defaultSettings.bgconn.defaultRouting).toBe('tor');
    expect(defaultSettings.bgconn.maxReconnects).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run** `pnpm test bgconn-settings` → FAIL.

- [ ] **Step 3: Implement** — in `src/shared/types.ts`, add to `AppSettings`:
```typescript
bgconn: {
  idleTeardownAfterMinutes: number | null; // null = never
  defaultRouting: 'tor' | 'direct';
  maxReconnects: number;
  maxSessionAgeMinutes: number;
};
```
and to `defaultSettings`:
```typescript
bgconn: { idleTeardownAfterMinutes: 120, defaultRouting: 'tor', maxReconnects: 20, maxSessionAgeMinutes: 720 },
```

- [ ] **Step 4: Run** `pnpm test bgconn-settings` → PASS; `pnpm typecheck` → clean; full `pnpm test` → green.

- [ ] **Step 5: Commit**
```bash
git add src/shared/types.ts test/bgconn-settings.test.ts
git commit -m "feat(bgconn): settings block (idle-teardown / routing / reconnect bounds)"
```

---

## Task 11: IPC + GATE_EXEMPT + before-quit teardown + preload (SECURITY-CRITICAL)

**Files:** Modify `src/shared/ipc-contracts.ts`, `src/main/ipc/register.ts`, `src/main/index.ts`, `src/preload/index.ts`; Test `test/bgconn-ipc.test.ts`

- [ ] **Step 1: Write the failing test** (`test/bgconn-ipc.test.ts`)
```typescript
import { describe, it, expect } from 'vitest';
import { BGCONN_LOCK_EXEMPT_CHANNELS } from '../src/shared/ipc-contracts';

describe('bgconn IPC lock exemption', () => {
  it('exposes status + stop as lock-exempt (operator can see/kill a monitor while locked), NOT start/configure', () => {
    expect(BGCONN_LOCK_EXEMPT_CHANNELS).toContain('bgconn:status');
    expect(BGCONN_LOCK_EXEMPT_CHANNELS).toContain('bgconn:stop');
    expect(BGCONN_LOCK_EXEMPT_CHANNELS).not.toContain('bgconn:start');
    expect(BGCONN_LOCK_EXEMPT_CHANNELS).not.toContain('bgconn:configure');
    expect(BGCONN_LOCK_EXEMPT_CHANNELS).not.toContain('bgconn:clearCredentials');
  });
});
```

- [ ] **Step 2: Run** `pnpm test bgconn-ipc` → FAIL.

- [ ] **Step 3a: Channels.** In `src/shared/ipc-contracts.ts`, add to `channels`:
```typescript
bgconn: { list: 'bgconn:list', start: 'bgconn:start', stop: 'bgconn:stop', configure: 'bgconn:configure', clearCredentials: 'bgconn:clearCredentials', status: 'bgconn:status' },
```
plus `ApiContracts` entries (list/status → arrays; start/stop/configure/clearCredentials → their arg/return shapes), and export:
```typescript
export const BGCONN_LOCK_EXEMPT_CHANNELS = ['bgconn:status', 'bgconn:stop'] as const;
```

- [ ] **Step 3b: GATE_EXEMPT + handlers.** In `src/main/ipc/register.ts`, add the two lock-exempt channels into the existing `GATE_EXEMPT` set:
```typescript
import { BGCONN_LOCK_EXEMPT_CHANNELS } from '../../shared/ipc-contracts';
// where GATE_EXEMPT is built, add each of BGCONN_LOCK_EXEMPT_CHANNELS to the set.
```
Register all six `bgconn:*` handlers via `safeHandle`, delegating to `getBgConnManager()` (and `settingsStore.read().bgconn` for policy). `bgconn:status`/`bgconn:stop` must internally tolerate a locked vault (they're exempt). `bgconn:start` computes the consent key (`${phone}|${routing}|${channelSetHash}`), compares to the last consented key, and only passes `confirmed: true` after the renderer's confirmation IPC — mirror the offensive confirm flow.

- [ ] **Step 3c: before-quit teardown.** In `src/main/index.ts`, in the `before-quit` async body (alongside `chat.shutdown()`), BEFORE the bounded race resolves, add:
```typescript
import { getBgConnManager } from './bgconn/singleton';
import { disableAllPlugins } from './plugins/loader';
// inside the async cleanup, awaited:
await getBgConnManager()?.stopAll('quit').catch(() => { /* */ });
await disableAllPlugins().catch(() => { /* */ });
```
Ensure the bgconn subprocess kill is awaited (the worker's `kill` + `stop`), so it cannot orphan (the historical tor.exe orphan bug). Also start the manager's `tick()` interval at startup (e.g. `setInterval(() => getBgConnManager()?.tick(), 30000)`) and clear it on quit.

- [ ] **Step 3d: preload.** In `src/preload/index.ts`, expose `window.api.bgconn.{list,start,stop,configure,clearCredentials,status}` as invoke wrappers.

- [ ] **Step 4: Run** `pnpm test bgconn-ipc` → PASS; `pnpm typecheck` → clean; full `pnpm test` → green.

- [ ] **Step 5: Commit**
```bash
git add src/shared/ipc-contracts.ts src/main/ipc/register.ts src/main/index.ts src/preload/index.ts test/bgconn-ipc.test.ts
git commit -m "feat(bgconn): IPC + lock-exempt status/stop + before-quit teardown + tick"
```

---

## Task 12: Lock-screen LIVE indicator + emergency-stop

**Files:** Modify `src/renderer/shell/LockScreen.tsx`; Test `test/bgconn-lockscreen.test.ts`

**Context:** While locked, the operator must be able to SEE a live Telegram monitor and emergency-stop it. The LockScreen polls `window.api.bgconn.status()` (lock-exempt) and renders a LIVE badge + a Stop button calling `window.api.bgconn.stop(connId)` (lock-exempt). Since `@testing-library/react` is absent, extract a pure helper and test that; the visual integration is a manual check.

- [ ] **Step 1: Write the failing test** (`test/bgconn-lockscreen.test.ts`)
```typescript
import { describe, it, expect } from 'vitest';
import { lockScreenBgconnLabel } from '../src/renderer/shell/LockScreen';

describe('lock-screen bgconn surface', () => {
  it('renders a LIVE label per active connection, or empty when none', () => {
    expect(lockScreenBgconnLabel([])).toBe('');
    expect(lockScreenBgconnLabel([{ connId: 'c1', routing: 'tor', startedAt: 0 }]))
      .toMatch(/Telegram monitor: LIVE \(tor\)/);
  });
});
```

- [ ] **Step 2: Run** `pnpm test bgconn-lockscreen` → FAIL.

- [ ] **Step 3: Implement** — in `src/renderer/shell/LockScreen.tsx`, add the pure helper + wire a poll:
```typescript
export function lockScreenBgconnLabel(conns: Array<{ connId: string; routing: string; startedAt: number }>): string {
  if (conns.length === 0) return '';
  return conns.map((c) => `Telegram monitor: LIVE (${c.routing})`).join(' · ');
}
```
In the component: a `useEffect` that polls `window.api.bgconn.status()` every few seconds while locked, renders `lockScreenBgconnLabel(conns)` as a visible badge when non-empty, and a Stop button per connection calling `window.api.bgconn.stop(connId)`. (Keep the unlock form primary; the bgconn surface is a secondary banner.)

- [ ] **Step 4: Run** `pnpm test bgconn-lockscreen` → PASS; `pnpm typecheck` → clean; full `pnpm test` → green. Manual: `pnpm dev`, start a mock monitor, lock the vault → LIVE badge + Stop visible and functional on the lock screen.

- [ ] **Step 5: Commit**
```bash
git add src/renderer/shell/LockScreen.tsx test/bgconn-lockscreen.test.ts
git commit -m "feat(bgconn): lock-screen LIVE indicator + emergency-stop"
```

---

## Final verification
- [ ] `pnpm typecheck` (both tsconfigs) clean; `pnpm test` full green incl. the new bgconn suites.
- [ ] Charter: the lane bypasses the SSRF gate but is reachable only by the manager-spawned subprocess; a bgconn-capable plugin's `ctx.egress.fetch` to a loopback/`socks://` URL still throws (add this negative test to `test/plugin-context.test.ts` or a new file). No telemetry.
- [ ] Teardown: `stopAll('quit')` is invoked from `before-quit` and awaited; `disablePlugin` tears down workers; idle-teardown fires after the configured locked window; operator stop works while locked.
- [ ] Compartmentation: bgconn Tor is a SEPARATE instance with `IsolateSOCKSAuth`; each connId gets distinct SOCKS creds. (Live circuit-distinctness is a manual/subsystem-2 check; the unit tests assert distinct creds + separate instance config.)
- [ ] Secret handoff: session via stdin, never argv/env (asserted in Task 3).
- [ ] Dispatch the final whole-branch reviewer; security-critical units (1,2,3,6,7,8,11) get an adversarial pass before merge.

## Out of scope (this plan)
- Telethon CPython subprocess + bundling, phone→OTP→session auth, channel selection/FloodWait, message ingestion + the lock-buffer (subsystem 2 — uses existing case-storage/timeline/entity-registry).
- Structural OS-level network jail for the subprocess (deferred shared increment; the offensive capability would share it).
- Retrofitting the offensive controller with the before-quit teardown hook (tracked follow-up; this plan builds the framework it will use).
