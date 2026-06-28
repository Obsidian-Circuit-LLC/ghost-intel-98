import { describe, it, expect } from 'vitest';
import { interpretResult } from '@shared/searchlight/interpret';
import type { MaigretSiteEntry, RawCheckResult, ScorerCtx } from '@shared/searchlight/types';

const base: MaigretSiteEntry = {
  name: 'X', url: 'https://x.com/{username}', urlMain: 'https://x.com', urlProbe: '',
  category: 'social', tags: ['social'], checkType: 'status_code',
  presenseStrs: [], absenceStrs: [], alexaRank: 1, headers: {}, usernameClaimed: 'admin'
};
const raw = (p: Partial<RawCheckResult>): RawCheckResult =>
  ({ statusCode: 200, statusMessage: 'OK', elapsed: 10, redirectUrl: null, error: null, body: '', ...p });

describe('interpretResult', () => {
  it('status_code 200 => found/high', () => {
    const r = interpretResult(base, raw({ statusCode: 200 }), 'https://x.com/admin');
    expect(r.status).toBe('found'); expect(r.found).toBe(true); expect(r.confidence).toBe('high');
  });
  it('status_code 404 => not_found', () => {
    expect(interpretResult(base, raw({ statusCode: 404 }), 'u').status).toBe('not_found');
  });
  it('403/429/503 => blocked (not a false not_found)', () => {
    for (const c of [403, 429, 503]) expect(interpretResult(base, raw({ statusCode: c }), 'u').status).toBe('blocked');
  });
  it('ignore403 site: 403 falls through to content interpretation, not blocked', () => {
    // A site with ignore403:true treats 403 as a normal response; content decides.
    const site: MaigretSiteEntry = { ...base, ignore403: true, checkType: 'status_code' };
    // status_code path: 403 !== 200, so found=false / not_found (not 'blocked')
    const r = interpretResult(site, raw({ statusCode: 403 }), 'u');
    expect(r.status).toBe('not_found');
    expect(r.found).toBe(false);
  });
  it('ignore403 site + message checkType: 403 with presence string => found', () => {
    // With ignore403 + message check, 403 gets past the blocked guard and body is examined.
    const site: MaigretSiteEntry = {
      ...base, ignore403: true, checkType: 'message', presenseStrs: ['ProfilePage'], absenceStrs: []
    };
    const r = interpretResult(site, raw({ statusCode: 403, body: 'Welcome to ProfilePage' }), 'u');
    expect(r.status).toBe('found');
    expect(r.found).toBe(true);
  });
  it('ignore403 does NOT affect 429 or 503 (those remain blocked)', () => {
    // Only 403 is covered by ignore403; 429/503 still trigger blocked regardless.
    const site: MaigretSiteEntry = { ...base, ignore403: true };
    expect(interpretResult(site, raw({ statusCode: 429 }), 'u').status).toBe('blocked');
    expect(interpretResult(site, raw({ statusCode: 503 }), 'u').status).toBe('blocked');
  });
  it('TOR_UNAVAILABLE => error', () => {
    expect(interpretResult(base, raw({ error: 'TOR_UNAVAILABLE', statusCode: 0 }), 'u').status).toBe('error');
  });
  it('network error => unknown', () => {
    expect(interpretResult(base, raw({ error: 'TIMEOUT', statusCode: 0 }), 'u').status).toBe('unknown');
  });
  it('message: absence string present => not_found/high', () => {
    const s = { ...base, checkType: 'message' as const, absenceStrs: ['No such user'] };
    const r = interpretResult(s, raw({ body: 'Sorry, No such user here' }), 'u');
    expect(r.status).toBe('not_found'); expect(r.confidence).toBe('high');
  });
  it('message: all presence strings present => found/high', () => {
    const s = { ...base, checkType: 'message' as const, presenseStrs: ['Profile', 'Followers'] };
    const r = interpretResult(s, raw({ body: '<h1>Profile</h1> 10 Followers' }), 'u');
    expect(r.status).toBe('found'); expect(r.confidence).toBe('high');
  });
});

