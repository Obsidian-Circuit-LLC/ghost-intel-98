/**
 * GhostScrape Task 3: X cookie builder tests (pure).
 *
 * buildXCookies produces the auth_token/ct0 cookies for the isolated
 * persist:ghostscrape session partition — .x.com, secure, path '/', url
 * 'https://x.com'. Empty inputs must never produce an empty-value cookie.
 */

import { describe, it, expect } from 'vitest';
import { buildXCookies } from '../src/main/x/ghostscrape/cookies';

describe('buildXCookies', () => {
  it('builds both cookies for non-empty auth_token/ct0', () => {
    const cookies = buildXCookies('AT', 'CT');
    expect(cookies).toHaveLength(2);

    const authCookie = cookies.find((c) => c.name === 'auth_token');
    expect(authCookie).toBeDefined();
    expect(authCookie).toMatchObject({
      url: 'https://x.com',
      name: 'auth_token',
      value: 'AT',
      domain: '.x.com',
      path: '/',
      secure: true,
      httpOnly: true, // auth_token must be httpOnly — weakening this must fail the test
    });

    const ct0Cookie = cookies.find((c) => c.name === 'ct0');
    expect(ct0Cookie).toBeDefined();
    expect(ct0Cookie).toMatchObject({
      url: 'https://x.com',
      name: 'ct0',
      value: 'CT',
      domain: '.x.com',
      path: '/',
      secure: true,
      httpOnly: false, // ct0 is read by x.com's own JS to set the x-csrf-token header — not httpOnly
    });
  });

  it('omits auth_token when empty', () => {
    const cookies = buildXCookies('', 'CT');
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe('ct0');
    expect(cookies.some((c) => c.value === '')).toBe(false);
  });

  it('omits ct0 when empty', () => {
    const cookies = buildXCookies('AT', '');
    expect(cookies).toHaveLength(1);
    expect(cookies[0].name).toBe('auth_token');
    expect(cookies.some((c) => c.value === '')).toBe(false);
  });

  it('returns no cookies when both are empty', () => {
    expect(buildXCookies('', '')).toEqual([]);
  });
});
