import { describe, it, expect, vi } from 'vitest';
import { makeTorConnector, type TorLike } from '../src/main/searchlight/tor-connect';

function fakeTor(over: Partial<TorLike> = {}): TorLike {
  return { isBootstrapped: () => false, start: async () => {}, ...over };
}

describe('searchlight tor-connect', () => {
  it('reports off when tor is null', () => {
    const c = makeTorConnector(() => null);
    expect(c.status()).toBe('off');
  });
  it('reports ready when bootstrapped', () => {
    const c = makeTorConnector(() => fakeTor({ isBootstrapped: () => true }));
    expect(c.status()).toBe('ready');
  });
  it('connect returns off+error when tor unavailable', async () => {
    const c = makeTorConnector(() => null);
    expect(await c.connect()).toEqual({ state: 'off', error: 'Tor is unavailable' });
  });
  it('connect starts tor once and resolves ready', async () => {
    let bs = false;
    const start = vi.fn(async () => { bs = true; });
    const tor = fakeTor({ start, get isBootstrapped() { return () => bs; } } as Partial<TorLike>);
    const c = makeTorConnector(() => tor);
    const r = await c.connect();
    expect(r.state).toBe('ready');
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('concurrent connects share one start (no double-spawn)', async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((r) => { resolve = r; });
    let bs = false;
    const start = vi.fn(async () => { await gate; bs = true; });
    const tor: TorLike = { isBootstrapped: () => bs, start };
    const c = makeTorConnector(() => tor);
    const p1 = c.connect(); const p2 = c.connect();
    expect(c.status()).toBe('connecting');
    resolve();
    await Promise.all([p1, p2]);
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('connect returns off+error when start throws', async () => {
    const tor: TorLike = { isBootstrapped: () => false, start: async () => { throw new Error('boom'); } };
    const c = makeTorConnector(() => tor);
    expect(await c.connect()).toEqual({ state: 'off', error: 'boom' });
  });
});
