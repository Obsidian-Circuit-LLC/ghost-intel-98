import { describe, it, expect, vi, beforeEach } from 'vitest';
const net = { on: false };
let lastUrl = '';
vi.mock('../src/main/storage/json-fs', () => ({ settingsStore: { read: async () => ({ geoint: { networkEnabled: net.on } }) } }));
vi.mock('../src/main/net/safe-fetch', () => ({ safeFetch: vi.fn(async (u: string) => { lastUrl = u; return { ok: true, status: 200 } as any; }) }));
vi.mock('../src/main/net/limits', () => ({ readTextCapped: vi.fn(async () => JSON.stringify({ ac: [{ hex: 'h', lat: 52, lon: 0, alt_baro: 1000 }] })) }));
import { fetchAdsb } from '../src/main/services/livefeeds/adsb';

beforeEach(() => { net.on = false; lastUrl = ''; });

describe('fetchAdsb', () => {
  it('returns [] when the GeoINT network gate is OFF (no fetch)', async () => {
    expect(await fetchAdsb({ west: -1, south: 51, east: 1, north: 53 })).toEqual([]);
  });
  it('fetches api.adsb.lol with a radius URL and parses when gate is ON', async () => {
    net.on = true;
    const out = await fetchAdsb({ west: -1, south: 51, east: 1, north: 53 });
    expect(lastUrl).toContain('https://api.adsb.lol/v2/lat/52/lon/0/dist/');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('h');
  });
});
