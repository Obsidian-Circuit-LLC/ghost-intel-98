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

// ---------------------------------------------------------------------------
// Task 10: interaction features wired into ML inference
// ---------------------------------------------------------------------------

describe('interpretResult Task 10 — interaction features in ML inference', () => {
  // A tiny model whose ONLY feature is the interaction term heuristic_x_og_type.
  // With a large positive coef, if the interaction feature is correctly built and
  // passed to predict(), the PROFILE vector (og_type_profile=1, positive heuristic)
  // flips from 'maybe' (neutral prior when feature is absent) to 'found'.
  //
  // Before fix: predict() sees mean(0) for the missing heuristic_x_og_type key
  //             → sigmoid(50·0) = 0.5 → maybe (0.3224 ≤ 0.5 < 0.5559).
  // After fix:  buildInteractionFeatures(v) sets heuristic_x_og_type = weightedSum(v)·1
  //             (positive) → predict sees large positive → ≈1.0 → found.
  const mlCtx: ScorerCtx = {
    thresholds: { found: 0.5559, notFound: 0.3224 },
    useMl: true,
    model: {
      version: 'test-t10',
      feature_schema: ['heuristic_x_og_type'],
      mean: [0],
      scale: [1],
      coef: [50],
      intercept: 0,
      ml_weight: 1.0,
      thresholds: { found: 0.5559, not_found: 0.3224 },
    },
  };

  it('interaction feature heuristic_x_og_type reaches predict — PROFILE body → found', () => {
    const r = interpretResult(
      base,
      raw({ statusCode: 200, body: PROFILE }),
      'https://x.com/ghostexodus',
      mlCtx,
    );
    expect(r.status).toBe('found');
    expect(r.probability).toBeGreaterThan(0.9);
  });

  it('PROFILE with og_type_profile=0 body would give low interaction value (sanity)', () => {
    // Verify the interaction term only fires when og_type_profile=1.
    // A bare 200 with no body → no og_type_profile signal → interaction = 0 → maybe.
    const r = interpretResult(
      base,
      raw({ statusCode: 200, body: '' }),
      'https://x.com/ghostexodus',
      mlCtx,
    );
    // No body → no og_type_profile → heuristic_x_og_type = 0 → predict = 0.5 → maybe
    expect(r.status).toBe('maybe');
  });

  it('useMl:false path unaffected — heuristic-only resolves PROFILE to found', () => {
    const ctxHeuristic: ScorerCtx = { thresholds: { found: 0.5559, notFound: 0.3224 }, useMl: false, model: null };
    const r = interpretResult(
      base,
      raw({ statusCode: 200, body: PROFILE }),
      'https://x.com/ghostexodus',
      ctxHeuristic,
    );
    expect(r.status).toBe('found');
  });

  it('existing shipped model unaffected — feature_schema without interaction keys ignores extras', () => {
    // If a model has feature_schema that does NOT include heuristic_x_og_type,
    // the extra key in v is simply ignored (predict indexes by schema position only).
    // This confirms the fix is inert for the currently shipped vendored model.
    const modelWithoutInteraction: ScorerCtx = {
      thresholds: { found: 0.5559, notFound: 0.3224 },
      useMl: true,
      model: {
        version: 'no-interaction',
        feature_schema: ['http_200'],
        mean: [0.5],
        scale: [0.5],
        coef: [1.0],
        intercept: 0,
        ml_weight: 0.6,
        thresholds: { found: 0.5559, not_found: 0.3224 },
      },
    };
    // Must not throw; result is valid
    const r = interpretResult(
      base,
      raw({ statusCode: 200, body: PROFILE }),
      'https://x.com/ghostexodus',
      modelWithoutInteraction,
    );
    expect(['found', 'maybe', 'not_found']).toContain(r.status);
    expect(typeof r.probability).toBe('number');
  });
});
