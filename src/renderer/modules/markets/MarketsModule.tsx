/**
 * Markets — an offline-first market overview. All quotes are fetched in the main process behind
 * the settings.markets.networkEnabled egress gate (off by default): with it off, nothing is
 * fetched. Built-in providers are keyless — CoinGecko (crypto), Frankfurter/ECB (FX), Yahoo
 * Finance (indices/equities/commodities) — and the user can add their own custom feeds and edit
 * the watchlist freely. Quotes are normalized to MarketQuote so the table is provider-agnostic.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketSnapshot, MarketClass } from '@shared/post-mvp-types';
import { useSettings } from '../../state/store';
import { toast } from '../../state/toasts';

const CLASS_LABEL: Record<MarketClass, string> = {
  crypto: 'Crypto', fx: 'FX', index: 'Indices', equity: 'Equities', commodity: 'Commodities', custom: 'Custom feeds'
};
const CLASS_ORDER: MarketClass[] = ['crypto', 'fx', 'index', 'equity', 'commodity', 'custom'];

function uid(): string { return crypto.randomUUID(); }
function parseList(s: string): string[] { return s.split(',').map((x) => x.trim()).filter(Boolean); }
function fmtNum(n: number | null): string { return n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 6 }); }
function fmtPct(n: number | null): string { return n == null ? '' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }

export function MarketsModule(): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const patch = useSettings((s) => s.patch);
  const net = settings?.markets?.networkEnabled ?? false;
  const watchlist = settings?.markets?.watchlist ?? { crypto: [], fx: [], symbols: [] };
  const customFeeds = settings?.markets?.customFeeds ?? [];

  const [snap, setSnap] = useState<MarketSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [cryptoText, setCryptoText] = useState('');
  const [fxText, setFxText] = useState('');
  const [symText, setSymText] = useState('');
  const [feedLabel, setFeedLabel] = useState('');
  const [feedUrl, setFeedUrl] = useState('');

  // Seed the editable watchlist fields from persisted settings (joined back to comma lists).
  const persistedKey = `${watchlist.crypto.join(',')}|${watchlist.fx.join(',')}|${watchlist.symbols.join(',')}`;
  useEffect(() => {
    setCryptoText(watchlist.crypto.join(', '));
    setFxText(watchlist.fx.join(', '));
    setSymText(watchlist.symbols.join(', '));
  }, [persistedKey]);

  // patch shallow-replaces the whole markets block, so carry every field and apply the delta.
  const patchMarkets = useCallback((p: Partial<{ networkEnabled: boolean; watchlist: { crypto: string[]; fx: string[]; symbols: string[] }; customFeeds: { id: string; label: string; url: string }[] }>) => {
    void patch({ markets: { networkEnabled: net, watchlist, customFeeds, ...p } });
  }, [patch, net, watchlist, customFeeds]);

  const refresh = useCallback(async () => {
    if (!net) { toast.warn('Markets network is off — enable it to fetch quotes.'); return; }
    setBusy(true);
    try { setSnap(await window.api.markets.fetch()); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }, [net]);

  // Fetch on enable; auto-refresh every 60s while enabled (off ⇒ no timer, no egress).
  useEffect(() => { if (net) void refresh(); }, [net, refresh]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!net) return;
    const id = setInterval(() => { void refreshRef.current(); }, 60_000);
    return () => clearInterval(id);
  }, [net]);

  function saveWatchlist(): void {
    patchMarkets({ watchlist: { crypto: parseList(cryptoText), fx: parseList(fxText), symbols: parseList(symText) } });
    toast.success('Watchlist saved.');
  }
  function addFeed(): void {
    const label = feedLabel.trim();
    const url = feedUrl.trim();
    if (!label || !/^https?:\/\//i.test(url)) { toast.warn('Enter a label and an http(s) feed URL.'); return; }
    patchMarkets({ customFeeds: [...customFeeds, { id: uid(), label, url }] });
    setFeedLabel(''); setFeedUrl('');
  }
  function removeFeed(id: string): void { patchMarkets({ customFeeds: customFeeds.filter((f) => f.id !== id) }); }

  const groups = CLASS_ORDER
    .map((k) => ({ k, rows: (snap?.quotes ?? []).filter((q) => q.klass === k) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="ga98-mkt">
      <fieldset>
        <legend>Network</legend>
        <div className="field-row" style={{ gap: 6, alignItems: 'center' }}>
          <button onClick={() => patchMarkets({ networkEnabled: !net })} aria-pressed={net}
            style={net ? { borderStyle: 'inset', background: '#bfe0bf', color: '#003300', fontWeight: 'bold' } : { fontWeight: 'bold' }}>
            {net ? 'Disable market data' : 'Enable market data'}
          </button>
          <span style={{ fontSize: 11, color: net ? '#060' : '#900' }}>{net ? '● on' : '○ off'}</span>
          <button onClick={() => void refresh()} disabled={!net || busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
          {snap && <span style={{ fontSize: 11, color: '#555' }}>updated {new Date(snap.fetchedAt).toLocaleTimeString()}</span>}
        </div>
        <p style={{ fontSize: 11, color: '#555', margin: '4px 0' }}>Off by default — no quote is fetched until you enable it. Free keyless sources: CoinGecko, Frankfurter (ECB), Yahoo Finance.</p>
      </fieldset>

      <fieldset>
        <legend>Watchlist</legend>
        <div className="ga98-mkt-wl">
          <label>Crypto (CoinGecko ids):</label>
          <input className="ga98-text" value={cryptoText} onChange={(e) => setCryptoText(e.target.value)} placeholder="bitcoin, ethereum, monero" />
          <label>FX (vs USD):</label>
          <input className="ga98-text" value={fxText} onChange={(e) => setFxText(e.target.value)} placeholder="EUR, GBP, JPY" />
          <label>Symbols (Yahoo):</label>
          <input className="ga98-text" value={symText} onChange={(e) => setSymText(e.target.value)} placeholder="^GSPC, AAPL, GC=F, BTC-USD" />
        </div>
        <div style={{ marginTop: 6 }}><button onClick={saveWatchlist} disabled={!net}>Save watchlist</button></div>
      </fieldset>

      <fieldset>
        <legend>Custom feeds</legend>
        <p style={{ fontSize: 11, color: '#555', margin: '2px 0' }}>Bring your own HTTPS endpoint returning <code>[{'{'}symbol, price, change?, changePct?, label?{'}'}]</code> (or <code>{'{'}quotes:[…]{'}'}</code>).</p>
        <ul className="ga98-list">
          {customFeeds.map((f) => (
            <li key={f.id} title={f.url}>
              <span style={{ flex: 1 }}>{f.label} <span style={{ opacity: 0.6, fontSize: 10 }}>{f.url}</span></span>
              <button onClick={() => removeFeed(f.id)} style={{ minWidth: 0, padding: '0 6px' }}>✕</button>
            </li>
          ))}
        </ul>
        <div className="field-row" style={{ marginTop: 4, gap: 4 }}>
          <input className="ga98-text" placeholder="Label" value={feedLabel} onChange={(e) => setFeedLabel(e.target.value)} style={{ flex: 1 }} />
          <input className="ga98-text" placeholder="https://…" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} style={{ flex: 2 }} />
          <button onClick={addFeed} disabled={!feedLabel.trim() || !feedUrl.trim()}>Add</button>
        </div>
      </fieldset>

      {snap?.errors.length ? (
        <div style={{ background: '#fee', color: '#900', padding: '4px 8px', fontSize: 11, border: '1px solid #c00' }}>
          {snap.errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      ) : null}

      <div className="ga98-mkt-quotes">
        {!net && <p style={{ color: '#555', padding: 8 }}>Market data is off. Enable it above to see live quotes.</p>}
        {net && groups.length === 0 && <p style={{ color: '#555', padding: 8 }}>{busy ? 'Fetching quotes…' : 'No quotes yet. Check your watchlist and Refresh.'}</p>}
        {groups.map((g) => (
          <fieldset key={g.k}>
            <legend>{CLASS_LABEL[g.k]}</legend>
            <table className="ga98-mkt-table">
              <tbody>
                {g.rows.map((q, i) => (
                  <tr key={`${q.symbol}-${i}`}>
                    <td className="ga98-mkt-sym" title={q.source}>{q.label}</td>
                    <td className="ga98-mkt-px">{fmtNum(q.price)}</td>
                    <td className="ga98-mkt-chg" style={{ color: q.changePct == null ? '#555' : q.changePct >= 0 ? '#060' : '#a00' }}>{fmtPct(q.changePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>
        ))}
      </div>
    </div>
  );
}
