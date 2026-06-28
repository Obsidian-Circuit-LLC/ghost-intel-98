import { describe, it, expect } from 'vitest';
import { scoreSignals, classify, DEFAULT_WEIGHTS, SIGMOID_SCALE } from '../src/shared/searchlight/scorer';
import { extractSignals } from '../src/shared/searchlight/signals';
import type { MaigretSiteEntry, RawCheckResult } from '../src/shared/searchlight/types';

// Shared fixtures (mirrors searchlight-signals.test.ts)
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

const SOFT404 = `<html><head><title>Page not found</title></head>
<body>Sorry, this account doesn't exist. <a href=/>home</a></body></html>`;

// Model default thresholds (from model.json)
const T = { found: 0.5559, notFound: 0.3224 };

describe('scoreSignals + classify', () => {
  it('real profile → found', () => {
    const v = extractSignals(site(), raw({ body: PROFILE }), 'https://s.com/ghostexodus');
    expect(classify(scoreSignals(v), T).status).toBe('found');
  });

  it('soft-404 → not_found', () => {
    const v = extractSignals(site(), raw({ body: SOFT404 }), 'https://s.com/ghostexodus');
    expect(classify(scoreSignals(v), T).status).toBe('not_found');
  });

  it('bare 200 no body → maybe (ambiguous, triggers escalation)', () => {
    const v = extractSignals(site(), raw({ statusCode: 200, body: '' }), 'https://s.com/x');
    expect(classify(scoreSignals(v), T).status).toBe('maybe');
  });

  it('threshold override flips verdict', () => {
    const v = extractSignals(site(), raw({ body: PROFILE }), 'https://s.com/ghostexodus');
    const p = scoreSignals(v);
    // With upstream-baseline weights the PROFILE score is ~0.9965; a found
    // threshold of 0.999 sits above it and should flip the verdict to maybe.
    expect(classify(p, { found: 0.999, notFound: 0.998 }).status).not.toBe('found');
  });

  it('sigmoid output bounded 0..1 for negative weight', () => {
    expect(scoreSignals({ http_404: 1 })).toBeGreaterThan(0);
    expect(scoreSignals({ http_404: 1 })).toBeLessThan(0.5);
  });

  it('sigmoid output bounded 0..1 for positive weight', () => {
    const p = scoreSignals({ http_200: 1 });
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });

  it('determinism: same input → identical score', () => {
    const v = extractSignals(site(), raw({ body: PROFILE }), 'https://s.com/ghostexodus');
    expect(scoreSignals(v)).toBe(scoreSignals(v));
  });

  it('DEFAULT_WEIGHTS exported and has http_200', () => {
    expect(typeof DEFAULT_WEIGHTS.http_200).toBe('number');
  });

  it('SIGMOID_SCALE is 6', () => {
    expect(SIGMOID_SCALE).toBe(6);
  });

  it('classify: high confidence when far from boundary', () => {
    // Probability well above found threshold → high
    const r = classify(0.95, T);
    expect(r.status).toBe('found');
    expect(r.confidence).toBe('high');
  });

  it('classify: low confidence near boundary', () => {
    // Probability just barely above notFound → maybe, near boundary → low
    const borderProb = T.notFound + 0.01;
    const r = classify(borderProb, T);
    expect(r.status).toBe('maybe');
    expect(r.confidence).toBe('low');
  });

  it('classify: not_found below notFound threshold', () => {
    expect(classify(0.1, T).status).toBe('not_found');
  });
});
