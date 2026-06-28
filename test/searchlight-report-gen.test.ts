/**
 * Task 13: maybe tier in PDF/HTML report.
 *
 * generateHTML is extracted to report-gen.ts so it can be unit-tested without
 * pulling in React/store dependencies.  Pure string-generation; no DOM needed.
 */

import { describe, it, expect } from 'vitest';
import { generateHTML } from '../src/renderer/modules/searchlight/report-gen';
import type { SweepResult } from '../src/shared/searchlight/types';

function r(overrides: Partial<SweepResult> = {}): SweepResult {
  return {
    id: 'test-id',
    jobId: 'job-1',
    siteName: 'TestSite',
    username: 'ghostexodus',
    url: 'https://testsite.com/ghostexodus',
    statusCode: 200,
    statusMessage: 'OK',
    elapsed: 42,
    redirectUrl: null,
    error: null,
    category: 'social',
    tags: [],
    checkType: 'status_code',
    found: false,
    confidence: 'medium',
    status: 'not_found',
    probability: undefined,
    timestamp: 1700000000000,
    ...overrides,
  };
}

describe('generateHTML — maybe tier', () => {
  it('maybe result row has class="maybe"', () => {
    const html = generateHTML('TestCase', [r({ status: 'maybe', found: false, probability: 0.45 })]);
    expect(html).toContain('class="maybe"');
  });

  it('maybe CSS rule is present (tr.maybe .status amber)', () => {
    const html = generateHTML('TestCase', [r({ status: 'maybe', found: false })]);
    expect(html).toContain('tr.maybe .status');
    expect(html).toContain('#d8a83a');
  });

  it('MAYBE stat box is present in the stats section', () => {
    const html = generateHTML('TestCase', [
      r({ status: 'maybe', found: false }),
      r({ status: 'found', found: true }),
    ]);
    expect(html).toContain('MAYBE');
    // The maybe count (1) appears in the stat box
    expect(html).toMatch(/stat-val[^>]*>[^<]*1[^<]*<\/div>\s*<div[^>]*>MAYBE/);
  });

  it('MAYBE stat = 0 when no maybe results', () => {
    const html = generateHTML('TestCase', [
      r({ status: 'found', found: true }),
      r({ status: 'not_found', found: false }),
    ]);
    // A "0" stat-val should appear before MAYBE (there are no maybe results)
    expect(html).toContain('MAYBE');
    expect(html).toMatch(/stat-val[^>]*>[^<]*0[^<]*<\/div>\s*<div[^>]*>MAYBE/);
  });

  it('found result row still has class="found" (not maybe)', () => {
    const html = generateHTML('TestCase', [r({ status: 'found', found: true })]);
    expect(html).toContain('class="found"');
    expect(html).not.toContain('class="maybe"');
  });

  it('error result row has class="error"', () => {
    const html = generateHTML('TestCase', [r({ status: 'error', found: false, error: 'TIMEOUT' })]);
    expect(html).toContain('class="error"');
  });

  it('XSS: caseName is escaped (amp, lt, gt)', () => {
    const html = generateHTML('<script>alert(1)</script>', []);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('XSS: siteName in row is escaped', () => {
    const html = generateHTML('Case', [r({ siteName: '<img onerror=alert(1)>' })]);
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img');
  });

  it('XSS: url is scheme-guarded (javascript: → #)', () => {
    const html = generateHTML('Case', [r({ url: 'javascript:alert(1)' })]);
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="#"');
  });

  it('determinism: same input → same output', () => {
    const results = [
      r({ status: 'found', found: true }),
      r({ status: 'maybe', found: false, probability: 0.42 }),
    ];
    const a = generateHTML('Case', results);
    const b = generateHTML('Case', results);
    expect(a).toBe(b);
  });
});
