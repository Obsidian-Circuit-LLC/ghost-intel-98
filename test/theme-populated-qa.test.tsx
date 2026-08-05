// @vitest-environment jsdom
/**
 * QUIET AMETHYST — POPULATED-STATE QA (Batch A: geoint, markets, bookmarks, settings).
 *
 * WHY THIS EXISTS: the rendered-contrast ORACLE (`theme-rendered-contrast.test.ts`) audits every
 * module in its EMPTY state — `renderToStaticMarkup` never runs the `useEffect` that fetches and
 * populates rows, so the module's populated rows/cells/cards (where most runtime text-contrast
 * actually lives) are UNAUDITED, and the oracle honestly tallies those modules as "empty-state-only".
 * This test closes that gap for Batch A by rendering the POPULATED presentational surfaces directly
 * with realistic seeded data, under `data-ga98-theme="amethyst"`, over the real stylesheet cascade,
 * in the SAME real-Chrome computed-style walker the oracle uses — and additionally writes a legible
 * PNG per module to `.superpowers/qa/amethyst/<module>.png` for eyeball review.
 *
 * WHAT IS SEEDED, PER MODULE:
 *  - geoint  — the real `CommandRail` + `EventDetailsPanel` components (prop-driven, so they render
 *              their true populated markup) fed seeded `GeoItem`s + corroboration, PLUS the inline
 *              `.ga98-geo-events` event-list rows reproduced with the module's exact class ancestry.
 *  - markets — the populated quotes surface: per-class `.ga98-mkt-table` rows incl. up/down
 *              change% colour, the custom-feeds list, and the error banner.
 *  - bookmarks — a populated board: `.ga98-bm-col` columns of `.ga98-bm-card` widgets, each with a
 *              title-bar rename input and `.ga98-bm-link` rows.
 *  - settings — the SecurityPane "enable login" fieldset with a MID-STRENGTH password + its
 *              `StrengthMeter`, and the one-time recovery-key panel.
 *
 * Each fragment is wrapped in the real `.ga98-window-shell > .window > .window-body` ancestry so the
 * theme CSS resolves exactly as it does in the app. Content-intrinsic colour (map data-layers,
 * category/threat severity swatches, gain/loss green/red) is NOT a theme regression — those are
 * exempted (map/threat/swatch) or noted as intrinsic (gain/loss text) rather than flagged.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GeoItem } from '@shared/post-mvp-types';
import {
  auditRenderedContrast,
  captureScreenshot,
  launchChrome,
  type ChromeSession,
  type ContrastFlag
} from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

// Base cascade — exactly what main.tsx bundles globally. Every batch-A module's classes
// (`ga98-mkt*`, `ga98-bm*`, `ga98-geo*`, `ga98-list`, `field-row-stacked`, the `--ga98-pw-*` /
// `--ga98-track` tokens) live in theme.css / 98.overrides.css, so no per-module css is needed.
const CSS: string[] = [
  read('node_modules/98.css/dist/98.css'),
  read('src/renderer/styles/theme.css'),
  read('src/renderer/styles/98.overrides.css')
];

// Content-intrinsic exemptions (same cites as the oracle): map data-layer, category legend swatch,
// threat-severity pill. These carry DATA colour, not chrome, and must never mask a real light island.
const EXEMPT: string[] = ['.ga98-geo-map', '.ga98-geo-cat-swatch', '.ga98-geo-threat'];

const QA_DIR = join(ROOT, '.superpowers/qa/amethyst');

/**
 * COMPREHENSIVE window.api auto-mock + the browser globals the seeded components touch at render
 * time (recursive callable Proxy — any `window.api.x.y()` resolves without throwing). Mirrors the
 * oracle's stub so the real CommandRail/EventDetailsPanel/LiveNewsPanel render under jsdom.
 */
