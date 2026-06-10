import { describe, it, expect, afterAll, vi } from 'vitest';
import { rm } from 'node:fs/promises';

// Mirror entities.test.ts: redirect the data root to a tmp dir and use the real secure-fs
// (which writes plaintext when no vault key is configured), so upsert/list do real round-trips.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-streams-geo-test' } }));

import * as streams from '../src/main/services/streams';

afterAll(async () => { await rm('/tmp/ga98-streams-geo-test', { recursive: true, force: true }); });

describe('streams.upsert — optional geo persistence', () => {
  it('persists and returns optional geo fields across a write/read round-trip', async () => {
    const s = await streams.upsert({
      label: 'Westminster Bridge', url: 'https://cam/wb.m3u8', kind: 'hls',
      country: 'GB', region: 'England', city: 'London', lat: 51.5008, lon: -0.1216, source: 'corpus-v1'
    });
    expect(s.country).toBe('GB');
    expect(s.city).toBe('London');
    expect(s.lat).toBe(51.5008);
    expect(s.lon).toBe(-0.1216);
    expect(s.source).toBe('corpus-v1');

    const reread = (await streams.list()).find((x) => x.id === s.id);
    expect(reread?.country).toBe('GB');
    expect(reread?.lat).toBe(51.5008);
    expect(reread?.source).toBe('corpus-v1');
  });

  it('writes no geo keys at all when none are provided', async () => {
    const s = await streams.upsert({ label: 'Plain', url: 'https://cam/plain.m3u8', kind: 'hls' });
    const reread = (await streams.list()).find((x) => x.id === s.id);
    expect(reread).toBeDefined();
    expect('country' in reread!).toBe(false);
    expect('lat' in reread!).toBe(false);
    expect('source' in reread!).toBe(false);
  });

  it('drops a non-finite lat/lon instead of persisting NaN', async () => {
    const s = await streams.upsert({
      label: 'BadCoords', url: 'https://cam/bad.m3u8', kind: 'hls',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lat: NaN as any, lon: Infinity as any, city: 'Oslo'
    });
    const reread = (await streams.list()).find((x) => x.id === s.id);
    expect('lat' in reread!).toBe(false);
    expect('lon' in reread!).toBe(false);
    expect(reread?.city).toBe('Oslo');
  });
});
