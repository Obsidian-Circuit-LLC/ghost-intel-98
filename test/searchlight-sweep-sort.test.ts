/**
 * Tests for Task 11: sortable columns, summary panel, maybe filter chip, ETA.
 *
 * Pure-function utilities are extracted to src/shared/searchlight/sweep-panel-utils.ts
 * so they are testable without a renderer environment.
 */

import { describe, it, expect } from 'vitest';
import {
  matchesBucket,
  sortResults,
  summarizeSweep,
  computeEta,
} from '../src/shared/searchlight/sweep-panel-utils';
import type { SweepResult } from '../src/shared/searchlight/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function r(overrides: Partial<SweepResult>): SweepResult {
  return {
    id: 'x',
    jobId: 'j',
    siteName: overrides.siteName ?? 'Site',
    username: 'user',
    url: 'https://s.com/user',
    statusCode: 200,
    statusMessage: 'OK',
    elapsed: 100,
    redirectUrl: null,
    error: null,
    category: overrides.category ?? 'social',
    tags: [],
    checkType: 'status_code',
    found: overrides.found ?? false,
    confidence: 'medium',
    status: overrides.status ?? 'not_found',
    probability: overrides.probability,
    timestamp: 1000,
    ...overrides,
  };
}

// ── matchesBucket ─────────────────────────────────────────────────────────────

describe('matchesBucket', () => {
  it("'all' matches everything", () => {
    expect(matchesBucket(r({ status: 'found' }), 'all')).toBe(true);
    expect(matchesBucket(r({ status: 'maybe' }), 'all')).toBe(true);
    expect(matchesBucket(r({ status: 'not_found' }), 'all')).toBe(true);
  });

  it("'maybe' bucket matches only maybe results", () => {
    expect(matchesBucket(r({ status: 'maybe' }), 'maybe')).toBe(true);
    expect(matchesBucket(r({ status: 'found' }), 'maybe')).toBe(false);
    expect(matchesBucket(r({ status: 'not_found' }), 'maybe')).toBe(false);
    expect(matchesBucket(r({ status: 'error' }), 'maybe')).toBe(false);
  });

  it("'found' bucket", () => {
    expect(matchesBucket(r({ status: 'found' }), 'found')).toBe(true);
    expect(matchesBucket(r({ status: 'maybe' }), 'found')).toBe(false);
  });

  it("'error' bucket covers unknown", () => {
    expect(matchesBucket(r({ status: 'error' }), 'error')).toBe(true);
    expect(matchesBucket(r({ status: 'unknown' }), 'error')).toBe(true);
    expect(matchesBucket(r({ status: 'found' }), 'error')).toBe(false);
  });

  it("'notfound' bucket", () => {
    expect(matchesBucket(r({ status: 'not_found', statusCode: 200 }), 'notfound')).toBe(true);
    // redirect: 301 + not_found → goes to redirect bucket, not notfound
    expect(matchesBucket(r({ status: 'not_found', statusCode: 301 }), 'notfound')).toBe(false);
  });

  it("'redirect' bucket: 3xx not_found only", () => {
    expect(matchesBucket(r({ status: 'not_found', statusCode: 301 }), 'redirect')).toBe(true);
    expect(matchesBucket(r({ status: 'found', statusCode: 301 }), 'redirect')).toBe(false);
    expect(matchesBucket(r({ status: 'not_found', statusCode: 200 }), 'redirect')).toBe(false);
  });
});

// ── sortResults ────────────────────────────────────────────────────────────────

