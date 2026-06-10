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
    const w = mkWorker('c1'); m.register(w); // worker has routing 'tor', channelSetHash 'h'
    await m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: true });
    await m.stop('c1');
    await expect(m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: false })).rejects.toThrow(/not confirmed/i);
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
  it('rejects a double-start (no orphan / no age-clock reset)', async () => {
    t = Date.parse('2026-06-10T00:00:00Z'); unlocked = true;
    const m = new BackgroundConnectionManager(deps());
    const w = mkWorker('c1'); m.register(w);
    await m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: true });
    await expect(m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: true })).rejects.toThrow(/already started/i);
  });
  it('rejects start params that do not match the registered worker', async () => {
    t = Date.parse('2026-06-10T00:00:00Z'); unlocked = true;
    const m = new BackgroundConnectionManager(deps());
    const w = mkWorker('c1'); m.register(w); // worker routing 'tor', channelSetHash 'h'
    await expect(m.start('c1', { phone: '+1', routing: 'direct', channelSetHash: 'h' }, { confirmed: true })).rejects.toThrow(/do not match/i);
    await expect(m.start('c1', { phone: '+1', routing: 'tor', channelSetHash: 'OTHER' }, { confirmed: true })).rejects.toThrow(/do not match/i);
  });
  it('stopAll completes promptly even if a worker.stop hangs (bounded teardown)', async () => {
    t = Date.parse('2026-06-10T00:00:00Z'); unlocked = true;
    const hung: any = { connId: 'h1', routing: 'tor', channelSetHash: 'h',
      start: async () => ({ pid: 1, kill: () => {} }), stop: () => new Promise(() => { /* never resolves */ }) };
    const m = new BackgroundConnectionManager({ ...deps(), workerStopTimeoutMs: 20 });
    m.register(hung);
    await m.start('h1', { phone: '+1', routing: 'tor', channelSetHash: 'h' }, { confirmed: true });
    await m.stopAll('quit'); // must resolve within the 20ms bound, not hang
    expect(m.list().length).toBe(0);
  });
});
