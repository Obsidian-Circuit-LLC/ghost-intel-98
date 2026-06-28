import { describe, it, expect } from 'vitest';
import { extractSignals } from '../src/shared/searchlight/signals';
import type { MaigretSiteEntry, RawCheckResult } from '../src/shared/searchlight/types';

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

describe('extractSignals', () => {
  it('cheap: 200 status bucket + username in path', () => {
    const v = extractSignals(site(), raw({ statusCode: 200 }), 'https://s.com/admin');
    expect(v.http_200).toBe(1); expect(v.http_404).toBe(0); expect(v.has_username_in_path).toBe(1);
  });
  it('cheap: 404 bucket', () => {
    const v = extractSignals(site(), raw({ statusCode: 404 }), 'https://s.com/admin');
    expect(v.http_404).toBe(1); expect(v.http_200).toBe(0);
  });
  it('body: real-profile markers fire', () => {
    const v = extractSignals(site(), raw({ body: PROFILE }), 'https://s.com/ghostexodus');
    expect(v.og_type_profile).toBe(1); expect(v.has_json_ld_person).toBe(1);
    expect(v.title_has_username).toBe(1); expect(v.username_in_canonical).toBe(1);
    expect(v.positive_keyword_count).toBeGreaterThan(0); expect(v.img_count).toBe(2);
  });
  it('body: soft-404 error markers fire, profile markers do not', () => {
    const v = extractSignals(site(), raw({ body: SOFT404 }), 'https://s.com/ghostexodus');
    expect(v.og_type_profile).toBe(0); expect(v.has_json_ld_person).toBe(0);
    expect(v.error_keyword_count).toBeGreaterThan(0);
  });
  it('malformed JSON-LD does not throw', () => {
    const v = extractSignals(site(), raw({ body: '<script type="application/ld+json">{bad</script>' }), 'https://s.com/x');
    expect(v.has_json_ld_person).toBe(0);
  });
  it('determinism: same input → identical vector', () => {
    const a = extractSignals(site(), raw({ body: PROFILE }), 'https://s.com/ghostexodus');
    const b = extractSignals(site(), raw({ body: PROFILE }), 'https://s.com/ghostexodus');
    expect(a).toEqual(b);
  });
});
