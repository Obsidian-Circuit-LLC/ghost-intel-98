import { describe, it, expect, vi, beforeEach } from 'vitest';

// Control the plugin-Tor readiness + start timing. A "slow start" is modelled as a promise that
// never resolves: if torFetchJson ever AWAITED it, the test would hang and time out. It doesn't —
// so a fast rejection proves the fire-and-forget warm path.
let bootstrapped = false;
const startNeverResolves = vi.fn(() => new Promise<void>(() => { /* pending forever */ }));
const torFetch = vi.fn(async () => ({ status: 200, body: JSON.stringify({ Answer: [{ type: 1, data: '5.6.7.8' }] }), finalUrl: 'x', blocked: false }));
const getPluginTor = vi.fn(() => ({ isBootstrapped: () => bootstrapped }));

vi.mock('../src/main/plugins/tor-egress', () => ({
  ensurePluginTor: () => startNeverResolves(),
  torFetch: (...a: unknown[]) => torFetch(...(a as [])),
  getPluginTor: () => getPluginTor()
}));

import { torFetchJson } from '../src/main/services/hostinfo/index';
import { resolveHost, TorNotReadyError } from '../src/main/services/hostinfo/resolve';

const now = () => '2026-02-02T00:00:00Z';

beforeEach(() => {
  bootstrapped = false;
  startNeverResolves.mockClear();
  torFetch.mockClear();
  getPluginTor.mockClear();
});

describe('hostinfo Tor bootstrap fast-fail', () => {
  it('not bootstrapped: torFetchJson rejects TorNotReadyError fast and does NOT await start()', async () => {
    await expect(torFetchJson('https://cloudflare-dns.com/dns-query?name=x&type=A')).rejects.toBeInstanceOf(TorNotReadyError);
    // Tor was kicked off in the background (fire-and-forget) so it warms for next time…
    expect(startNeverResolves).toHaveBeenCalledOnce();
    // …but the lookup never touched the SOCKS fetch.
    expect(torFetch).not.toHaveBeenCalled();
  });

  it('not bootstrapped: resolveHost returns a partial with tor-not-ready markers, does not hang', async () => {
    const info = await resolveHost('http://1.2.3.4/v', { fetchJson: torFetchJson, now });
    expect(info.host).toBe('1.2.3.4');
    expect(info.errors).toContain('tor-not-ready');
    // never blocked on a slow start()
    expect(torFetch).not.toHaveBeenCalled();
  });

  it('bootstrapped: torFetchJson proceeds through torFetch as before', async () => {
    bootstrapped = true;
    const out = await torFetchJson('https://cloudflare-dns.com/dns-query?name=x&type=A') as { Answer: unknown[] };
    expect(out.Answer).toHaveLength(1);
    expect(torFetch).toHaveBeenCalledOnce();
    // no background start needed when already bootstrapped
    expect(startNeverResolves).not.toHaveBeenCalled();
  });
});
