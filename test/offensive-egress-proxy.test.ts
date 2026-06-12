import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createServer } from 'node:http';
import { AuthorizedEgressProxy } from '../src/main/offensive/egress-proxy';
import { parseScopeManifest } from '../src/main/offensive/scope-manifest';
import { EngagementAudit, verifyAuditLog } from '../src/main/offensive/engagement-audit';

const NOW = Date.parse('2026-06-10T00:00:00Z');

async function upstream(): Promise<{ port: number; close: () => void }> {
  const s = createServer((_req, res) => { res.end('upstream-ok'); });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return { port: (s.address() as { port: number }).port, close: () => s.close() };
}
function viaProxy(proxyPort: number, targetHost: string, targetPort: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: proxyPort, method: 'GET',
      path: `http://${targetHost}:${targetPort}/`, headers: { Host: `${targetHost}:${targetPort}` } });
    req.once('response', (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b })); });
    req.once('error', reject); req.end();
  });
}

describe('AuthorizedEgressProxy', () => {
  it('forwards an in-scope (loopback) request and audits it; denies out-of-scope', async () => {
    const up = await upstream();
    const dir = mkdtempSync(join(tmpdir(), 'dcs98-proxy-'));
    const audit = new EngagementAudit(join(dir, 'a.log'));
    const manifest = parseScopeManifest({ manifestId: 'e', mode: 'lab', expiresAt: '2999-01-01T00:00:00Z',
      include: [{ kind: 'cidr', value: '127.0.0.1/32' }] }, NOW);
    const resolver = vi.fn(async (h: string) => (h === 'in.scope' ? ['127.0.0.1'] : ['8.8.8.8']));
    const proxy = new AuthorizedEgressProxy({ manifest, audit, resolveAll: resolver, now: () => NOW, rateLimitPerSec: 1000 });
    const { port } = await proxy.start();

    const ok = await viaProxy(port, 'in.scope', up.port);
    expect(ok.status).toBe(200);
    expect(ok.body).toBe('upstream-ok');

    const denied = await viaProxy(port, 'out.scope', up.port);
    expect(denied.status).toBe(403);

    await proxy.stop(); up.close();
    const v = verifyAuditLog(join(dir, 'a.log'));
    expect(v.ok).toBe(true);
    expect(v.events.map((e) => e.decision)).toContain('allowed');
    expect(v.events.map((e) => e.decision)).toContain('denied');
    expect(v.events.find((e) => e.decision === 'allowed')?.dialedIp).toBe('127.0.0.1');
  });

  it('relays a CHUNKED upstream response intact', async () => {
    const { createServer } = await import('node:http');
    const s = createServer((_q, r) => { r.setHeader('Transfer-Encoding', 'chunked'); r.write('hello'); r.write(' world'); r.end(); });
    await new Promise<void>((res) => s.listen(0, '127.0.0.1', res));
    const up = (s.address() as { port: number }).port;
    const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'dcs98-chunk-'));
    const audit = new EngagementAudit(join(dir, 'c.log'));
    const manifest = parseScopeManifest({ manifestId: 'e', mode: 'lab', expiresAt: '2999-01-01T00:00:00Z', include: [{ kind: 'cidr', value: '127.0.0.1/32' }] }, NOW);
    const proxy = new AuthorizedEgressProxy({ manifest, audit, resolveAll: async () => ['127.0.0.1'], now: () => NOW, rateLimitPerSec: 1000 });
    const { port } = await proxy.start();
    const got = await viaProxy(port, 'in.scope', up);
    expect(got.body).toBe('hello world'); // intact, not '5\r\nhello\r\n...'
    await proxy.stop(); s.close();
  });

  it('a non-lab domain-include manifest DENIES a metadata-IP target (withDefaultExcludes applied in proxy)', async () => {
    const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'dcs98-meta-'));
    const audit = new EngagementAudit(join(dir, 'm.log'));
    const manifest = parseScopeManifest({ manifestId: 'e', mode: 'engagement', expiresAt: '2999-01-01T00:00:00Z', include: [{ kind: 'domain', value: '*.example.com' }] }, NOW);
    const proxy = new AuthorizedEgressProxy({ manifest, audit, resolveAll: async () => ['169.254.169.254'], now: () => NOW, rateLimitPerSec: 1000 });
    const { port } = await proxy.start();
    const r = await viaProxy(port, 'a.example.com', 80);
    expect(r.status).toBe(403); // metadata IP excluded by default in non-lab mode
    await proxy.stop();
  });

  it('M2: audits the FULL resolved IP set on an allowed request', async () => {
    const up = await upstream();
    const dir = mkdtempSync(join(tmpdir(), 'dcs98-resolvedips-'));
    const audit = new EngagementAudit(join(dir, 'r.log'));
    // include 127.0.0.1/32 so the loopback upstream is dialable; resolver hands back a
    // multi-IP set whose first entry is the loopback we actually dial.
    const manifest = parseScopeManifest({ manifestId: 'e', mode: 'lab', expiresAt: '2999-01-01T00:00:00Z',
      include: [{ kind: 'cidr', value: '127.0.0.1/32' }, { kind: 'cidr', value: '203.0.113.0/24' }] }, NOW);
    const resolved = ['127.0.0.1', '203.0.113.5', '203.0.113.6'];
    const proxy = new AuthorizedEgressProxy({ manifest, audit, resolveAll: async () => resolved, now: () => NOW, rateLimitPerSec: 1000 });
    const { port } = await proxy.start();
    const ok = await viaProxy(port, 'in.scope', up.port);
    expect(ok.status).toBe(200);
    await proxy.stop(); up.close();
    const v = verifyAuditLog(join(dir, 'r.log'));
    expect(v.ok).toBe(true);
    const allowed = v.events.find((e) => e.decision === 'allowed');
    expect(allowed?.resolvedIps).toEqual(resolved);
  });

  it('M2: pin skips an excluded IP and dials the first NON-excluded one (defensive belt-and-suspenders)', async () => {
    // The integration `decide()` already DENIES any target with an excluded resolved IP, so the
    // pin can only ever be reached with a clean set in the live path. This test targets the pin's
    // skip-excluded branch directly via the private `pinNonExcluded`, proving that even if a
    // poisoned/excluded IP ever leaked past decide, we would never DIAL it.
    const dir = mkdtempSync(join(tmpdir(), 'dcs98-pin-'));
    const audit = new EngagementAudit(join(dir, 'p.log'));
    const manifest = parseScopeManifest({ manifestId: 'e', mode: 'lab', expiresAt: '2999-01-01T00:00:00Z',
      include: [{ kind: 'domain', value: '*.example.com' }],
      exclude: [{ kind: 'cidr', value: '10.0.0.0/8' }] }, NOW);
    const proxy = new AuthorizedEgressProxy({ manifest, audit, resolveAll: async () => ['127.0.0.1'], now: () => NOW, rateLimitPerSec: 1000 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pin = (ips: string[]): string | null => (proxy as any).pinNonExcluded(ips);
    expect(pin(['10.0.0.5', '203.0.113.5'])).toBe('203.0.113.5'); // skips the 10/8 IP
    expect(pin(['203.0.113.7', '10.0.0.9'])).toBe('203.0.113.7'); // first non-excluded
    expect(pin(['10.0.0.1', '10.255.255.255'])).toBeNull();       // all excluded => null (caller DENYs)
  });

  it('M2: an allowed multi-IP target dials the first resolved IP when none are excluded', async () => {
    const up = await upstream();
    const dir = mkdtempSync(join(tmpdir(), 'dcs98-pinclean-'));
    const audit = new EngagementAudit(join(dir, 'pc.log'));
    const manifest = parseScopeManifest({ manifestId: 'e', mode: 'lab', expiresAt: '2999-01-01T00:00:00Z',
      include: [{ kind: 'cidr', value: '127.0.0.1/32' }, { kind: 'cidr', value: '203.0.113.0/24' }] }, NOW);
    // first IP is the reachable loopback; none excluded => pin returns the first.
    const resolved = ['127.0.0.1', '203.0.113.5'];
    const proxy = new AuthorizedEgressProxy({ manifest, audit, resolveAll: async () => resolved, now: () => NOW, rateLimitPerSec: 1000 });
    const { port } = await proxy.start();
    const r = await viaProxy(port, 'in.scope', up.port);
    expect(r.status).toBe(200);
    expect(r.body).toBe('upstream-ok');
    await proxy.stop(); up.close();
    const v = verifyAuditLog(join(dir, 'pc.log'));
    const allowed = v.events.find((e) => e.decision === 'allowed');
    expect(allowed?.dialedIp).toBe('127.0.0.1');
    expect(allowed?.resolvedIps).toEqual(resolved);
  });

  it('H4: a forward jump in the AUDIT clock does NOT refill the token bucket (monotonic refill)', async () => {
    const up = await upstream();
    const dir = mkdtempSync(join(tmpdir(), 'dcs98-mono-'));
    const audit = new EngagementAudit(join(dir, 'h.log'));
    const manifest = parseScopeManifest({ manifestId: 'e', mode: 'lab', expiresAt: '2999-01-01T00:00:00Z',
      include: [{ kind: 'cidr', value: '127.0.0.1/32' }] }, NOW);
    // wall clock (audit) leaps forward by an hour after each call; monotonic clock stays put.
    let wall = NOW;
    const now = (): number => { const v = wall; wall += 3600_000; return v; };
    const mono = (): number => 1000; // frozen monotonic -> no refill ever
    // rate 2 => bucket starts with 2 tokens; 3rd request must 429 despite the wall-clock leap.
    const proxy = new AuthorizedEgressProxy({ manifest, audit, resolveAll: async () => ['127.0.0.1'], now, monotonic: mono, rateLimitPerSec: 2 });
    const { port } = await proxy.start();
    const r1 = await viaProxy(port, 'in.scope', up.port);
    const r2 = await viaProxy(port, 'in.scope', up.port);
    const r3 = await viaProxy(port, 'in.scope', up.port);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429); // bucket NOT refilled by the wall-clock forward jump
    await proxy.stop(); up.close();
  });
});
