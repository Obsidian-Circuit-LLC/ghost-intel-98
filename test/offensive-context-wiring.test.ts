import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'dcs98-ctx-'));
vi.mock('electron', () => ({ app: { getPath: () => DATA } }));

import { initEngagementController, _resetEngagementControllerForTest, getEngagementController } from '../src/main/offensive/controller';
import { buildContextDeps } from '../src/main/plugins/wire-deps';

const NOW = Date.parse('2026-06-10T00:00:00Z');
const manifestRaw = { manifestId: 'e', mode: 'lab', expiresAt: '2999-01-01T00:00:00Z', include: [{ kind: 'cidr', value: '127.0.0.1/32' }] };
const settings = { confirmMode: 'per-scan' as const, rateLimitPerSec: 1000, requireSignedAuthorization: false, issuerKeys: [] };

describe('attackEgress context wiring', () => {
  beforeEach(() => _resetEngagementControllerForTest());

  it('buildContextDeps exposes attackEgress with proxyUrl and scopeContentHash functions', () => {
    const deps = buildContextDeps();
    expect(typeof deps.attackEgress?.proxyUrl).toBe('function');
    expect(typeof deps.attackEgress?.scopeContentHash).toBe('function');
  });

  it('proxyUrl returns empty string when no controller is initialised', () => {
    const deps = buildContextDeps();
    expect(deps.attackEgress?.proxyUrl()).toBe('');
    expect(deps.attackEgress?.scopeContentHash()).toBe('');
  });

  it('proxyUrl returns empty string when controller exists but no scan is running', () => {
    initEngagementController({ auditDir: DATA, now: () => NOW, settings });
    const deps = buildContextDeps();
    expect(deps.attackEgress?.proxyUrl()).toBe('');
    expect(deps.attackEgress?.scopeContentHash()).toBe('');
  });

  it('proxyUrl returns live http://127.0.0.1:<port> during an active scan and empty string after stop', async () => {
    const deps = buildContextDeps();
    // no controller yet — empty
    expect(deps.attackEgress?.proxyUrl()).toBe('');

    const ctl = initEngagementController({ auditDir: DATA, now: () => NOW, settings });
    // controller exists but no scan — still empty
    expect(deps.attackEgress?.proxyUrl()).toBe('');

    ctl.loadScope(manifestRaw);
    ctl.confirm();
    await ctl.startScan();

    // live proxy URL during scan
    const url = deps.attackEgress?.proxyUrl() ?? '';
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(Number(url.split(':')[2])).toBeGreaterThan(0);

    await ctl.stopScan();
    // back to empty after stop
    expect(deps.attackEgress?.proxyUrl()).toBe('');
  });

  it('getEngagementController returns the same instance used by attackEgress', () => {
    const ctl = initEngagementController({ auditDir: DATA, now: () => NOW, settings });
    expect(getEngagementController()).toBe(ctl);
  });

  it('deps object built before init still reflects the live controller after init (lazy reads)', async () => {
    // Build deps before the controller exists
    const deps = buildContextDeps();
    expect(deps.attackEgress?.proxyUrl()).toBe('');

    // Now init the controller and start a scan
    const ctl = initEngagementController({ auditDir: DATA, now: () => NOW, settings });
    ctl.loadScope(manifestRaw);
    ctl.confirm();
    await ctl.startScan();

    // The pre-built deps object reflects the new live state
    expect(deps.attackEgress?.proxyUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    await ctl.stopScan();
  });
});
