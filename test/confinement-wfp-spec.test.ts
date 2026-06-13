import { describe, it, expect } from 'vitest';
import { buildWfpFilterSpec, WEIGHT } from '../src/main/offensive/confinement/win-wfp-spec';
import type { ConfinementPlan } from '../src/main/offensive/confinement/plan';

const SID = 'S-1-5-21-1-2-3-1001'; // the dedicated engine user's SID (string form)
const plan = (allowCidrs: string[], proxyPort = 54321): ConfinementPlan => ({ proxyPort, allowCidrs, domainOnlyIncludes: [] });

describe('buildWfpFilterSpec', () => {
  it('always permits the loopback proxy at v4 with user+addr+port conditions', () => {
    const spec = buildWfpFilterSpec(plan([]), SID);
    const f = spec.filters.find((x) => x.action === 'permit' && x.layer === 'ALE_AUTH_CONNECT_V4'
      && x.conditions.some((c) => c.field === 'ip_remote_port' && c.port === 54321));
    expect(f).toBeTruthy();
    expect(f!.conditions).toEqual([
      { field: 'ale_user_id', sid: SID },
      { field: 'ip_remote_address', cidr: '127.0.0.1/32' },
      { field: 'ip_remote_port', port: 54321 },
    ]);
    expect(f!.weight).toBe(WEIGHT.SCOPE_PERMIT);
  });

  it('emits a catch-all BLOCK for the engine SID at BOTH families, below the permits', () => {
    const spec = buildWfpFilterSpec(plan([]), SID);
    const blocks = spec.filters.filter((x) => x.action === 'block' && x.weight === WEIGHT.BASE_DENY
      && x.conditions.length === 1 && x.conditions[0].field === 'ale_user_id');
    expect(blocks.map((b) => b.layer).sort()).toEqual(['ALE_AUTH_CONNECT_V4', 'ALE_AUTH_CONNECT_V6']);
    expect(WEIGHT.SCOPE_PERMIT).toBeGreaterThan(WEIGHT.BASE_DENY);
  });

  it('routes each scope CIDR to the layer for its family, above the base deny', () => {
    const spec = buildWfpFilterSpec(plan(['203.0.113.0/24', '2001:db8::/32']), SID);
    const v4 = spec.filters.find((x) => x.action === 'permit'
      && x.conditions.some((c) => c.field === 'ip_remote_address' && c.cidr === '203.0.113.0/24'));
    const v6 = spec.filters.find((x) => x.action === 'permit'
      && x.conditions.some((c) => c.field === 'ip_remote_address' && c.cidr === '2001:db8::/32'));
    expect(v4!.layer).toBe('ALE_AUTH_CONNECT_V4');
    expect(v6!.layer).toBe('ALE_AUTH_CONNECT_V6');
    expect(v4!.weight).toBe(WEIGHT.SCOPE_PERMIT);
  });

  it('emits a TOP-weight IMDS deny at both families (defense-in-depth, above scope permits)', () => {
    const spec = buildWfpFilterSpec(plan(['169.254.0.0/16']), SID); // even if scope foolishly contains IMDS
    const imds4 = spec.filters.find((x) => x.action === 'block'
      && x.conditions.some((c) => c.field === 'ip_remote_address' && c.cidr === '169.254.169.254/32'));
    expect(imds4!.weight).toBe(WEIGHT.IMDS_DENY);
    expect(WEIGHT.IMDS_DENY).toBeGreaterThan(WEIGHT.SCOPE_PERMIT);
  });

  it('carries the engine SID + pinned provider/sublayer GUIDs through to the spec', () => {
    const spec = buildWfpFilterSpec(plan([]), SID);
    expect(spec.engineSid).toBe(SID);
    expect(spec.providerGuid).toMatch(/^[0-9a-f-]{36}$/i);
    expect(spec.sublayerGuid).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('rejects an empty SID (a filter set not bound to the engine SID would confine nothing)', () => {
    expect(() => buildWfpFilterSpec(plan([]), '')).toThrow(/engine SID/);
  });

  it('rejects an out-of-range proxy port', () => {
    expect(() => buildWfpFilterSpec(plan([], 0), SID)).toThrow(/proxy port/);
    expect(() => buildWfpFilterSpec(plan([], 70000), SID)).toThrow(/proxy port/);
  });
});
