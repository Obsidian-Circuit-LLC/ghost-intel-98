/**
 * GhostScrape Task 7: renderer export tests (pure).
 *
 * toCsv neutralizes spreadsheet formula injection (=, +, -, @ lead chars) and
 * doubles quotes (mirrors src/renderer/modules/searchlight/report-gen.ts
 * generateCSV); toJson/toTxt round-trip a scraped result.
 */

import { describe, it, expect } from 'vitest';
import { toJson, toTxt, toCsv } from '../src/renderer/modules/ghostscrape/export';
import type { GhostScrapeResult } from '@shared/ipc-contracts';

const RESULT: GhostScrapeResult = {
  profile: {
    handle: 'ghostexodus',
    displayName: 'Ghost Exodus',
    bio: 'testing bio',
    followers: 100,
    following: 10,
    joined: '2020-01-01'
  },
  tweets: [
    {
      id: '1',
      text: '=SUM(A1:A9) malicious formula',
      createdAt: '2026-01-01T00:00:00.000Z',
      isRetweet: false,
      likeCount: 3,
      retweetCount: 1,
      replyCount: 0,
      url: 'https://x.com/ghostexodus/status/1'
    },
    {
      id: '2',
      text: 'a "quoted" normal tweet',
      createdAt: '2026-01-02T00:00:00.000Z',
      isRetweet: true,
      likeCount: 0,
      retweetCount: 0,
      replyCount: 2,
      url: 'https://x.com/ghostexodus/status/2'
    }
  ],
  partial: false,
  captured: 2
};

describe('toJson', () => {
  it('round-trips the full result', () => {
    const parsed = JSON.parse(toJson(RESULT));
    expect(parsed).toEqual(RESULT);
  });
});

describe('toTxt', () => {
  it('includes profile summary and every tweet text', () => {
    const txt = toTxt(RESULT);
    expect(txt).toContain('ghostexodus');
    expect(txt).toContain('SUM(A1:A9)');
    expect(txt).toContain('quoted');
    expect(txt).toContain('Captured: 2');
  });

  it('marks partial results honestly', () => {
    const txt = toTxt({ ...RESULT, partial: true });
    expect(txt.toLowerCase()).toContain('partial');
  });
});

describe('toCsv', () => {
  it('neutralizes a tweet text starting with = (formula injection)', () => {
    const csv = toCsv(RESULT);
    const lines = csv.split('\n');
    // header + 2 rows
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("\"'=SUM(A1:A9) malicious formula\"");
  });

  it('doubles internal quotes per RFC 4180', () => {
    const csv = toCsv(RESULT);
    expect(csv).toContain('""quoted""');
  });

  it('neutralizes +, -, and @ leading characters too', () => {
    const plusResult: GhostScrapeResult = {
      tweets: [
        { id: 'p', text: '+1 injection', createdAt: 'x', isRetweet: false, likeCount: 0, retweetCount: 0, replyCount: 0, url: 'u' },
        { id: 'm', text: '-2 injection', createdAt: 'x', isRetweet: false, likeCount: 0, retweetCount: 0, replyCount: 0, url: 'u' },
        { id: 'at', text: '@cmd injection', createdAt: 'x', isRetweet: false, likeCount: 0, retweetCount: 0, replyCount: 0, url: 'u' }
      ],
      partial: false,
      captured: 3
    };
    const csv = toCsv(plusResult);
    expect(csv).toContain("\"'+1 injection\"");
    expect(csv).toContain("\"'-2 injection\"");
    expect(csv).toContain("\"'@cmd injection\"");
  });

  it('never throws on an empty tweet list', () => {
    expect(() => toCsv({ tweets: [], partial: false, captured: 0 })).not.toThrow();
  });
});
