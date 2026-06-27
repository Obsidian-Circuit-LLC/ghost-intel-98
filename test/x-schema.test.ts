/**
 * X-1: Schema extension tests.
 *
 * Verifies:
 *   - 'x' is a valid SocmintPlatform (compile-time + runtime)
 *   - isXUrl() accepts only https://x.com/* and https://twitter.com/* (no userinfo)
 *   - defaultSettings.x.networkEnabled === false
 *   - defaultSettings.x.clearnetAcknowledged === false
 *   - settings.x and settings.socmint are distinct top-level keys
 *   - Telegram remains a valid SocmintPlatform (no regression)
 */

import { describe, it, expect } from 'vitest';
import type { SocmintPlatform } from '@shared/socmint/types';
import { isXUrl } from '@shared/socmint/types';
import { defaultSettings } from '@shared/types';

// ---------------------------------------------------------------------------
// SocmintPlatform union extension
// ---------------------------------------------------------------------------

describe('SocmintPlatform', () => {
  it("'x' is a valid SocmintPlatform (no cast required)", () => {
    // Compile-time: the assignment would fail if 'x' were not in the union.
    const platform: SocmintPlatform = 'x';
    expect(platform).toBe('x');
  });

  it("'telegram' remains a valid SocmintPlatform (no regression)", () => {
    const platform: SocmintPlatform = 'telegram';
    expect(platform).toBe('telegram');
  });

  it("'whatsapp' remains a valid SocmintPlatform (no regression)", () => {
    const platform: SocmintPlatform = 'whatsapp';
    expect(platform).toBe('whatsapp');
  });
});

// ---------------------------------------------------------------------------
// isXUrl — X/Twitter permalink scheme-guard
// ---------------------------------------------------------------------------

describe('isXUrl — valid X permalink URLs', () => {
  it('accepts https://x.com/username/status/123', () => {
    expect(isXUrl('https://x.com/username/status/123')).toBe(true);
  });

  it('accepts https://x.com/ (bare root)', () => {
    expect(isXUrl('https://x.com/')).toBe(true);
  });

  it('accepts https://twitter.com/username/status/456', () => {
    expect(isXUrl('https://twitter.com/username/status/456')).toBe(true);
  });

  it('accepts https://twitter.com/ (bare root)', () => {
    expect(isXUrl('https://twitter.com/')).toBe(true);
  });
});

describe('isXUrl — rejects invalid or off-platform URLs', () => {
  it('rejects http:// (non-https)', () => {
    expect(isXUrl('http://x.com/foo')).toBe(false);
  });

  it('rejects javascript: scheme', () => {
    expect(isXUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects data: URI', () => {
    expect(isXUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects file: scheme', () => {
    expect(isXUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects an unrelated HTTPS host', () => {
    expect(isXUrl('https://evil.com/x.com/status/123')).toBe(false);
  });

  it('rejects a Telegram URL', () => {
    expect(isXUrl('https://t.me/channel')).toBe(false);
  });

  it('rejects a URL with userinfo (host-spoof guard)', () => {
    expect(isXUrl('https://attacker@x.com/status/1')).toBe(false);
  });

  it('rejects a URL with userinfo:password (host-spoof guard)', () => {
    expect(isXUrl('https://user:pass@twitter.com/status/1')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isXUrl('')).toBe(false);
  });

  it('rejects a malformed string', () => {
    expect(isXUrl('not a url at all')).toBe(false);
  });

  it('rejects a subdomain of x.com (e.g. evil.x.com)', () => {
    expect(isXUrl('https://evil.x.com/status/1')).toBe(false);
  });

  it('rejects a subdomain of twitter.com (e.g. api.twitter.com)', () => {
    expect(isXUrl('https://api.twitter.com/status/1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// settings.x defaults — both flags off by default
// ---------------------------------------------------------------------------

describe('defaultSettings.x', () => {
  it('x.networkEnabled is false by default', () => {
    expect(defaultSettings.x.networkEnabled).toBe(false);
  });

  it('x.clearnetAcknowledged is false by default', () => {
    expect(defaultSettings.x.clearnetAcknowledged).toBe(false);
  });

  it('settings.x and settings.socmint are distinct top-level keys', () => {
    // Structural identity check: x and socmint must not be the same object reference
    // and must carry different field shapes.
    expect(defaultSettings.x).not.toBe(defaultSettings.socmint);
    expect(Object.keys(defaultSettings.x).sort()).not.toEqual(
      Object.keys(defaultSettings.socmint).sort(),
    );
  });

  it('settings.socmint is still present with correct defaults (no regression)', () => {
    expect(defaultSettings.socmint.networkEnabled).toBe(false);
    expect(defaultSettings.socmint.transport).toBe('direct');
  });
});
