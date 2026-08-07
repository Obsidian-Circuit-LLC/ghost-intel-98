/**
 * TG4 — Telegram Hunter keyword watch + dedup (pure matching, security-critical).
 *
 * Plan B ports GhostExodus's keyword-watch and cross-source dedup onto the encrypt-
 * at-rest artifact store. The honesty/security guarantees that matter here are all
 * pinnable on PURE functions — no electron, no network, no disk:
 *
 *  1. Keyword matching is LITERAL. A saved term containing regex metacharacters
 *     (`.` `*` `+` `(a+)+` …) matches as a literal substring, NEVER compiled with
 *     `new RegExp(untrustedTerm)` — so a catastrophic-backtracking term can neither
 *     hang the app (ReDoS) nor over-match (`a.c` must not match `abc`). This is the
 *     "Keyword-watch is LITERAL match (no new RegExp(untrusted))" invariant.
 *  2. The highlight IS a `new RegExp`, but built ONLY from regex-ESCAPED literal
 *     terms (the source's `highlightHtml` escape) — a flat literal alternation, so
 *     it is ReDoS-free and highlights the literal term, not a regex interpretation.
 *  3. Cross-source dedup collapses two records with the same content key to one
 *     (ported from the source `dedupe()` + `allKeywordRecords()` seen-set).
 *  4. The `keywordWatch` artifact store round-trips a rule's match options
 *     (caseSensitive / exactPhrase) so a saved watch matches the way it was defined.
 *
 * collector.ts + extract.ts are quarantine-clean: this file imports them WITHOUT
 * mocking electron, proving neither pulls in the electron graph at load.
 */
import { describe, it, expect } from 'vitest';

import {
  normalizeMessage,
  type RawMessage,
  type TgNormalizeContext,
} from '../src/main/socmint/telegram-hunter/extract';
import {
  matchesKeyword,
  matchKeywords,
  escapeKeywordRegExp,
  highlightKeyword,
  dedupKeyForItem,
  dedupItems,
  type KeywordRule,
} from '../src/main/socmint/telegram-hunter/collector';
import { makeTgHunterStore, type TgHunterStoreDeps } from '../src/main/socmint/telegram-hunter/store';

const CTX: TgNormalizeContext = {
  caseId: 'case-a',
  jobId: 'job-1',
  collectorVersion: 'telegram-hunter/1.0.0',
  harvestedAt: '2026-08-07T12:00:00.000Z',
  channelId: 'Operators Group',
  channelLabel: 'Operators Group',
};

const rawMessage = (o: Partial<RawMessage> = {}): RawMessage => ({
  chat: 'Operators Group',
  author: 'Jane Doe',
  authorUsername: '@jane_op',
  authorProfileUrl: 'https://t.me/jane_op',
  timestamp: 'Aug 7 at 11:59',
  text: 'meet at the depot re: C4 supply',
  links: [],
  avatar: '',
  eventType: '',
  messageId: 'msg-42',
  ...o,
});

const item = (o: Partial<RawMessage> = {}) => normalizeMessage(rawMessage(o), CTX);

// ---- 1. LITERAL matching — no new RegExp(untrusted), no ReDoS -----------

