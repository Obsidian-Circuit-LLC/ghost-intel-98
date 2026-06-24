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

  it('forwards the tor socks port accessor to probe', async () => {
    const calls: unknown[] = [];
    const probeImpl = vi.fn(async (_url: string, _opts: unknown, deps?: { socksPort?: () => number | null }) => {
      calls.push(deps?.socksPort?.());
      return { statusCode: 200, statusMessage: 'OK', elapsed: 1, redirectUrl: null, error: null, body: '' };
    });
    await runSweep({ jobId: 'j', username: 'u', sites: [mk('a')], useTor: true, concurrency: 1, networkEnabled: true, emit: () => {}, onDone: () => {}, isCancelled: () => false, torSocksPort: () => 9050, probeImpl: probeImpl as never });
    expect(calls).toEqual([9050]);
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
