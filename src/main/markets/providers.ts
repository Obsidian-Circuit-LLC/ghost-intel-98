/**
 * Markets — egress-gated quote fetching. Every provider response is normalized to MarketQuote
 * so the renderer is provider-agnostic. Network is reached ONLY when the IPC handler confirms
 * settings.markets.networkEnabled; fetchSnapshot re-guards nothing itself but every request goes
 * through safeFetch, which re-validates each redirect hop against the public-URL guard (SSRF /
 * cloud-metadata defense), exactly like the GeoINT feed fetcher.
 *
 * Providers (all keyless, confirmed by the operator's curl pack):
 *   crypto  → CoinGecko  /api/v3/simple/price
 *   fx      → Frankfurter (ECB) /latest
 *   symbols → Yahoo Finance /v7/finance/quote  (indices / equities / commodities)
 *   custom  → a user-trusted endpoint returning a generic quote JSON shape
 * Stooq (CSV) is the documented fallback for symbols if Yahoo's unofficial endpoint ever breaks;
 * left out of the default path to avoid mixing symbol formats — easy to wire if needed.
 */

import type { MarketClass, MarketQuote, MarketSnapshot, MarketCustomFeed } from '@shared/post-mvp-types';
import { isPublicHttpUrl, assertResolvedPublic } from '../security/validate';
import { readTextCapped, FETCH_TIMEOUT_MS } from '../net/limits';

/** SSRF-revalidating fetch: every hop must be a public http(s) URL AND resolve to a public
 *  address (DNS-blind string check alone is bypassable via *.nip.io / rebinding). Aborts after a
 *  timeout so a slow/never-ending feed can't hang the main process. Mirrors geoint/sources.ts. */
async function safeFetch(url: string, headers?: Record<string, string>, maxHops = 4): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < maxHops; hop++) {
    if (!isPublicHttpUrl(current)) throw new Error('refusing to fetch a non-public URL');
    await assertResolvedPublic(new URL(current).hostname);
    const res = await fetch(current, { redirect: 'manual', headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

function num(x: unknown): number | null {
  const n = typeof x === 'string' ? Number(x) : (x as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Classify a Yahoo-style symbol into a market class for grouping. */
function classify(sym: string): MarketClass {
  if (sym.startsWith('^')) return 'index';      // ^GSPC, ^DJI
  if (/=X$/i.test(sym)) return 'fx';            // EURUSD=X
  if (/=F$/i.test(sym)) return 'commodity';     // GC=F, CL=F
  if (/-USD$/i.test(sym)) return 'crypto';      // BTC-USD
  return 'equity';
}

async function fetchCrypto(ids: string[]): Promise<MarketQuote[]> {
  if (!ids.length) return [];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.map(encodeURIComponent).join(',')}&vs_currencies=usd&include_24hr_change=true`;
  const res = await safeFetch(url, { Accept: 'application/json' });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const j = JSON.parse(await readTextCapped(res)) as Record<string, { usd?: number; usd_24h_change?: number }>;
  return ids.filter((id) => j[id]).map((id) => ({
    symbol: id, label: id.toUpperCase(), price: num(j[id].usd),
    change: null, changePct: num(j[id].usd_24h_change), klass: 'crypto' as const, source: 'CoinGecko'
  }));
}

async function fetchFx(quotes: string[]): Promise<MarketQuote[]> {
  if (!quotes.length) return [];
  const url = `https://api.frankfurter.app/latest?from=USD&to=${quotes.map(encodeURIComponent).join(',')}`;
  const res = await safeFetch(url, { Accept: 'application/json' });
  if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
  const j = JSON.parse(await readTextCapped(res)) as { date?: string; rates?: Record<string, number> };
  const rates = j.rates ?? {};
  return Object.keys(rates).map((q) => ({
    symbol: `USD/${q}`, label: `USD/${q}`, price: num(rates[q]),
    change: null, changePct: null, klass: 'fx' as const, source: 'Frankfurter (ECB)', asOf: j.date
  }));
}

async function fetchYahoo(symbols: string[]): Promise<MarketQuote[]> {
  if (!symbols.length) return [];
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.map(encodeURIComponent).join(',')}`;
  // Yahoo's unofficial endpoint blocks non-browser UAs.
  const res = await safeFetch(url, { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const j = JSON.parse(await readTextCapped(res)) as { quoteResponse?: { result?: Array<Record<string, unknown>> } };
  const rows = j.quoteResponse?.result ?? [];
  return rows.map((r) => {
    const sym = String(r.symbol ?? '');
    return {
      symbol: sym,
      label: String(r.shortName ?? r.longName ?? sym),
      price: num(r.regularMarketPrice),
      change: num(r.regularMarketChange),
      changePct: num(r.regularMarketChangePercent),
      klass: classify(sym),
      source: 'Yahoo Finance'
    };
  });
}

/** Map a user feed's generic JSON to quotes. Accepts an array or {quotes:[...]}; reads common
 *  field aliases. Never throws on shape — unmappable rows are skipped. */
function mapCustom(json: unknown, feed: MarketCustomFeed): MarketQuote[] {
  const arr: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { quotes?: unknown[] })?.quotes) ? (json as { quotes: unknown[] }).quotes : [];
  return arr.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return [];
    const q = row as Record<string, unknown>;
    const symbol = String(q.symbol ?? q.ticker ?? q.name ?? feed.label);
    return [{
      symbol,
      label: String(q.label ?? q.name ?? symbol),
      price: num(q.price ?? q.value ?? q.last),
      change: num(q.change),
      changePct: num(q.changePct ?? q.change_pct ?? q.changePercent),
      klass: 'custom' as const,
      source: feed.label
    }];
  });
}

async function fetchCustom(feed: MarketCustomFeed): Promise<MarketQuote[]> {
  const res = await safeFetch(feed.url, { Accept: 'application/json' });
  if (!res.ok) throw new Error(`${feed.label}: HTTP ${res.status}`);
  return mapCustom(JSON.parse(await readTextCapped(res)), feed);
}

export { mapCustom, classify }; // exported for unit tests

interface MarketConfig {
  watchlist: { crypto: string[]; fx: string[]; symbols: string[] };
  customFeeds: MarketCustomFeed[];
}

/** Fetch every configured source concurrently; a failing source becomes a non-fatal error entry
 *  rather than sinking the whole snapshot. */
export async function fetchSnapshot(cfg: MarketConfig): Promise<MarketSnapshot> {
  const quotes: MarketQuote[] = [];
  const errors: string[] = [];
  const run = (label: string, p: Promise<MarketQuote[]>): Promise<void> =>
    p.then((qs) => { quotes.push(...qs); }).catch((e) => { errors.push(`${label}: ${(e as Error).message}`); });

  const tasks: Promise<void>[] = [
    run('Crypto', fetchCrypto(cfg.watchlist.crypto)),
    run('FX', fetchFx(cfg.watchlist.fx)),
    run('Symbols', fetchYahoo(cfg.watchlist.symbols)),
    ...cfg.customFeeds.map((f) => run(f.label, fetchCustom(f)))
  ];
  await Promise.all(tasks);
  return { quotes, errors, fetchedAt: new Date().toISOString() };
}
