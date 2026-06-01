import { describe, it, expect } from 'vitest';
import { classify, mapCustom } from '../src/main/markets/providers';

describe('markets: symbol classification', () => {
  it('maps Yahoo-style symbols to market classes', () => {
    expect(classify('^GSPC')).toBe('index');
    expect(classify('EURUSD=X')).toBe('fx');
    expect(classify('GC=F')).toBe('commodity');
    expect(classify('BTC-USD')).toBe('crypto');
    expect(classify('AAPL')).toBe('equity');
  });
});

describe('markets: custom-feed mapping', () => {
  const feed = { id: 'f1', label: 'My feed', url: 'https://example.test/q' };

  it('maps a plain array, honoring field aliases', () => {
    const rows = mapCustom(
      [{ symbol: 'X', price: 10, changePct: 1.5 }, { ticker: 'Y', last: '20', change_pct: -2 }],
      feed
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ symbol: 'X', price: 10, changePct: 1.5, klass: 'custom', source: 'My feed' });
    expect(rows[1]).toMatchObject({ symbol: 'Y', price: 20, changePct: -2 });
  });

  it('reads a {quotes:[…]} wrapper and skips non-object rows', () => {
    const rows = mapCustom({ quotes: [{ symbol: 'Z', value: 5 }, null, 42] }, feed);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: 'Z', price: 5 });
  });

  it('returns [] for unmappable json (no fabricated rows)', () => {
    expect(mapCustom({ nope: true }, feed)).toEqual([]);
    expect(mapCustom('garbage', feed)).toEqual([]);
    expect(mapCustom(null, feed)).toEqual([]);
  });

  it('never invents a numeric price — non-numeric becomes null', () => {
    const rows = mapCustom([{ symbol: 'Q', price: 'n/a' }], feed);
    expect(rows[0].price).toBeNull();
  });
});
