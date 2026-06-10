import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { BackgroundConnectionManager, type BgWorker, type ManagerDeps } from '../src/main/bgconn/manager';
import { BgconnTor } from '../src/main/bgconn/tor';

// A deferred whose resolve we control, so we can hold an async window open across assertions.
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function baseDeps(now: () => number, overrides: Partial<ManagerDeps> = {}): ManagerDeps {
  return {
    isTorBootstrapped: () => true,
    now,
    isVaultUnlocked: () => true,
    socksHost: '127.0.0.1',
    socksPort: 9250,
    idleTeardownAfterMs: 7_200_000,
    maxReconnects: 20,
    maxSessionAgeMs: 720 * 60_000,
    ...overrides
  };
}

describe('FIX 1: max-session-age clock reset via start() racing an in-flight stop (TOCTOU)', () => {
  it('rejects a start() arriving while a tick-triggered stop is still tearing down, then allows a fresh start with a fresh clock', async () => {
    let t = Date.parse('2026-06-10T00:00:00Z');
    const stopGate = deferred();
    const w: BgWorker & { startCount: number } = {
      connId: 'c1', routing: 'tor', channelSetHash: 'h', startCount: 0,
      start: vi.fn(async function (this: { startCount: number }) { (w as any).startCount++; return { pid: 1, kill: vi.fn() }; }),
      // stop() returns a promise we keep pending across the assertion window.
      stop: vi.fn(() => stopGate.promise)
    } as any;
    const m = new BackgroundConnectionManager(baseDeps(() => t));
    m.register(w);
    await m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: true });
    const firstStart = m.list()[0].startedAt;

    // Advance past max-session-age and tick() — this schedules the async stop (which now blocks on stopGate).
    t += 720 * 60_000 + 1;
    m.tick();
    await Promise.resolve(); // let stop() begin (live.delete + stopping.add run synchronously)

    // While the stop is mid-teardown, a start() must REJECT (not silently re-acquire and reset the clock).
    await expect(
      m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: true })
    ).rejects.toThrow(/stopping/i);

    // Resolve the controlled stop → teardown completes, stopping cleared.
    stopGate.resolve();
    await new Promise((r) => setTimeout(r, 0)); // flush the stop()'s Promise.race + finally (stopping.delete)

    // A fresh, operator-authorized start now succeeds and reflects the NEW start time (fresh clock).
    t += 1000;
    await m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: true });
    expect(m.list().length).toBe(1);
    expect(m.list()[0].startedAt).toBe(firstStart + 720 * 60_000 + 1 + 1000);
    expect(m.list()[0].startedAt).not.toBe(firstStart);
  });
});

function fakeProc(): any {
  const p: any = new EventEmitter();
  p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
  p.kill = vi.fn((_sig?: string) => { p.killed = true; p.emit('exit', 0, null); });
  p.killed = false;
  return p;
}

describe('FIX 2: BgconnTor.killNow() synchronous SIGKILL backstop', () => {
  it('SIGKILLs the running child, clears bootstrapped, and is a no-op on a second call', async () => {
    const proc = fakeProc();
    const spawn = vi.fn(() => proc) as never;
    const tor = new BgconnTor({ torExe: '/tor', dataDir: '/d', socksPort: 9250, controlPort: 9251, spawn,
      writeFile: async () => {}, mkdir: async () => {} });
    const started = tor.start();
    setImmediate(() => proc.stdout.emit('data', Buffer.from('... Bootstrapped 100% (done): Done\n')));
    await started;
    expect(tor.isBootstrapped()).toBe(true);

    tor.killNow();
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    expect(tor.isBootstrapped()).toBe(false);

    const callsBefore = proc.kill.mock.calls.length;
    tor.killNow(); // proc nulled → no-op
    expect(proc.kill.mock.calls.length).toBe(callsBefore);
  });
});

describe('FIX 4: failed worker.start reaps tor only when no live session remains', () => {
  function mkOkWorker(connId: string): BgWorker {
    return { connId, routing: 'tor', channelSetHash: 'h',
      start: vi.fn(async () => ({ pid: 1, kill: vi.fn() })), stop: vi.fn(async () => {}) };
  }
  function mkFailWorker(connId: string): BgWorker {
    return { connId, routing: 'tor', channelSetHash: 'h',
      start: vi.fn(async () => { throw new Error('worker boot failed'); }), stop: vi.fn(async () => {}) };
  }

  it('reaps tor (teardownTor called once) when a failed start leaves zero live sessions', async () => {
    const t = Date.parse('2026-06-10T00:00:00Z');
    const teardownTor = vi.fn(async () => {});
    const ensureTorBootstrapped = vi.fn(async () => {});
    const m = new BackgroundConnectionManager(baseDeps(() => t, { ensureTorBootstrapped, teardownTor }));
    const w = mkFailWorker('c1'); m.register(w);
    await expect(m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: true }))
      .rejects.toThrow(/worker boot failed/);
    expect(m.list()).toEqual([]);
    expect(teardownTor).toHaveBeenCalledTimes(1);
  });

  it('does NOT reap tor on a failed start while another tor session is still live', async () => {
    const t = Date.parse('2026-06-10T00:00:00Z');
    const teardownTor = vi.fn(async () => {});
    const ensureTorBootstrapped = vi.fn(async () => {});
    const m = new BackgroundConnectionManager(baseDeps(() => t, { ensureTorBootstrapped, teardownTor }));
    const ok = mkOkWorker('a'); const bad = mkFailWorker('b');
    m.register(ok); m.register(bad);
    await m.start('a', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: true });
    await expect(m.start('b', { phone: '+2', routing: 'tor', channelSetHash: 'h' }, { confirmed: true }))
      .rejects.toThrow(/worker boot failed/);
    expect(m.list().map((c) => c.connId)).toEqual(['a']);
    expect(teardownTor).not.toHaveBeenCalled();
  });
});
