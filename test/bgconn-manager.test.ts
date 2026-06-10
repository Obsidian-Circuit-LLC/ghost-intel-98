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
