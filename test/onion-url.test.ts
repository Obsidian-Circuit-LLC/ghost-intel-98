import { describe, it, expect } from 'vitest';
import { isOnionUrl } from '../src/shared/onion';

describe('isOnionUrl (SearXNG instance validation — mirrors main fail-closed .onion enforcement)', () => {
  it('accepts an http .onion URL (the SearXNG default shape)', () => {
    expect(isOnionUrl('http://searxokthnxmo7ndis35jpts2tawcwvbovuy47qtavwo7oq4jgcm5gqd.onion')).toBe(true);
  });
  it('accepts https + port + path, and trims surrounding whitespace', () => {
    expect(isOnionUrl('https://abc.onion:8080/search')).toBe(true);
    expect(isOnionUrl('  http://abc.onion  ')).toBe(true);
  });
  it('is case-insensitive on the host', () => {
    expect(isOnionUrl('http://ABC.ONION')).toBe(true);
  });
  it('rejects clearnet hosts, including .onion appearing as a non-TLD label', () => {
    expect(isOnionUrl('https://searx.example.com')).toBe(false);
    expect(isOnionUrl('http://onion.example.com')).toBe(false);
    expect(isOnionUrl('http://foo.onion.com')).toBe(false);
  });
  it('rejects a scheme-less value, garbage, and empty (main also parses via new URL)', () => {
    expect(isOnionUrl('')).toBe(false);
    expect(isOnionUrl('not a url')).toBe(false);
    expect(isOnionUrl('searxokth.onion')).toBe(false); // no scheme → not a URL
  });
});
