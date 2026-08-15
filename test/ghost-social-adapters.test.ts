/**
 * Ghost Social Media Manager — per-platform adapters + defaults (Phase 1, ported verbatim).
 * Pins that every platform resolves an adapter, an unknown key falls back to `custom`, the
 * scrape scripts are non-empty JS strings, and the platform defaults carry his exact URLs.
 */
import { describe, it, expect } from 'vitest';
import { getAdapter, getPlatformDefault, platformDefaults } from '../src/main/ghost-social/adapters';
import type { PlatformKey } from '../src/shared/ghost-social/types';

const KEYS: PlatformKey[] = ['facebook', 'messenger', 'instagram', 'tiktok', 'linkedin', 'x', 'youtube', 'bluesky', 'custom'];

describe('ghost-social adapters', () => {
  it('resolves a DOM stat reader for every platform key', () => {
    for (const k of KEYS) {
      const a = getAdapter(k);
      expect(a.key).toBe(k);
      const script = a.extractStatsScript();
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
      expect(script).toContain('followers');
    }
  });

  it('falls back to the generic custom reader for an unknown key', () => {
    const a = getAdapter('nope' as PlatformKey);
    expect(a.key).toBe('custom');
  });

  it('carries his platform defaults (URL + capabilities) and falls back to custom', () => {
    expect(getPlatformDefault('x').url).toBe('https://x.com/');
    expect(getPlatformDefault('youtube').capabilities.text).toBe(false);
    expect(getPlatformDefault('facebook').capabilities.messages).toBe(true);
    expect(getPlatformDefault('unknown-platform')).toBe(platformDefaults.custom);
  });
});
