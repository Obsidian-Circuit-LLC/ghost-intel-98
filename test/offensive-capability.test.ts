import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CAPABILITIES } from '../src/shared/plugin-types';
import { EngagementController } from '../src/main/offensive/engagement-controller';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const manifestRaw = { manifestId: 'e', mode: 'lab', expiresAt: '2999-01-01T00:00:00Z',
  include: [{ kind: 'cidr', value: '127.0.0.1/32' }] };
const settings = { confirmMode: 'per-scan' as const, rateLimitPerSec: 1000, requireSignedAuthorization: false, issuerKeys: [] };

describe('authorized-target-egress capability', () => {
  it('is a known capability', () => {
    expect([...CAPABILITIES]).toContain('authorized-target-egress');
  });
  it('controller refuses to start a scan before scope load + confirm; allows after', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dcs98-ctl-'));
    const ctl = new EngagementController({ auditDir: dir, now: () => NOW, settings });
    await expect(ctl.startScan()).rejects.toThrow(/no engagement|not confirmed/i);
    ctl.loadScope(manifestRaw);
    await expect(ctl.startScan()).rejects.toThrow(/not confirmed/i);
    ctl.confirm();
    const started = await ctl.startScan();
    expect(typeof started.proxyPort).toBe('number');
    await ctl.stopScan();
  });
  it('refuses a manifest needing a signature when policy requires it and no issuer configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dcs98-ctl2-'));
    const ctl = new EngagementController({ auditDir: dir, now: () => NOW,
      settings: { ...settings, requireSignedAuthorization: true } });
    expect(() => ctl.loadScope(manifestRaw)).toThrow(/signed authorization required/i);
  });
  it('anchors the ephemeral public key when a scan starts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dcs98-ctl3-'));
    let anchored: string | null = null;
    const ctl = new EngagementController({ auditDir: dir, now: () => NOW, settings,
      onAnchorPublicKey: (pubHex) => { anchored = pubHex; } });
    ctl.loadScope(manifestRaw); ctl.confirm();
    await ctl.startScan();
    expect(anchored).toMatch(/^[0-9a-f]{64}$/); // 32-byte ed25519 pubkey hex, anchored before/at scan start
    await ctl.stopScan();
  });
});
