import { describe, it, expect } from 'vitest';
import { isSoft404Site } from '../src/shared/searchlight/ml/soft404';
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
const SOFT404 = `<html><head><title>Page not found</title></head>
<body>Sorry, this account doesn't exist. <a href=/>home</a></body></html>`;

describe('isSoft404Site', () => {
  it('200 + no profile markers → soft-404 site', () => {
    expect(isSoft404Site(raw({ statusCode: 200, body: SOFT404 }), site(), 'https://s.com/fakehandle')).toBe(true);
  });
  it('clean 404 → not soft-404 site', () => {
    expect(isSoft404Site(raw({ statusCode: 404, body: '' }), site(), 'https://s.com/fakehandle')).toBe(false);
  });
  it('200 + profile markers → not soft-404 (site actually rendered a profile for a fake handle? treat as non-soft)', () => {
    expect(isSoft404Site(raw({ statusCode: 200, body: PROFILE }), site(), 'https://s.com/fakehandle')).toBe(false);
  });
  it('200 with empty body → soft-404 (no markers)', () => {
    expect(isSoft404Site(raw({ statusCode: 200, body: '' }), site(), 'https://s.com/fakehandle')).toBe(true);
  });
  it('non-200 status (5xx) → not soft-404', () => {
    expect(isSoft404Site(raw({ statusCode: 500, body: '' }), site(), 'https://s.com/fakehandle')).toBe(false);
  });
});