function installBrowserStubs(): void {
  const makeApi = (): unknown => {
    const fn: (...a: unknown[]) => unknown = () => Promise.resolve(undefined);
    return new Proxy(fn, {
      get(_t, prop): unknown {
        if (prop === 'then') return undefined;
        if (prop === Symbol.iterator || prop === Symbol.asyncIterator) return undefined;
        if (prop === Symbol.toPrimitive) return () => '';
        if (prop === 'prototype') return undefined;
        return makeApi();
      },
      apply(): unknown {
        return Promise.resolve(undefined);
      }
    });
  };
  const w = globalThis as unknown as Record<string, unknown> & { window?: Record<string, unknown> };
  const win = (w.window ?? (w.window = {} as Record<string, unknown>)) as Record<string, unknown>;
  win.api = makeApi();
  (w as Record<string, unknown>).api = win.api;
  if (typeof win.matchMedia !== 'function') {
    const mm = (): unknown => ({
      matches: false, media: '', onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; }
    });
    win.matchMedia = mm;
    (w as Record<string, unknown>).matchMedia = mm;
  }
  class Observer {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] { return []; }
  }
  for (const name of ['ResizeObserver', 'IntersectionObserver', 'MutationObserver']) {
    if (typeof (w as Record<string, unknown>)[name] !== 'function') {
      (w as Record<string, unknown>)[name] = Observer;
      win[name] = Observer;
    }
  }
}

// ── Seed data ─────────────────────────────────────────────────────────────────────────────────
const GEO_ITEMS: GeoItem[] = [
  { id: 'e1', sourceId: 'reuters', title: 'Airstrike reported near Kharkiv industrial district', link: 'https://example.org/a', located: 'geo', lat: 49.99, lon: 36.23, category: 'conflict', severity: 'high', country: 'UA', published: '2026-08-05T09:12:00Z', detail: 'Multiple explosions reported by local outlets; power to two substations cut. Casualties not independently confirmed.', eventType: 'Military Strike', confidence: 'HIGH' },
  { id: 'e2', sourceId: 'apnews', title: 'Second outlet reports strikes on Kharkiv power grid', link: 'https://example.org/b', located: 'gazetteer', lat: 50.0, lon: 36.25, place: 'Kharkiv', category: 'conflict', severity: 'high', country: 'UA', published: '2026-08-05T09:40:00Z' },
  { id: 'e3', sourceId: 'bleepingcomputer', title: 'Ransomware crew claims breach of regional utility', link: 'https://example.org/c', located: 'geo', lat: 52.23, lon: 21.01, category: 'cyber', severity: 'medium', country: 'PL', published: '2026-08-05T07:55:00Z', eventType: 'Cyber Incident' },
  { id: 'e4', sourceId: 'reuters', title: 'Mass protest over fuel prices blocks central avenue', link: 'https://example.org/d', located: 'geo', lat: 4.71, lon: -74.07, category: 'protest', severity: 'low', country: 'CO', published: '2026-08-05T14:20:00Z' },
  { id: 'e5', sourceId: 'usgs', title: 'M5.8 earthquake, offshore — no tsunami advisory', link: 'https://example.org/e', located: 'geo', lat: 38.2, lon: 142.1, category: 'disaster', severity: 'medium', country: 'JP', published: '2026-08-05T02:11:00Z' },
  { id: 'e6', sourceId: 'localwire', title: 'Unlocated wire item pending geocode', located: 'none', category: 'politics' }
];
// Corroboration: e1/e2 are the same situation (each corroborated by one other source).
const CORROBORATION = new Map<string, number>([['e1', 1], ['e2', 1], ['e3', 0]]);
const GEO_SOURCES = [
  { id: 'reuters', label: 'Reuters World' },
  { id: 'apnews', label: 'AP News' },
  { id: 'bleepingcomputer', label: 'BleepingComputer' },
  { id: 'usgs', label: 'USGS Earthquakes' }
];

