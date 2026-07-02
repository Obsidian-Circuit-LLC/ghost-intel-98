/**
 * GhostScrape Task 7: renderer scrape-request builder + gate tests (pure).
 *
 * buildScrapeRequest strips a leading '@' from the username and clamps
 * scrolls/max/delayMs to sane bounds; canScrape refuses to launch unless
 * BOTH X clearnet gate flags are open, an account + username are selected,
 * and no job is already running.
 */

import { describe, it, expect } from 'vitest';
import { buildScrapeRequest, canScrape } from '../src/renderer/modules/ghostscrape/scrape-request';

describe('buildScrapeRequest', () => {
  it('strips a leading @ from the username', () => {
    const cfg = buildScrapeRequest({ accountId: 'acct-1', username: '@GhostExodus', type: 'all' });
    expect(cfg.username).toBe('GhostExodus');
  });

  it('trims whitespace around the username', () => {
    const cfg = buildScrapeRequest({ accountId: 'acct-1', username: '  someUser  ', type: 'tweets' });
    expect(cfg.username).toBe('someUser');
  });

  it('clamps max to its ceiling', () => {
    const cfg = buildScrapeRequest({ accountId: 'acct-1', username: 'u', type: 'all', max: 999999 });
    expect(cfg.max).toBeLessThanOrEqual(5000);
    expect(Number.isFinite(cfg.max)).toBe(true);
  });

  it('clamps scrolls and delayMs to sane bounds (never zero/negative/huge)', () => {
    const cfg = buildScrapeRequest({
      accountId: 'acct-1',
      username: 'u',
      type: 'all',
      scrolls: -5,
      delayMs: -100
    });
    expect(cfg.scrolls).toBeGreaterThanOrEqual(1);
    expect(cfg.delayMs).toBeGreaterThanOrEqual(1);

    const huge = buildScrapeRequest({ accountId: 'acct-1', username: 'u', type: 'all', scrolls: 1e9, delayMs: 1e9 });
    expect(huge.scrolls).toBeLessThan(1e9);
    expect(huge.delayMs).toBeLessThan(1e9);
  });

  it('falls back to defaults for missing/non-finite numeric inputs', () => {
    const cfg = buildScrapeRequest({ accountId: 'acct-1', username: 'u', type: 'bio' });
    expect(Number.isFinite(cfg.scrolls)).toBe(true);
    expect(Number.isFinite(cfg.max)).toBe(true);
    expect(Number.isFinite(cfg.delayMs)).toBe(true);
  });

  it('omits sinceAfter/before when unset or blank', () => {
    const cfg = buildScrapeRequest({ accountId: 'acct-1', username: 'u', type: 'all', sinceAfter: '  ', before: '' });
    expect('sinceAfter' in cfg).toBe(false);
    expect('before' in cfg).toBe(false);
  });

  it('carries sinceAfter/before when set', () => {
    const cfg = buildScrapeRequest({
      accountId: 'acct-1',
      username: 'u',
      type: 'all',
      sinceAfter: '2026-01-01',
      before: '2026-06-01'
    });
    expect(cfg.sinceAfter).toBe('2026-01-01');
    expect(cfg.before).toBe('2026-06-01');
  });
});

describe('canScrape', () => {
  const base = {
    networkEnabled: true,
    clearnetAcknowledged: true,
    accountId: 'acct-1',
    username: 'someUser',
    running: false
  };

  it('true when both gate flags open, account + username set, not running', () => {
    expect(canScrape(base)).toBe(true);
  });

  it('false when networkEnabled is false', () => {
    expect(canScrape({ ...base, networkEnabled: false })).toBe(false);
  });

  it('false when clearnetAcknowledged is false', () => {
    expect(canScrape({ ...base, clearnetAcknowledged: false })).toBe(false);
  });

  it('false when no account selected', () => {
    expect(canScrape({ ...base, accountId: '' })).toBe(false);
  });

  it('false when username is blank', () => {
    expect(canScrape({ ...base, username: '   ' })).toBe(false);
  });

  it('false while a job is already running', () => {
    expect(canScrape({ ...base, running: true })).toBe(false);
  });
});
