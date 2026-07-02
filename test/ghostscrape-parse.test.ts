/**
 * GhostScrape Task 2: pure GraphQL timeline/profile parser + filters.
 *
 * Fixtures are minimal but real-shaped X GraphQL responses (see
 * test/fixtures/ghostscrape/{timeline,profile}.json), built by reading the
 * reference ZenScraper scraper's response-handling paths (instructions →
 * entries → tweet_results → legacy; UserByScreenName → user.result.legacy).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTimeline, parseProfile, applyFilters } from '../src/main/x/ghostscrape/parse';
import type { ScrapedTweet } from '../src/main/x/ghostscrape/types';

const timelineFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/ghostscrape/timeline.json'), 'utf8')
) as unknown;
const profileFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/ghostscrape/profile.json'), 'utf8')
) as unknown;

describe('parseTimeline', () => {
  it('flattens instructions -> entries -> tweet_results -> legacy into 3 tweets', () => {
    const tweets = parseTimeline([timelineFixture]);
    expect(tweets).toHaveLength(3);
    const byId = new Map(tweets.map((t) => [t.id, t]));

    const t1 = byId.get('1001');
    expect(t1).toBeDefined();
    expect(t1?.text).toBe('Hello world, this is tweet one.');
    expect(t1?.createdAt).toBe(new Date('Wed Jun 25 12:00:00 +0000 2026').toISOString());
    expect(t1?.isRetweet).toBe(false);
    expect(t1?.likeCount).toBe(5);
    expect(t1?.retweetCount).toBe(1);
    expect(t1?.replyCount).toBe(0);
    expect(t1?.url).toContain('1001');
  });

  it('detects a retweet and prefers the retweeted tweet text', () => {
    const tweets = parseTimeline([timelineFixture]);
    const rt = tweets.find((t) => t.id === '1002');
    expect(rt).toBeDefined();
    expect(rt?.isRetweet).toBe(true);
    expect(rt?.text).toBe('Original retweeted content here.');
  });

  it('collapses whitespace in an extended note_tweet body', () => {
    const tweets = parseTimeline([timelineFixture]);
    const noted = tweets.find((t) => t.id === '1003');
    expect(noted).toBeDefined();
    expect(noted?.text).toBe('Extended text tweet with extra whitespace.');
    expect(noted?.isRetweet).toBe(false);
  });

  it('ignores non-tweet entries (e.g. cursor entries)', () => {
    const tweets = parseTimeline([timelineFixture]);
    expect(tweets.every((t) => t.id !== 'cursor-token-abc')).toBe(true);
  });

  it('never throws on malformed input and returns []', () => {
    expect(parseTimeline([])).toEqual([]);
    expect(parseTimeline([null])).toEqual([]);
    expect(parseTimeline([{}])).toEqual([]);
    expect(parseTimeline([{ data: { user: { result: 'not-an-object' } } }])).toEqual([]);
    expect(parseTimeline(['garbage', 42, undefined])).toEqual([]);
  });
});

describe('parseProfile', () => {
  it('extracts handle/displayName/bio/followers/following/joined', () => {
    const profile = parseProfile(profileFixture);
    expect(profile).not.toBeNull();
    expect(profile?.handle).toBe('someuser');
    expect(profile?.displayName).toBe('Some User');
    // t.co short link is resolved to the expanded_url from entities.description.urls.
    expect(profile?.bio).toBe('Bio with a link https://example.com/real-link in it.');
    expect(profile?.followers).toBe(1234);
    expect(profile?.following).toBe(56);
  });

  it('never throws on malformed input and returns null', () => {
    expect(parseProfile(null)).toBeNull();
    expect(parseProfile({})).toBeNull();
    expect(parseProfile('garbage')).toBeNull();
    expect(parseProfile({ data: { user: { result: {} } } })).toBeNull();
  });
});

function makeTweet(overrides: Partial<ScrapedTweet>): ScrapedTweet {
  return {
    id: '1',
    text: 'a tweet',
    createdAt: '2026-06-01T00:00:00.000Z',
    isRetweet: false,
    likeCount: 0,
    retweetCount: 0,
    replyCount: 0,
    url: 'https://x.com/i/web/status/1',
    ...overrides
  };
}

describe('applyFilters', () => {
  it('drops retweets when type is "tweets"', () => {
    const tweets = [
      makeTweet({ id: '1', isRetweet: false, createdAt: '2026-06-01T00:00:00.000Z' }),
      makeTweet({ id: '2', isRetweet: true, createdAt: '2026-06-02T00:00:00.000Z' })
    ];
    const out = applyFilters(tweets, { type: 'tweets', max: 10 });
    expect(out.map((t) => t.id)).toEqual(['1']);
  });

  it('keeps only retweets when type is "retweets"', () => {
    const tweets = [
      makeTweet({ id: '1', isRetweet: false, createdAt: '2026-06-01T00:00:00.000Z' }),
      makeTweet({ id: '2', isRetweet: true, createdAt: '2026-06-02T00:00:00.000Z' })
    ];
    const out = applyFilters(tweets, { type: 'retweets', max: 10 });
    expect(out.map((t) => t.id)).toEqual(['2']);
  });

  it('drops tweets outside an ISO sinceAfter/before window', () => {
    const tweets = [
      makeTweet({ id: 'too-old', createdAt: '2026-01-01T00:00:00.000Z' }),
      makeTweet({ id: 'in-range', createdAt: '2026-06-15T00:00:00.000Z' }),
      makeTweet({ id: 'too-new', createdAt: '2026-12-01T00:00:00.000Z' })
    ];
    const out = applyFilters(tweets, {
      type: 'all',
      sinceAfter: '2026-03-01T00:00:00.000Z',
      before: '2026-09-01T00:00:00.000Z',
      max: 10
    });
    expect(out.map((t) => t.id)).toEqual(['in-range']);
  });

  it('dedupes duplicate ids, keeping one', () => {
    const tweets = [
      makeTweet({ id: 'dup', createdAt: '2026-06-01T00:00:00.000Z' }),
      makeTweet({ id: 'dup', createdAt: '2026-06-01T00:00:00.000Z' })
    ];
    const out = applyFilters(tweets, { type: 'all', max: 10 });
    expect(out).toHaveLength(1);
  });

  it('caps results at max, newest-first', () => {
    const tweets = [
      makeTweet({ id: 'a', createdAt: '2026-06-01T00:00:00.000Z' }),
      makeTweet({ id: 'b', createdAt: '2026-06-03T00:00:00.000Z' }),
      makeTweet({ id: 'c', createdAt: '2026-06-02T00:00:00.000Z' })
    ];
    const out = applyFilters(tweets, { type: 'all', max: 2 });
    expect(out.map((t) => t.id)).toEqual(['b', 'c']);
  });

  it('is deterministic: same input always produces the same order', () => {
    const tweets = [
      makeTweet({ id: 'a', createdAt: '2026-06-01T00:00:00.000Z' }),
      makeTweet({ id: 'b', createdAt: '2026-06-01T00:00:00.000Z' })
    ];
    const out1 = applyFilters(tweets, { type: 'all', max: 10 });
    const out2 = applyFilters([...tweets].reverse(), { type: 'all', max: 10 });
    expect(out1.map((t) => t.id)).toEqual(out2.map((t) => t.id));
  });
});