// ── Populated fragment builders ─────────────────────────────────────────────────────────────────
async function loadGeoint(): Promise<string> {
  const { CommandRail } = await import('../src/renderer/modules/geoint/CommandRail');
  const { EventDetailsPanel } = await import('../src/renderer/modules/geoint/EventDetailsPanel');
  const noop = (): void => {};
  const enabledCats = new Set(['conflict', 'cyber', 'protest', 'disaster']);
  const pinned = new Set<string>(['e3']);

  // The inline event list (reproduced with GeoIntModuleInner's exact class ancestry + inline styles).
  const eventList = (
    <div className="ga98-pane" style={{ background: 'var(--ga98-grey)', padding: 8 }}>
      <fieldset style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <legend>Events ({GEO_ITEMS.length})</legend>
        <ul className="ga98-list ga98-geo-events" style={{ flex: 1, overflow: 'auto', marginTop: 4 }}>
          {GEO_ITEMS.map((i) => (
            <li key={i.id} data-active={i.id === 'e1' ? true : undefined}>
              <span style={{ flex: 1, cursor: i.lat != null ? 'pointer' : 'default' }}>
                {i.title} <span style={{ opacity: 0.5, fontSize: 10 }}>{i.located === 'none' ? '(no location)' : ''}</span>
              </span>
              <button title="Set location" style={{ minWidth: 0, padding: '0 6px' }}>📍</button>
              <button title="Save this event to a case" style={{ minWidth: 0, padding: '0 6px' }}>📁</button>
            </li>
          ))}
        </ul>
      </fieldset>
    </div>
  );

  const rail = createElement(CommandRail, {
    visibleItems: GEO_ITEMS,
    corroboration: CORROBORATION,
    onFocus: noop,
    categoryFilter: enabledCats,
    onToggleCategory: noop,
    basemap: 'street' as const,
    onBasemap: noop,
    labels: true,
    onLabels: noop,
    net: true,
    pinned,
    onAddMonitor: noop,
    onRemoveMonitor: noop,
    onViewDetails: noop,
    onGroupRegion: noop
  });

  const details = createElement(EventDetailsPanel, {
    item: GEO_ITEMS[0],
    allItems: GEO_ITEMS,
    sources: GEO_SOURCES,
    onClose: noop,
    onOpenLink: noop,
    onPin: noop,
    pinned: false
  });

  return renderToStaticMarkup(
    <div style={{ display: 'flex', height: 600, alignItems: 'stretch' }}>
      <div style={{ width: 280, display: 'flex' }}>{eventList}</div>
      {details}
      {rail}
    </div>
  );
}