describe('sortResults', () => {
  const RESULTS = [
    r({ siteName: 'Bbb', status: 'not_found', elapsed: 300, category: 'tech' }),
    r({ siteName: 'Aaa', status: 'found',     elapsed: 100, category: 'social', probability: 0.9 }),
    r({ siteName: 'Ccc', status: 'maybe',     elapsed: 200, category: 'gaming', probability: 0.5 }),
    r({ siteName: 'Ddd', status: 'error',     elapsed:  50, category: 'social' }),
    r({ siteName: 'Eee', status: 'blocked',   elapsed: 150, category: 'tech' }),
  ];

  it('status sort: canonical order found→maybe→blocked→not_found→unknown→error', () => {
    const sorted = sortResults([...RESULTS], 'status', 1);
    expect(sorted.map(x => x.status)).toEqual(['found', 'maybe', 'blocked', 'not_found', 'error']);
  });

  it('status sort descending reverses canonical order', () => {
    const sorted = sortResults([...RESULTS], 'status', -1);
    expect(sorted[0].status).toBe('error');
    expect(sorted[sorted.length - 1].status).toBe('found');
  });

  it('elapsed sort ascending', () => {
    const sorted = sortResults([...RESULTS], 'elapsed', 1);
    expect(sorted.map(x => x.elapsed)).toEqual([50, 100, 150, 200, 300]);
  });

  it('elapsed sort descending', () => {
    const sorted = sortResults([...RESULTS], 'elapsed', -1);
    expect(sorted[0].elapsed).toBe(300);
    expect(sorted[sorted.length - 1].elapsed).toBe(50);
  });

  it('site sort alphabetical ascending', () => {
    const sorted = sortResults([...RESULTS], 'site', 1);
    expect(sorted.map(x => x.siteName)).toEqual(['Aaa', 'Bbb', 'Ccc', 'Ddd', 'Eee']);
  });

  it('probability sort: nulls last when ascending', () => {
    const sorted = sortResults([...RESULTS], 'probability', 1);
    // items without probability sort to the start (treated as -1)
    const withProb = sorted.filter(x => x.probability != null);
    expect(withProb[0].probability).toBe(0.5);
    expect(withProb[1].probability).toBe(0.9);
  });

  it('stable tie-break: same status → sorted by siteName ascending', () => {
    const same = [
      r({ siteName: 'Zzz', status: 'found' }),
      r({ siteName: 'Aaa', status: 'found' }),
    ];
    const sorted = sortResults(same, 'status', 1);
    expect(sorted[0].siteName).toBe('Aaa');
    expect(sorted[1].siteName).toBe('Zzz');
  });

  it('determinism: repeated sort produces identical result', () => {
    const a = sortResults([...RESULTS], 'status', 1).map(x => x.siteName);
    const b = sortResults([...RESULTS], 'status', 1).map(x => x.siteName);
    expect(a).toEqual(b);
  });
});

// ── summarizeSweep ─────────────────────────────────────────────────────────────

describe('summarizeSweep', () => {
  const MIXED = [
    r({ status: 'found',     category: 'social' }),
    r({ status: 'found',     category: 'tech' }),
    r({ status: 'maybe',     category: 'social' }),
    r({ status: 'not_found', category: 'tech' }),
    r({ status: 'error',     category: 'gaming' }),
    r({ status: 'blocked',   category: 'social' }),
  ];

  it('per-status tallies', () => {
    const s = summarizeSweep(MIXED);
    expect(s.found).toBe(2);
    expect(s.maybe).toBe(1);
    expect(s.not_found).toBe(1);
    expect(s.error).toBe(1);
    expect(s.blocked).toBe(1);
    expect(s.unknown).toBe(0);
  });

  it('by-category found+maybe breakdown', () => {
    const s = summarizeSweep(MIXED);
    // social: 1 found + 1 maybe = 2 hits
    expect(s.byCategory['social']?.found).toBe(1);
    expect(s.byCategory['social']?.maybe).toBe(1);
    // tech: 1 found
    expect(s.byCategory['tech']?.found).toBe(1);
    expect(s.byCategory['tech']?.maybe).toBe(0);
    // gaming: no hits
    expect(s.byCategory['gaming']).toBeUndefined();
  });

  it('empty input produces zero tallies', () => {
    const s = summarizeSweep([]);
    expect(s.found).toBe(0);
    expect(s.maybe).toBe(0);
    expect(Object.keys(s.byCategory)).toHaveLength(0);
  });
});

// ── computeEta ─────────────────────────────────────────────────────────────────

describe('computeEta', () => {
  it('basic ETA: elapsedSoFar / checked * remaining', () => {
    // checked=10, total=100 → remaining=90; elapsed=10s → eta=90s
    expect(computeEta(10, 100, 10_000)).toBe(90_000);
  });

  it('returns null when checked=0 (guard divide-by-zero)', () => {
    expect(computeEta(0, 100, 5_000)).toBeNull();
  });

  it('returns null when total <= checked (sweep done)', () => {
    expect(computeEta(100, 100, 10_000)).toBeNull();
    expect(computeEta(105, 100, 10_000)).toBeNull();
  });

  it('returns null when elapsedMs=0', () => {
    expect(computeEta(5, 100, 0)).toBeNull();
  });

  it('proportional: doubling elapsed doubles ETA', () => {
    const eta1 = computeEta(10, 110, 10_000);
    const eta2 = computeEta(10, 110, 20_000);
    expect(eta1).not.toBeNull();
    expect(eta2).not.toBeNull();
    expect(eta2!).toBeCloseTo(eta1! * 2, 6);
  });
});
