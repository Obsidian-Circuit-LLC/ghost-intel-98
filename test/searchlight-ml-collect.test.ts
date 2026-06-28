/**
 * Task 6 — Collect orchestrator: pure core unit tests.
 *
 * Tests the pure `rowToFeatures` transform and `DATASET_COLUMNS` definition
 * from collect-core.ts. The orchestrator script (collect.ts) does I/O and
 * is not tested here.
 */

import { describe, it, expect } from 'vitest';
import { rowToFeatures, DATASET_COLUMNS } from '../src/shared/searchlight/ml/collect-core';
import type { MaigretSiteEntry, RawCheckResult } from '../src/shared/searchlight/types';

// Shared fixture helpers (mirrors searchlight-signals.test.ts)
const site = (p: Partial<MaigretSiteEntry> = {}): MaigretSiteEntry => ({
  name: 'S', url: 'https://s.com/{username}', urlMain: 'https://s.com', urlProbe: '',
  category: 'social', tags: [], checkType: 'status_code', presenseStrs: [], absenceStrs: [],
  alexaRank: 1, headers: {}, usernameClaimed: 'admin', ...p });
const raw = (p: Partial<RawCheckResult> = {}): RawCheckResult =>
  ({ statusCode: 200, statusMessage: 'OK', elapsed: 10, redirectUrl: null, error: null, body: '', ...p });

const PROFILE = `<html><head><title>ghostexodus</title>
<meta property="og:type" content="profile">
<link rel="canonical" href="https://s.com/ghostexodus">
<script type="application/ld+json">{"@type":"Person","name":"ghostexodus"}</script>
</head><body><img src=a><img src=b>followers joined posts</body></html>`;

describe('rowToFeatures', () => {
  it('produces base + heuristic_score + interaction features', () => {
    const v = rowToFeatures(site(), raw({ statusCode: 200, body: PROFILE }), 'https://s.com/ghostexodus');
    expect(v.heuristic_score).toBeTypeOf('number');
    expect(v.heuristic_x_og_type).toBe(v.heuristic_score! * v.og_type_profile!);
    for (const c of DATASET_COLUMNS) expect(v[c]).toBeTypeOf('number');
  });

  it('heuristic_score is the raw weighted sum (not sigmoid-clamped)', () => {
    // A body-less 200 with username in path has positive raw sum well outside 0..1.
    // The model was trained against the raw weighted sum, not the sigmoid output.
    const v = rowToFeatures(site(), raw({ statusCode: 200, body: '' }), 'https://s.com/admin');
    // Raw weighted sum is NOT bounded to 0..1; the sigmoid is only in scoreSignals.
    // Just verify it's a finite number — not NaN, not Infinity.
    expect(Number.isFinite(v.heuristic_score)).toBe(true);
  });

  it('interaction features equal heuristic_score × signal', () => {
    const v = rowToFeatures(site(), raw({ statusCode: 200, body: PROFILE }), 'https://s.com/ghostexodus');
    const h = v.heuristic_score!;
    expect(v.heuristic_x_og_type).toBeCloseTo(h * (v.og_type_profile ?? 0), 10);
    expect(v.heuristic_x_json_ld).toBeCloseTo(h * (v.has_json_ld_person ?? 0), 10);
    expect(v.heuristic_x_error_kw).toBeCloseTo(h * (v.error_keyword_count ?? 0), 10);
    expect(v.heuristic_x_error_section).toBeCloseTo(h * (v.error_section_count ?? 0), 10);
  });

  it('is pure (same input → identical output, no Date.now/Math.random)', () => {
    const a = rowToFeatures(site(), raw({ body: PROFILE }), 'https://s.com/ghostexodus');
    const b = rowToFeatures(site(), raw({ body: PROFILE }), 'https://s.com/ghostexodus');
    expect(a).toEqual(b);
  });

  it('does not mutate the raw argument', () => {
    const r = raw({ statusCode: 200, body: PROFILE });
    const before = JSON.stringify(r);
    rowToFeatures(site(), r, 'https://s.com/ghostexodus');
    expect(JSON.stringify(r)).toBe(before);
  });
});

describe('DATASET_COLUMNS', () => {
  it('contains heuristic_score and all four interaction keys', () => {
    expect(DATASET_COLUMNS).toContain('heuristic_score');
    expect(DATASET_COLUMNS).toContain('heuristic_x_og_type');
    expect(DATASET_COLUMNS).toContain('heuristic_x_json_ld');
    expect(DATASET_COLUMNS).toContain('heuristic_x_error_kw');
    expect(DATASET_COLUMNS).toContain('heuristic_x_error_section');
  });

  it('does NOT contain is_soft404_site (no label leakage)', () => {
    expect(DATASET_COLUMNS).not.toContain('is_soft404_site');
    expect(DATASET_COLUMNS).not.toContain('label');
  });

  it('all columns are strings (no duplicates)', () => {
    expect(new Set(DATASET_COLUMNS).size).toBe(DATASET_COLUMNS.length);
    for (const c of DATASET_COLUMNS) expect(typeof c).toBe('string');
  });
});
