/**
 * safeHref — XSS choke-point unit tests.
 *
 * Verifies that the scheme-guard allows only http/https and blocks all other
 * schemes or malformed inputs (javascript:, data:, file:, vbscript:, empty, unparseable).
 */

import { describe, it, expect } from 'vitest';
import { safeHref } from '../src/renderer/modules/socmint/safe-href';

describe('safeHref — allowed schemes', () => {
  it('returns the href for an http URL', () => {
    const result = safeHref('http://example.com/path');
    expect(result).toBe('http://example.com/path');
  });

  it('returns the href for an https URL', () => {
    const result = safeHref('https://t.me/channel/42');
    expect(result).toBe('https://t.me/channel/42');
  });

  it('returns the href for an https URL with query and hash', () => {
    const result = safeHref('https://example.com/page?q=1#anchor');
    expect(result).not.toBeNull();
    expect(result).toContain('example.com');
  });
});

describe('safeHref — blocked schemes and malformed inputs', () => {
  it('returns null for javascript: URL', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
  });

  it('returns null for data: URL', () => {
    expect(safeHref('data:text/html,x')).toBeNull();
  });

  it('returns null for vbscript: URL', () => {
    expect(safeHref('vbscript:x')).toBeNull();
  });

  it('returns null for file: URL', () => {
    expect(safeHref('file:///etc/passwd')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(safeHref('')).toBeNull();
  });

  it('returns null for a non-URL string', () => {
    expect(safeHref('not a url')).toBeNull();
  });

  it('returns null for an http URL carrying userinfo (host-spoofing guard)', () => {
    expect(safeHref('http://display@evil.example/')).toBeNull();
    expect(safeHref('https://user:pass@evil.example/path')).toBeNull();
  });
});
