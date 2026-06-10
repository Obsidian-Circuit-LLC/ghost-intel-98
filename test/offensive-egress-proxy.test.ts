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
});
