// @vitest-environment node
/**
 * Spectre client contracts — ported from WireTapper's app.py, asserted against the exact requests
 * his code builds. Porting an upstream's params from memory is the recorded failure mode; these
 * pin them to his source.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  classifyDevice,
  buildWigleNetworkUrl,
  buildNominatimUrl,
  WIGLE_HOST,
  NOMINATIM_HOST,
  assertAllowedHost,
  resolveSpectreEgress,
  geocode,
  queryWifi,
  SpectreEgressBlockedError,
  type SpectreClientDeps,
} from '../src/main/spectre/client';

describe('classifyDevice (ported verbatim from classify_device)', () => {
  it('maps a name to his category, or falls through to the original type', () => {
    expect(classifyDevice('HIKVISION-CAM-02', 'router')).toBe('camera');
    expect(classifyDevice('Tesla Model 3', 'router')).toBe('car');
    expect(classifyDevice('Bose QC35', 'bluetooth')).toBe('headphone');
    expect(classifyDevice('RTL-SDR blog v3', 'router')).toBe('sdr');
    expect(classifyDevice('BRAVIA-4K', 'router')).toBe('tv');
    expect(classifyDevice('linksys-home', 'router')).toBe('router'); // no keyword → original
    expect(classifyDevice('', 'router')).toBe('router'); // empty name → original
  });
});

describe('URL builders match his app.py exactly', () => {
  it('WiGLE network search: the ±0.01 bounding box, on the wigle host', () => {
    const u = new URL(buildWigleNetworkUrl(51.5, -0.1));
    expect(u.hostname).toBe(WIGLE_HOST);
    expect(u.pathname).toBe('/api/v2/network/search');
    expect(u.searchParams.get('latrange1')).toBe('51.49');
    expect(u.searchParams.get('latrange2')).toBe('51.51');
    expect(u.searchParams.get('longrange1')).toBe('-0.11');
    expect(u.searchParams.get('longrange2')).toBe('-0.09');
  });
  it('Nominatim geocode: q/format/limit on the nominatim host', () => {
    const u = new URL(buildNominatimUrl('Big Ben, London'));
    expect(u.hostname).toBe(NOMINATIM_HOST);
    expect(u.pathname).toBe('/search');
    expect(u.searchParams.get('q')).toBe('Big Ben, London');
    expect(u.searchParams.get('format')).toBe('json');
    expect(u.searchParams.get('limit')).toBe('1');
  });
});

describe('host allowlist (SSRF floor)', () => {
  it('rejects a foreign host, a non-HTTPS scheme, and a look-alike', () => {
    expect(() => assertAllowedHost('https://evil.example/x')).toThrow();
    expect(() => assertAllowedHost('http://api.wigle.net/x')).toThrow(/HTTPS/i);
    expect(() => assertAllowedHost('https://api.wigle.net.evil.example/x')).toThrow();
    expect(assertAllowedHost('https://api.wigle.net/api/v2/network/search').hostname).toBe(WIGLE_HOST);
  });
});

describe('egress gate — Tor-default, fail closed', () => {
  it('Tor mode requires a bootstrapped Tor; blocks with no clearnet fallback', () => {
    expect(resolveSpectreEgress({ clearnet: false, clearnetAck: false }, { torReady: false }))
      .toMatchObject({ blocked: true });
    expect(resolveSpectreEgress({ clearnet: false, clearnetAck: false }, { torReady: true }))
      .toMatchObject({ mode: 'tor' });
  });
  it('clearnet is taken ONLY when clearnet AND clearnetAck', () => {
    expect(resolveSpectreEgress({ clearnet: true, clearnetAck: false }, { torReady: false }))
      .toMatchObject({ blocked: true }); // un-acked flag can never leave Tor
    expect(resolveSpectreEgress({ clearnet: true, clearnetAck: true }, { torReady: false }))
      .toMatchObject({ mode: 'clearnet' });
  });
});

/** A transport that records the request it was asked to make and returns canned JSON. */
function fakeDeps(json: unknown, rec: { url?: string; auth?: string } = {}): SpectreClientDeps {
  return {
    egress: { mode: 'tor', socksPort: 9050 },
    transport: async (url: string, opts?: { auth?: { user: string; pass: string } }) => {
      rec.url = url;
      if (opts?.auth) rec.auth = `${opts.auth.user}:${opts.auth.pass}`;
      return { status: 200, body: JSON.stringify(json) };
    },
  };
}

describe('queryWifi (ported from the /nearby wifi branch)', () => {
  it('sends WiGLE basic auth and normalizes results to the device shape', async () => {
    const rec: { url?: string; auth?: string } = {};
    const deps = fakeDeps({ results: [
      { trilat: 51.5, trilong: -0.1, ssid: 'HIKVISION-CAM', netid: 'AA:BB', vendor: 'Hik', level: -60, lastupdt: 't' },
    ] }, rec);
    const out = await queryWifi(51.5, -0.1, { wigleName: 'me', wigleToken: 'tok' }, deps);

    expect(rec.auth, 'WiGLE is HTTP Basic (name:token)').toBe('me:tok');
    expect(out.devices).toHaveLength(1);
    expect(out.devices[0]).toMatchObject({
      lat: 51.5, lon: -0.1, ssid: 'HIKVISION-CAM', bssid: 'AA:BB', vendor: 'Hik', signal: -60,
      type: 'camera', source: 'wigle',
    });
  });

  it('reports a missing WiGLE key rather than making an unauthenticated call', async () => {
    const rec: { url?: string } = {};
    const out = await queryWifi(51.5, -0.1, { wigleName: '', wigleToken: '' }, fakeDeps({}, rec));
    expect(rec.url, 'no request without a key').toBeUndefined();
    expect(out.notes.find((n) => n.source === 'wigle')).toMatchObject({ ok: false });
  });
});

describe('geocode (Nominatim, keyless)', () => {
  it('returns the first hit as a centre', async () => {
    const out = await geocode('London', fakeDeps([{ lat: '51.5', lon: '-0.12', display_name: 'London, UK' }]));
    expect(out).toMatchObject({ lat: 51.5, lon: -0.12, label: 'London, UK' });
  });
  it('returns null when nothing is found, never a guess', async () => {
    expect(await geocode('zzzznowhere', fakeDeps([]))).toBeNull();
  });
});

describe('a blocked egress throws rather than dialling', () => {
  it('geocode/queryWifi refuse when the gate is blocked', async () => {
    const blocked: SpectreClientDeps = { egress: { blocked: true, reason: 'Tor is not ready.' } as never, transport: async () => { throw new Error('should not dial'); } };
    await expect(geocode('London', blocked)).rejects.toThrow(SpectreEgressBlockedError);
  });
});
