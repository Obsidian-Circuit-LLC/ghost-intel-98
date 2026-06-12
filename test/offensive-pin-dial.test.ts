import { describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:net';
import { resolveAll, dohResolve, dialPinned } from '../src/main/offensive/pin-dial';

// A dns-json Answer set: two A records and one AAAA record.
function dnsJson(name: string, records: { type: number; data: string }[]): string {
  return JSON.stringify({ Status: 0, Answer: records.map((r) => ({ name, type: r.type, TTL: 60, data: r.data })) });
}

describe('pin-dial DoH', () => {
  it('dohResolve parses an A+AAAA Answer[] (mocked httpsGet) into a merged IP list', async () => {
    const httpsGet = vi.fn(async (url: string) => {
      if (url.includes('type=AAAA')) {
        return { status: 200, body: dnsJson('host', [{ type: 28, data: '2001:db8::1' }]) };
      }
      // A query
      return { status: 200, body: dnsJson('host', [{ type: 1, data: '10.0.0.1' }, { type: 1, data: '10.0.0.2' }]) };
    });
    const ips = await dohResolve('host', { httpsGet });
    expect(ips).toEqual(['10.0.0.1', '10.0.0.2', '2001:db8::1']);
    // Cert validation is node:https default — confirm we sent the dns-json Accept header.
    expect(httpsGet).toHaveBeenCalledWith(expect.any(String), { Accept: 'application/dns-json' });
  });

  it('dohResolve ignores non-A/AAAA Answer entries (e.g. CNAME type 5)', async () => {
    const httpsGet = vi.fn(async (url: string) => {
      if (url.includes('type=AAAA')) {
        return { status: 200, body: dnsJson('host', []) };
      }
      return { status: 200, body: dnsJson('host', [{ type: 5, data: 'alias.example.' }, { type: 1, data: '10.0.0.9' }]) };
    });
    expect(await dohResolve('host', { httpsGet })).toEqual(['10.0.0.9']);
  });

  it('resolveAll (DoH default) returns the DoH IPs', async () => {
    const httpsGet = vi.fn(async (url: string) =>
      url.includes('type=AAAA')
        ? { status: 200, body: dnsJson('host', [{ type: 28, data: '2606:2800:220:1::1' }]) }
        : { status: 200, body: dnsJson('host', [{ type: 1, data: '93.184.216.34' }]) }
    );
    expect(await resolveAll('host', { httpsGet })).toEqual(['93.184.216.34', '2606:2800:220:1::1']);
  });

  it('resolveAll REJECTS when DoH httpsGet throws — no system-resolver fallback', async () => {
    const httpsGet = vi.fn(async () => { throw new Error('network down'); });
    const systemLookup = vi.fn(async () => [{ address: '6.6.6.6', family: 4 }]);
    await expect(resolveAll('host', { httpsGet, lookup: systemLookup as never })).rejects.toThrow();
    expect(systemLookup).not.toHaveBeenCalled();
  });

  it('resolveAll REJECTS on non-200 DoH status — no system-resolver fallback', async () => {
    const httpsGet = vi.fn(async () => ({ status: 502, body: 'bad gateway' }));
    const systemLookup = vi.fn(async () => [{ address: '6.6.6.6', family: 4 }]);
    await expect(resolveAll('host', { httpsGet, lookup: systemLookup as never })).rejects.toThrow();
    expect(systemLookup).not.toHaveBeenCalled();
  });

  it('resolveAll REJECTS on empty DoH Answer — no system-resolver fallback', async () => {
    const httpsGet = vi.fn(async () => ({ status: 200, body: dnsJson('host', []) }));
    const systemLookup = vi.fn(async () => [{ address: '6.6.6.6', family: 4 }]);
    await expect(resolveAll('host', { httpsGet, lookup: systemLookup as never })).rejects.toThrow();
    expect(systemLookup).not.toHaveBeenCalled();
  });

  it('resolveAll(host, { useSystemResolver: true }) uses the injected system lookup (back-compat)', async () => {
    const systemLookup = vi.fn(async () => [{ address: '10.0.0.1', family: 4 }, { address: '2001:db8::1', family: 6 }]);
    const httpsGet = vi.fn(async () => { throw new Error('DoH must not be called'); });
    const ips = await resolveAll('host', { useSystemResolver: true, lookup: systemLookup as never, httpsGet });
    expect(ips).toEqual(['10.0.0.1', '2001:db8::1']);
    expect(httpsGet).not.toHaveBeenCalled();
  });

  // --- NEW-1: canonicalize resolved IPs (drop non-IP-literal encodings that getaddrinfo would
  // still accept — decimal/hex/octal forms of e.g. 169.254.169.254 — closing an encoding-SSRF). ---

  it('resolveAll DROPS non-canonical IP encodings from the DoH answer, keeping only IP literals', async () => {
    // A-record answer mixes a valid dotted-quad with decimal and hex encodings of an internal addr.
    const httpsGet = vi.fn(async (url: string) =>
      url.includes('type=AAAA')
        ? { status: 200, body: dnsJson('host', []) }
        : { status: 200, body: dnsJson('host', [
            { type: 1, data: '2852039166' },        // decimal for 169.254.169.254
            { type: 1, data: '0xa9.0xfe.0xa9.0xfe' },// hex octets for 169.254.169.254
            { type: 1, data: '203.0.113.5' }         // the only canonical literal
          ]) }
    );
    expect(await resolveAll('host', { httpsGet })).toEqual(['203.0.113.5']);
  });

  it('resolveAll REJECTS when the DoH answer contains ONLY non-canonical encodings (empty after filter)', async () => {
    const httpsGet = vi.fn(async (url: string) =>
      url.includes('type=AAAA')
        ? { status: 200, body: dnsJson('host', []) }
        : { status: 200, body: dnsJson('host', [
            { type: 1, data: '2852039166' },
            { type: 1, data: '0251.0376.0251.0376' } // octal for 169.254.169.254
          ]) }
    );
    await expect(resolveAll('host', { httpsGet })).rejects.toThrow();
  });

  it('resolveAll filters non-canonical entries from the SYSTEM-resolver path too', async () => {
    const systemLookup = vi.fn(async () => [
      { address: '2852039166', family: 4 }, // non-literal — must be dropped
      { address: '198.51.100.7', family: 4 }
    ]);
    const ips = await resolveAll('host', { useSystemResolver: true, lookup: systemLookup as never });
    expect(ips).toEqual(['198.51.100.7']);
  });

  it('resolveAll REJECTS when the SYSTEM-resolver path yields only non-literal addresses', async () => {
    const systemLookup = vi.fn(async () => [{ address: '0xa9.0xfe.0xa9.0xfe', family: 4 }]);
    await expect(resolveAll('host', { useSystemResolver: true, lookup: systemLookup as never })).rejects.toThrow();
  });
});

describe('pin-dial', () => {
  it('dialPinned connects to the exact IP/port', async () => {
    const srv = createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    const connected = new Promise<void>((r) => srv.once('connection', () => r()));
    const sock = await dialPinned('127.0.0.1', port);
    await connected;
    sock.destroy(); srv.close();
    expect(true).toBe(true);
  });
});
