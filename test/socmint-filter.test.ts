/**
 * Task 3: Literal keyword filter — no RegExp on untrusted text.
 *
 * Invariant: matchesKeywords uses literal String.prototype.includes on
 * case-folded strings only.  A keyword that looks like a regex pattern
 * (e.g. ".*" or "a|b") must match ONLY when those exact characters appear
 * in the text — not as a regular expression.
 */
import { describe, it, expect } from 'vitest';
import { matchesKeywords, filterByKeywords } from '../src/main/socmint/filter';
import type { HarvestedItem } from '../src/shared/socmint/types';

// Minimal HarvestedItem factory — only `text` matters for filtering.
function makeItem(text: string, id = 'id-' + Math.random().toString(36).slice(2)): HarvestedItem {
  return {
    id,
    platform: 'telegram',
    authorHandle: 'user',
    authorId: '1',
    text,
    channelId: 'ch1',
    channelLabel: 'Channel 1',
    messageId: 'm1',
    publishedAt: '2026-01-01T00:00:00Z',
    harvestedAt: '2026-01-01T00:00:00Z',
    url: 'https://t.me/ch1/1',
    provenance: { collectorVersion: '1', jobId: 'j1', caseId: 'c1' },
  };
}

describe('matchesKeywords', () => {
  it('matches a keyword that appears in the text (case-sensitive baseline)', () => {
    expect(matchesKeywords('Hello World', ['world'])).toBe(true);
  });

  it('is case-insensitive — keyword in different case still matches', () => {
    expect(matchesKeywords('Hello WORLD', ['world'])).toBe(true);
    expect(matchesKeywords('hello world', ['WORLD'])).toBe(true);
    expect(matchesKeywords('HeLLo WoRLd', ['hello'])).toBe(true);
  });

  it('returns false when no keyword is present in the text', () => {
    expect(matchesKeywords('Hello World', ['foo', 'bar'])).toBe(false);
  });

  it('OR semantics — matches when ANY keyword is present', () => {
    expect(matchesKeywords('alpha bravo', ['alpha', 'zulu'])).toBe(true);
    expect(matchesKeywords('alpha bravo', ['zulu', 'bravo'])).toBe(true);
  });

  it('empty keywords array ⇒ match all (no filtering)', () => {
    expect(matchesKeywords('anything goes', [])).toBe(true);
    expect(matchesKeywords('', [])).toBe(true);
  });

  it('regex-metachar ".*" matches LITERALLY — only when those exact chars appear', () => {
    // If keywords were treated as regexes, ".*" would match everything.
    // Under literal matching it only matches texts that actually contain ".*".
    expect(matchesKeywords('no dots here', ['.*'])).toBe(false);
    expect(matchesKeywords('literal .* in text', ['.*'])).toBe(true);
  });

  it('pipe metachar "a|b" matches LITERALLY — not as alternation', () => {
    // Under regex semantics "a|b" matches any text containing 'a' or 'b'.
    // Under literal semantics it only matches when the three-char sequence "a|b" appears.
    expect(matchesKeywords('just the letter a here', ['a|b'])).toBe(false);
    expect(matchesKeywords('contains a|b literally', ['a|b'])).toBe(true);
  });

  it('caret "^start" matches LITERALLY — not as anchor', () => {
    expect(matchesKeywords('start of line without caret', ['^start'])).toBe(false);
    expect(matchesKeywords('text with ^start literally', ['^start'])).toBe(true);
  });

  it('matches unicode keywords correctly', () => {
    expect(matchesKeywords('Ведомости новости', ['новости'])).toBe(true);
    expect(matchesKeywords('Ведомости НОВОСТИ', ['новости'])).toBe(true);
    expect(matchesKeywords('中文内容', ['内容'])).toBe(true);
    expect(matchesKeywords('Arabic: مرحبا', ['مرحبا'])).toBe(true);
  });

  it('does not match a keyword that is not present', () => {
    expect(matchesKeywords('hello', ['xyz'])).toBe(false);
  });
});

describe('filterByKeywords', () => {
  it('returns only items whose text matches at least one keyword', () => {
    const items = [
      makeItem('alpha message', 'a'),
      makeItem('bravo message', 'b'),
      makeItem('charlie message', 'c'),
    ];
    const result = filterByKeywords(items, ['alpha', 'charlie']);
    expect(result.map(i => i.id)).toEqual(['a', 'c']);
  });

  it('returns all items when keywords is empty', () => {
    const items = [makeItem('foo', 'x'), makeItem('bar', 'y')];
    expect(filterByKeywords(items, [])).toHaveLength(2);
  });

  it('returns empty array when no items match', () => {
    const items = [makeItem('foo', 'x'), makeItem('bar', 'y')];
    expect(filterByKeywords(items, ['zzz'])).toHaveLength(0);
  });

  it('preserves order of matching items', () => {
    const items = [
      makeItem('keyword here', '1'),
      makeItem('nothing', '2'),
      makeItem('also keyword', '3'),
    ];
    const result = filterByKeywords(items, ['keyword']);
    expect(result.map(i => i.id)).toEqual(['1', '3']);
  });

  it('regex-metachar keyword in filter is treated literally', () => {
    const items = [
      makeItem('contains .* literally', 'a'),
      makeItem('no special chars', 'b'),
    ];
    const result = filterByKeywords(items, ['.*']);
    expect(result.map(i => i.id)).toEqual(['a']);
  });
});