describe('matchesKeyword: LITERAL match (no RegExp on untrusted term)', () => {
  it('matches a plain term as a case-insensitive substring by default', () => {
    expect(matchesKeyword(item({ text: 'the C4 is ready' }), { term: 'c4' })).toBe(true);
    expect(matchesKeyword(item({ text: 'nothing here' }), { term: 'c4' })).toBe(false);
  });

  it('treats regex metacharacters LITERALLY — `a.c` must not match `abc`', () => {
    // A regex engine would match 'abc' against /a.c/. Literal .includes must NOT.
    expect(matchesKeyword(item({ text: 'abc' }), { term: 'a.c' })).toBe(false);
    expect(matchesKeyword(item({ text: 'a.c happened' }), { term: 'a.c' })).toBe(true);
  });

  it('does not ReDoS on a catastrophic-backtracking term (literal, so it returns fast)', () => {
    // If the term were compiled as a regex and run against this haystack it would hang.
    const evil = '(a+)+$';
    const hay = 'a'.repeat(40000) + '!';
    const started = Date.now();
    // literal .includes over the whole record — the term is a substring nowhere here
    expect(matchesKeyword(item({ text: hay }), { term: evil })).toBe(false);
    // and it IS found when present, still literally
    expect(matchesKeyword(item({ text: 'payload ' + evil }), { term: evil })).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('honours caseSensitive', () => {
    expect(matchesKeyword(item({ text: 'C4' }), { term: 'c4', caseSensitive: true })).toBe(false);
    expect(matchesKeyword(item({ text: 'C4' }), { term: 'C4', caseSensitive: true })).toBe(true);
  });

  it('exactPhrase:false matches when ALL words appear (each literally)', () => {
    const rec = item({ text: 'the depot near the river bank' });
    expect(matchesKeyword(rec, { term: 'depot bank', exactPhrase: false })).toBe(true);
    expect(matchesKeyword(rec, { term: 'depot ocean', exactPhrase: false })).toBe(false);
    // as an exact phrase the two words are not adjacent → no match
    expect(matchesKeyword(rec, { term: 'depot bank', exactPhrase: true })).toBe(false);
  });

  it('searches across text, author, channel label and links (the visible record)', () => {
    expect(matchesKeyword(item({ author: 'Jane Doe', text: 'x' }), { term: 'jane' })).toBe(true);
    expect(
      matchesKeyword(item({ text: 'x', links: ['https://t.me/joinchat/secret'] }), { term: 'secret' }),
    ).toBe(true);
    expect(matchesKeyword(item({ text: 'x' }), { term: 'Operators Group' })).toBe(true);
  });

  it('an empty term never matches', () => {
    expect(matchesKeyword(item({ text: 'anything' }), { term: '' })).toBe(false);
  });
});

describe('matchKeywords: records × rules → hits', () => {
  it('returns each record with the subset of rules it matched', () => {
    const recs = [item({ text: 'has C4 here' }), item({ text: 'clean', messageId: 'm2' })];
    const rules: KeywordRule[] = [{ term: 'c4' }, { term: 'depot' }];
    const out = matchKeywords(recs, rules);
    expect(out).toHaveLength(1);
    expect(out[0].hits.map((h) => h.term)).toEqual(['c4']);
  });
});

// ---- 2. regex-ESCAPED highlight (safe RegExp) --------------------------

describe('escapeKeywordRegExp + highlightKeyword', () => {
  it('escapes every regex metacharacter', () => {
    expect(escapeKeywordRegExp('a.c*+?^${}()|[]\\')).toBe('a\\.c\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });

  it('highlights the LITERAL term, not a regex interpretation', () => {
    // term 'a.c' must mark 'a.c' and must NOT mark 'abc'
    const segs = highlightKeyword('abc and a.c', [{ term: 'a.c' }]);
    const marked = segs.filter((s) => s.mark).map((s) => s.text);
    expect(marked).toEqual(['a.c']);
    // reassembling the segments reproduces the input verbatim (lossless)
    expect(segs.map((s) => s.text).join('')).toBe('abc and a.c');
  });

  it('is ReDoS-free for a catastrophic-looking term (escaped literal alternation)', () => {
    const started = Date.now();
    const segs = highlightKeyword('a'.repeat(40000), [{ term: '(a+)+$' }]);
    expect(segs.map((s) => s.text).join('')).toBe('a'.repeat(40000));
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('no terms → a single unmarked segment (verbatim)', () => {
    const segs = highlightKeyword('plain text', []);
    expect(segs).toEqual([{ text: 'plain text', mark: false }]);
  });
});

// ---- 3. cross-source dedup ---------------------------------------------

describe('dedupKeyForItem + dedupItems', () => {
  it('a duplicate item dedupes (same content key collapses to one)', () => {
    const a = item({ text: 'dup', messageId: 'x1' });
    const aDup = item({ text: 'dup', messageId: 'x1' });
    const b = item({ text: 'other', messageId: 'x2' });
    expect(dedupKeyForItem(a)).toBe(dedupKeyForItem(aDup));
    expect(dedupKeyForItem(a)).not.toBe(dedupKeyForItem(b));
    const out = dedupItems([a, aDup, b], dedupKeyForItem);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.text)).toEqual(['dup', 'other']);
  });

  it('the dedup key is content-based (chat|author|timestamp|text), case-insensitive', () => {
    const a = item({ text: 'Hello', author: 'Jane Doe' });
    const b = item({ text: 'hello', author: 'jane doe' });
    expect(dedupKeyForItem(a)).toBe(dedupKeyForItem(b));
  });
});

// ---- 4. keywordWatch store round-trips the match options ----------------

function memStore() {
  const files = new Map<string, string>();
  const deps: TgHunterStoreDeps = {
    async readFile(p) {
      const v = files.get(p);
      if (v === undefined) {
        const e = new Error('ENOENT') as NodeJS.ErrnoException;
        e.code = 'ENOENT';
        throw e;
      }
      return Buffer.from(v, 'utf8');
    },
    async writeFile(p, d) {
      files.set(p, d);
    },
    membersPath: (id) => `tg/${id}/members.json`,
    keywordWatchPath: (id) => `tg/${id}/keyword.json`,
    importsPath: (id) => `tg/${id}/imports.json`,
    dedupPath: (id) => `tg/${id}/dedup.json`,
  };
  return { store: makeTgHunterStore(deps), files };
}

describe('keywordWatch store: persists literal terms + match options', () => {
  it('round-trips caseSensitive / exactPhrase for a saved rule', async () => {
    const { store } = memStore();
    await store.keywordWatch.add('case-a', 'C4', '2026-08-07T00:00:00.000Z', {
      caseSensitive: true,
      exactPhrase: false,
    });
    const rules = await store.keywordWatch.read('case-a');
    expect(rules).toHaveLength(1);
    expect(rules[0].term).toBe('C4');
    expect(rules[0].caseSensitive).toBe(true);
    expect(rules[0].exactPhrase).toBe(false);
  });

  it('dedups a term case-insensitively regardless of options (still one rule)', async () => {
    const { store } = memStore();
    await store.keywordWatch.add('case-a', 'C4', '2026-08-07T00:00:00.000Z');
    const rules = await store.keywordWatch.add('case-a', 'c4', '2026-08-07T00:00:01.000Z', {
      caseSensitive: true,
    });
    expect(rules.map((r) => r.term)).toEqual(['C4']);
  });

  it('a saved rule matches a record exactly as its options specify', async () => {
    const { store } = memStore();
    await store.keywordWatch.add('case-a', 'C4', '2026-08-07T00:00:00.000Z', { caseSensitive: true });
    const [rule] = await store.keywordWatch.read('case-a');
    expect(matchesKeyword(item({ text: 'the c4' }), rule)).toBe(false); // lower-case, case-sensitive rule
    expect(matchesKeyword(item({ text: 'the C4' }), rule)).toBe(true);
  });
});