describe('response_url', () => {
  const site = { ...base, checkType: 'response_url' as const };

  it('200, no redirect, tail present => found/medium', () => {
    const r = interpretResult(site, raw({ statusCode: 200, redirectUrl: null }), 'https://x.com/admin');
    expect(r.found).toBe(true);
    expect(r.status).toBe('found');
    expect(r.confidence).toBe('medium');
  });

  it('200 but redirect away from username path => not_found/medium', () => {
    const r = interpretResult(
      site,
      raw({ statusCode: 200, redirectUrl: 'https://x.com/login' }),
      'https://x.com/admin'
    );
    expect(r.found).toBe(false);
    expect(r.status).toBe('not_found');
    expect(r.confidence).toBe('medium');
  });

  it('trailing-slash URL: strips slash, extracts tail, no redirect => found/medium (no crash)', () => {
    // OLD bug: 'https://x.com/admin/'.split('/').pop() === '' → fallback '___' → redirected always
    // false → every 200 reads found. FIX strips trailing slash first so tail='admin' is recovered.
    const r = interpretResult(site, raw({ statusCode: 200, redirectUrl: null }), 'https://x.com/admin/');
    expect(r.found).toBe(true);
    expect(r.status).toBe('found');
    expect(r.confidence).toBe('medium');
  });

  it('trailing-slash URL: strips slash, redirect away detected correctly (no crash)', () => {
    // After fix, tail='admin' from stripped URL; redirect to /login excludes 'admin' in pathname
    // so redirected=true and result is not_found — old bug would have given found.
    const r = interpretResult(
      site,
      raw({ statusCode: 200, redirectUrl: 'https://x.com/login' }),
      'https://x.com/admin/'
    );
    expect(r.found).toBe(false);
    expect(r.status).toBe('not_found');
    expect(r.confidence).toBe('medium');
  });

  it('empty-tail URL (malformed empty string): status 200 => found/low (no-signal path)', () => {
    // Defensive guard: if targetUrl produces an empty tail after stripping (e.g. misconfigured
    // empty string), redirect detection is skipped entirely and confidence degrades to low.
    const r = interpretResult(site, raw({ statusCode: 200, redirectUrl: null }), '');
    expect(r.found).toBe(true);
    expect(r.confidence).toBe('low');
  });

  it('redirect URL contains username only in query param => not_found (pathname check ignores query)', () => {
    // pathname of https://x.com/login?ref=admin is /login, which does not include "admin"
    const r = interpretResult(
      site,
      raw({ statusCode: 200, redirectUrl: 'https://x.com/login?ref=admin' }),
      'https://x.com/admin'
    );
    expect(r.found).toBe(false);
    expect(r.status).toBe('not_found');
    expect(r.confidence).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// Task 4: ScorerCtx integration — heuristic path
// ---------------------------------------------------------------------------

const PROFILE = `<html><head><title>ghostexodus</title>
<meta property="og:type" content="profile">
<link rel="canonical" href="https://s.com/ghostexodus">
<script type="application/ld+json">{"@type":"Person","name":"ghostexodus"}</script>
</head><body><img src=a><img src=b>followers joined posts</body></html>`;

const ctx: ScorerCtx = { thresholds: { found: 0.5559, notFound: 0.3224 }, useMl: false, model: null };

describe('interpretResult with ScorerCtx', () => {
  it('status_code 200 with no body → maybe (was false-positive found)', () => {
    const r = interpretResult(base, raw({ statusCode: 200, body: '' }), 'https://x.com/admin', ctx);
    expect(r.status).toBe('maybe');
  });

  it('status_code 200 with profile body → found', () => {
    const r = interpretResult(base, raw({ statusCode: 200, body: PROFILE }), 'https://x.com/ghostexodus', ctx);
    expect(r.status).toBe('found');
  });

  it('curated message site stays authoritative (unchanged, no ctx influence)', () => {
    const s = { ...base, checkType: 'message' as const, absenceStrs: ['No such user'] };
    const r = interpretResult(s, raw({ statusCode: 200, body: 'No such user' }), 'https://x.com/admin', ctx);
    expect(r.status).toBe('not_found');
    expect(r.confidence).toBe('high');
  });

  it('no ctx → legacy behavior preserved', () => {
    const r = interpretResult(base, raw({ statusCode: 200 }), 'https://x.com/admin');
    expect(r.status).toBe('found'); // unchanged legacy path
  });

  it('scorer result carries probability', () => {
    const r = interpretResult(base, raw({ statusCode: 200, body: PROFILE }), 'https://x.com/ghostexodus', ctx);
    expect(typeof r.probability).toBe('number');
    expect(r.probability).toBeGreaterThan(0);
    expect(r.probability).toBeLessThanOrEqual(1);
  });

  it('404 with ctx → not_found (blocked/error short-circuits unchanged)', () => {
    const r = interpretResult(base, raw({ statusCode: 404 }), 'https://x.com/admin', ctx);
    expect(r.status).toBe('not_found');
  });
});
