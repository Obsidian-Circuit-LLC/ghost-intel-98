import { describe, it, expect, vi } from 'vitest';
import { resolveHost } from '../src/main/services/hostinfo/resolve';

const TS = '2026-02-02T00:00:00Z';
const now = () => TS;
function fetchRouter(map: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    for (const k of Object.keys(map)) if (url.includes(k)) return map[k];
    throw new Error('unexpected url: ' + url);
  });
}

describe('resolveHost', () => {
  it('IP literal: skips DNS-A, does PTR + RDAP, full profile', async () => {
    const fetchJson = fetchRouter({
      'PTR': { Answer: [{ type: 12, data: 'host149.telecom.com.ar.' }] },
      'rdap.org/ip/190.210.250.149': { handle: '190.210.0.0 - 190.210.255.255', country: 'AR', entities: [{ vcardArray: ['vcard', [['fn', {}, 'text', 'Telecom']]] }] }
    });
    const info = await resolveHost('http://190.210.250.149:91/v', { fetchJson, now });
    expect(info.host).toBe('190.210.250.149');
    expect(info.isIpLiteral).toBe(true);
    expect(info.ips).toEqual(['190.210.250.149']);
    expect(info.ptr).toBe('host149.telecom.com.ar');
    expect(info.rdap?.org).toBe('Telecom');
    expect(info.resolvedAt).toBe(TS);
    expect(info.errors).toEqual([]);
    // IP literal → no DNS-A query issued
    expect(fetchJson.mock.calls.find((c) => String(c[0]).includes('type=A'))).toBeUndefined();
  });
  it('hostname: does DNS-A then PTR+RDAP on the first IP', async () => {
    const fetchJson = fetchRouter({
      'type=A': { Answer: [{ type: 1, data: '5.6.7.8' }] },
      'PTR': { Answer: [{ type: 12, data: 'h.example.' }] },
      'rdap.org/ip/5.6.7.8': { country: 'US' }
    });
    const info = await resolveHost('https://cam.example.com/s', { fetchJson, now });
    expect(info.ips).toEqual(['5.6.7.8']);
    expect(info.ptr).toBe('h.example');
    expect(info.rdap?.country).toBe('US');
  });
  it('records per-lookup failures and still returns a partial (never throws)', async () => {
    const fetchJson = vi.fn(async (url: string) => { if (url.includes('rdap')) throw new Error('tor blocked'); return { Answer: [{ type: 12, data: 'h.' }] }; });
    const info = await resolveHost('http://1.2.3.4/v', { fetchJson, now });
    expect(info.ptr).toBe('h');
    expect(info.rdap).toBeUndefined();
    expect(info.errors).toContain('rdap-failed');
  });
  it('bad url → errors:[bad-url], no lookups', async () => {
    const fetchJson = vi.fn();
    const info = await resolveHost('not a url', { fetchJson, now });
    expect(info.errors).toEqual(['bad-url']);
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