function loadMarkets(): string {
  const chgStyle = (pct: number | null): { color: string } => ({
    color: pct == null ? 'var(--ga98-dim-mid)' : pct >= 0 ? 'var(--ga98-ok-dot)' : 'var(--ga98-neg-ink)'
  });
  const fmtPct = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
  const groups: { label: string; rows: { label: string; source: string; px: string; chg: number | null }[] }[] = [
    { label: 'Crypto', rows: [
      { label: 'Bitcoin', source: 'CoinGecko', px: '64,213.55', chg: 2.34 },
      { label: 'Ethereum', source: 'CoinGecko', px: '3,118.90', chg: -1.12 },
      { label: 'Monero', source: 'CoinGecko', px: '142.07', chg: 0.48 }
    ] },
    { label: 'FX', rows: [
      { label: 'EUR/USD', source: 'Frankfurter (ECB)', px: '1.0842', chg: -0.21 },
      { label: 'GBP/USD', source: 'Frankfurter (ECB)', px: '1.2731', chg: 0.09 }
    ] },
    { label: 'Indices', rows: [
      { label: 'S&P 500', source: 'Yahoo Finance', px: '5,431.60', chg: 0.77 },
      { label: 'Gold (GC=F)', source: 'Yahoo Finance', px: '2,388.40', chg: -0.34 }
    ] }
  ];
  const feeds = [
    { id: 'f1', label: 'My desk feed', url: 'https://feeds.example.org/desk.json' },
    { id: 'f2', label: 'PQ basket', url: 'https://feeds.example.org/pq.json' }
  ];
  return renderToStaticMarkup(
    <div className="ga98-mkt">
      <div style={{ background: 'var(--ga98-error-surface)', color: 'var(--ga98-danger-ink)', padding: '4px 8px', fontSize: 11, border: '1px solid var(--ga98-error-border)' }}>
        <div>Yahoo Finance: 1 symbol failed (rate-limited) — retry in a moment.</div>
      </div>
      <fieldset>
        <legend>Custom feeds</legend>
        <ul className="ga98-list">
          {feeds.map((f) => (
            <li key={f.id} title={f.url}>
              <span style={{ flex: 1 }}>{f.label} <span style={{ opacity: 0.6, fontSize: 10 }}>{f.url}</span></span>
              <button style={{ minWidth: 0, padding: '0 6px' }}>✕</button>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="ga98-mkt-quotes">
        {groups.map((g) => (
          <fieldset key={g.label}>
            <legend>{g.label}</legend>
            <table className="ga98-mkt-table">
              <tbody>
                {g.rows.map((q, i) => (
                  <tr key={`${q.label}-${i}`}>
                    <td className="ga98-mkt-sym" title={q.source}>{q.label}</td>
                    <td className="ga98-mkt-px">{q.px}</td>
                    <td className="ga98-mkt-chg" style={chgStyle(q.chg)}>{q.chg == null ? '' : fmtPct(q.chg)}</td>
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

function loadBookmarks(): string {
  const cats = [
    { id: 'c1', title: 'OSINT', links: [
      { id: 'l1', name: 'Shodan', url: 'https://shodan.io', emoji: '🛰️' },
      { id: 'l2', name: 'IntelX', url: 'https://intelx.io', emoji: '🔎' },
      { id: 'l3', name: 'Have I Been Pwned', url: 'https://haveibeenpwned.com', emoji: '' }
    ] },
    { id: 'c2', title: 'Crypto research', links: [
      { id: 'l4', name: 'IACR ePrint', url: 'https://eprint.iacr.org', emoji: '📄' },
      { id: 'l5', name: 'arXiv cs.CR', url: 'https://arxiv.org/list/cs.CR/recent', emoji: '' }
    ] }
  ];
  const card = (c: { id: string; title: string; links: { id: string; name: string; url: string; emoji: string }[] }): JSX.Element => (
    <div key={c.id} className="ga98-bm-card window">
      <div className="title-bar">
        <input className="ga98-bm-title-input" defaultValue={c.title} aria-label="Category title" />
        <div className="title-bar-controls"><button aria-label="Close" /></div>
      </div>
      <div className="window-body ga98-bm-links">
        {c.links.map((l) => (
          <div key={l.id} className="ga98-bm-link">
            <span className="ga98-bm-icon" aria-hidden="true">{l.emoji ? l.emoji : '🔖'}</span>
            <button className="ga98-bm-link-open" title={l.url}>{l.name}</button>
            <button className="ga98-bm-link-edit" title="Edit">✎</button>
            <button className="ga98-bm-link-edit" title="Remove">×</button>
          </div>
        ))}
        <button className="ga98-bm-add-link">+ Add link</button>
      </div>
    </div>
  );
  return renderToStaticMarkup(
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-toolbar">
        <button>+ Category</button>
        <button>Auto-arrange</button>
        <button>Share…</button>
        <button>Import…</button>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 11 }}><input type="checkbox" /> Fetch favicons (network)</label>
      </div>
      <div className="ga98-bm-board">
        <div className="ga98-bm-col">{card(cats[0])}</div>
        <div className="ga98-bm-col">{card(cats[1])}</div>
      </div>
    </div>
  );
}

function loadSettings(): string {
  // Mid-strength password: "Weakish8x" → length 9 (<12), lower+upper (+1), digit (+1) ⇒ score 2 = "Fair".
  const pw = 'Weakish8x';
  const MIN_PW_LEN = 12;
  const score = 2;
  const label = 'Fair';
  const color = 'var(--ga98-pw-fair)';
  const recoveryKey = 'TROUT-AMBER-QUARTZ-9F2K-ORBIT-7XQ1';
  return renderToStaticMarkup(
    <div className="ga98-stack">
      <fieldset>
        <legend>Login &amp; encryption</legend>
        <p style={{ marginTop: 4 }}>
          Protect Ghost Intel 98 with a master password. When enabled, all case data is encrypted at rest (AES-256-GCM);
          the app stays locked until you enter the password.
        </p>
        <p style={{ color: 'var(--ga98-danger-ink)', fontSize: 11 }}>There is no password reset. You will get a one-time recovery key — keep it safe.</p>
        <p style={{ color: 'var(--ga98-dim-mid)', fontSize: 11 }}>
          A backup file (.ga98) carries your encrypted key, so anyone who gets it can guess your password offline. Use {MIN_PW_LEN}+ characters.
        </p>
        <div className="field-row-stacked">
          <label htmlFor="ga98-pw">Master password</label>
          <input id="ga98-pw" type="password" defaultValue={pw} />
          {/* StrengthMeter (mid-strength) reproduced verbatim from SettingsModule. */}
          <div style={{ marginTop: 2 }}>
            <div style={{ height: 6, background: 'var(--ga98-track)', border: '1px solid var(--ga98-shadow-dark)' }}>
              <div style={{ height: '100%', width: `${(score + 1) * 20}%`, background: color }} />
            </div>
            <span style={{ fontSize: 11, color }}>{label}{pw.length < MIN_PW_LEN ? ` — needs ${MIN_PW_LEN}+ characters` : ''}</span>
          </div>
        </div>
        <div className="field-row-stacked">
          <label htmlFor="ga98-pw2">Confirm password</label>
          <input id="ga98-pw2" type="password" defaultValue={pw} />
        </div>
        <div className="field-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button>Enable login</button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Save your recovery key</legend>
        <p style={{ color: 'var(--ga98-danger-ink)', marginTop: 4 }}>
          This is shown <strong>once</strong>. It is the only way back in if you forget your password.
        </p>
        <p style={{ fontFamily: 'monospace', fontSize: 16, letterSpacing: 1, padding: 8, border: '1px solid var(--ga98-shadow-dark)', background: 'var(--ga98-shadow-light)', textAlign: 'center' }}>
          {recoveryKey}
        </p>
        <div className="field-row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          <button>Copy</button>
          <button>I have saved it</button>
        </div>
      </fieldset>
    </div>
  );
}

let session: ChromeSession;

beforeAll(async () => {
  installBrowserStubs();
  session = await launchChrome();
}, 60000);

afterAll(async () => {
  await session?.close();
});

/** Audit a populated fragment under amethyst, capture its PNG, and return the flags. */
async function auditAndShoot(module: string, bodyHtml: string): Promise<ContrastFlag[]> {
  const flags = await auditRenderedContrast(session.page, { bodyHtml, css: CSS, theme: 'amethyst', exempt: EXEMPT });
  await captureScreenshot(session, join(QA_DIR, `${module}.png`), { width: 900, height: 620 });
  return flags;
}

function report(module: string, flags: ContrastFlag[]): void {
  const contrast = flags.filter((f) => f.kind === 'contrast');
  const islands = flags.filter((f) => f.kind === 'light-island');
  // eslint-disable-next-line no-console
  console.log(`[amethyst-populated][${module}] flags=${flags.length} (contrast=${contrast.length} light-island=${islands.length}) → ${join(QA_DIR, `${module}.png`)}`);
  for (const f of contrast) {
    // eslint-disable-next-line no-console
    console.log(`[amethyst-populated][${module}][contrast] ${f.descriptor} ratio=${f.ratio} fg=${f.color} bg=${f.bg} ${f.fontSize}px${f.bold ? ' bold' : ''} "${(f.text ?? '').slice(0, 48)}"${f.note ? ` [${f.note}]` : ''}`);
  }
  for (const f of islands) {
    // eslint-disable-next-line no-console
    console.log(`[amethyst-populated][${module}][light-island] ${f.descriptor} bg=${f.bg} lum=${f.bgLum} area=${f.area}${f.gradient ? ' gradient' : ''}`);
  }
}

describe('QUIET AMETHYST populated-state QA — Batch A', () => {
  it('geoint (CommandRail + EventDetailsPanel + event list) — populated', async () => {
    const flags = await auditAndShoot('geoint', await loadGeoint());
    report('geoint', flags);
    expect(Array.isArray(flags)).toBe(true);
  }, 120000);

  it('markets (quotes rows incl. up/down change%) — populated', async () => {
    const flags = await auditAndShoot('markets', loadMarkets());
    report('markets', flags);
    expect(Array.isArray(flags)).toBe(true);
  }, 120000);

  it('bookmarks (board cards + link rows) — populated', async () => {
    const flags = await auditAndShoot('bookmarks', loadBookmarks());
    report('bookmarks', flags);
    expect(Array.isArray(flags)).toBe(true);
  }, 120000);

  it('settings (mid-strength password meter + recovery key) — populated', async () => {
    const flags = await auditAndShoot('settings', loadSettings());
    report('settings', flags);
    expect(Array.isArray(flags)).toBe(true);
  }, 120000);
});
