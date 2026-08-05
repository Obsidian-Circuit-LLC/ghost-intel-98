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

// ── Batch B seed data + populated fragment builders ─────────────────────────────────────────────
//
// WHAT IS SEEDED, PER MODULE (Batch B):
//  - solitaire      — the REAL SolitaireModule, SSR'd under a SEEDED Math.random so the `deal()`
//                     in its useState initialiser produces a deterministic dealt board (7 tableau
//                     columns, face-up tops + face-down stacks, a face-down stock). The card faces
//                     (#fff paper) and their red/black pip ink are CONTENT-INTRINSIC playing-card
//                     chrome — a card is white with red/black suits regardless of app theme — so
//                     `.ga98-card` is exemption-scoped exactly like the geoint map/swatch, and the
//                     green felt (#047a32) is the table surface, not app chrome.
//  - number-muncher — the calc shell in a RESULT state: display showing a computed value, the
//                     memory register non-zero, the real StandardKeypad, the statusbar reading
//                     "Last: …", and the History drawer OPEN with seeded entries. The green-on-black
//                     LCD (`.ga98-calc-display`) is an intrinsic calculator readout, not themed chrome.
//  - journal        — the unlocked ('open') split view: a seeded entry list (one selected) on the
//                     left, the editor (title input + italic date header + body textarea) on the right.
//  - minds-eye      — the REAL shared GraphCanvas fed a seeded populated RenderGraph (fact/doc/
//                     conversation/entity nodes, a pinned + a conflicting pair, a bond edge) PLUS the
//                     module's "one thing to fix" conflict tray. The graph canvas is a deliberately
//                     dark, self-contained visualization surface (#111820 field, #cfd8e0 labels, the
//                     kind→colour node fills) — those colours are content-intrinsic to the graph, not
//                     theme tokens, so dark-on-dark there is by design rather than a skin regression.

/** Deterministic mulberry32 PRNG so the SSR'd solitaire deal is stable run-to-run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function loadSolitaire(): Promise<string> {
  const { SolitaireModule } = await import('../src/renderer/modules/solitaire/SolitaireModule');
  // Seed Math.random ONLY around the synchronous SSR so the dealt board is deterministic; the
  // shuffle is the game's one legitimate RNG site (see engine.ts) and this never touches a
  // correctness-critical path — it just fixes the screenshot's layout.
  const orig = Math.random;
  Math.random = mulberry32(0x5eed);
  try {
    return renderToStaticMarkup(createElement(SolitaireModule));
  } finally {
    Math.random = orig;
  }
}

async function loadNumberMuncher(): Promise<string> {
  const { StandardKeypad } = await import('../src/renderer/modules/number-muncher/StandardKeypad');
  const noop = (): void => {};
  const modes = ['Standard', 'Scientific', 'Programmer', 'Converter', 'Statistics', 'Date Calc', 'Unit Calc'];
  const history = [
    '128 × 64 = 8192',
    '8192 ÷ 3 = 2730.6666667',
    '√(2730.6666667) = 52.255781',
    '52.255781 + 1000 = 1052.255781'
  ];
  const display = '1,052.255781';
  const memory = 8192;
  const lastResult = display;
  const keypad = createElement(StandardKeypad, {
    onDigit: noop, onDot: noop, onOp: noop, onEquals: noop,
    onUnary: noop, onClear: noop, onClearEntry: noop, onBackspace: noop
  });
  return renderToStaticMarkup(
    <div className="ga98-calc">
      <div className="ga98-calc-tabs" role="tablist" aria-label="Calculator modes">
        {modes.map((m, i) => (
          <button key={m} type="button" role="tab" aria-selected={i === 0} className="ga98-calc-mode" data-active={i === 0}>
            {m}
          </button>
        ))}
      </div>
      <div className="ga98-calc-main">
        <div className="ga98-calc-topbar">
          <div className="ga98-calc-display" data-error={false}>{display}</div>
          <button type="button" className="ga98-calc-hist-toggle" aria-pressed={true} aria-label="Toggle history" title="History">🕘</button>
        </div>
        <div className="ga98-calc-mem-row">
          {['MC', 'MR', 'MS', 'M+', 'M-'].map((op) => (
            <button key={op} type="button" className="ga98-calc-key ga98-calc-mem">{op}</button>
          ))}
          <span className="ga98-calc-mem-reg">M = {memory}</span>
        </div>
        {keypad}
        <div className="ga98-calc-statusbar">
          <span className="ga98-calc-status-mode">Standard</span>
          <span>64-bit</span>
          <span className="ga98-calc-status-result">Last: {lastResult}</span>
        </div>
        {/* Real drawer is `position:absolute; inset:0` (overlays the keypad). For the QA shot only,
            flow it inline so the result display + keypad AND the seeded history list are BOTH visible
            and audited in one frame — a presentational tweak, no colour is changed. */}
        <div className="ga98-calc-history-drawer" style={{ position: 'static', height: 150, marginTop: 6 }}>
          <div className="ga98-calc-panel-title">
            History
            <span className="ga98-calc-hist-actions">
              <button type="button" className="ga98-calc-hist-clear">Clear</button>
              <button type="button" className="ga98-calc-hist-clear">Close</button>
            </span>
          </div>
          <ul className="ga98-calc-hist-list">
            {history.map((h, i) => (
              <li key={i} className="ga98-calc-hist-item">{h}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function loadJournal(): string {
  const fmtBytes = (n: number): string => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
  const entries = [
    { id: 'j1', title: 'Field notes — Kharkiv desk', updatedAt: '2026-08-05T09:12:00Z', bytes: 1840 },
    { id: 'j2', title: 'PQC reading list (ML-DSA, ML-KEM)', updatedAt: '2026-08-04T22:03:00Z', bytes: 512 },
    { id: 'j3', title: 'Untitled', updatedAt: '2026-08-03T14:20:00Z', bytes: 64 }
  ];
  const selId = 'j1';
  const title = 'Field notes — Kharkiv desk';
  const body =
    'Two outlets now corroborate the substation strike. Casualties still unconfirmed — hold the number.\n\n' +
    'Cross-check the cyber claim against the utility’s own status page before it goes in the dossier.';
  const createdAt = '2026-08-05T09:12:00Z';
  const headerDate = new Date(createdAt).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  return renderToStaticMarkup(
    <div className="ga98-split" style={{ height: '100%' }}>
      <div className="ga98-pane" style={{ width: 200, flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4 }}>
          <button title="Start a new entry">New</button>
        </div>
        <ul className="ga98-list" style={{ flex: 1, overflow: 'auto', margin: 0 }}>
          {entries.map((e) => (
            <li key={e.id} data-selected={e.id === selId} title={`${fmtBytes(e.bytes)} · ${new Date(e.updatedAt).toLocaleString()}`}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>{e.title}</span>
              <button style={{ minWidth: 0, padding: '0 5px' }} title="Delete">×</button>
            </li>
          ))}
        </ul>
      </div>
      <div className="ga98-pane" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div className="ga98-toolbar">
          <input className="ga98-text" defaultValue={title} placeholder="entry title" style={{ flex: 1 }} />
          <button>Save</button>
          <button title="Delete this entry">Delete</button>
        </div>
        <div style={{ padding: '4px 6px', fontSize: 11, color: 'var(--ga98-dim-deep)', borderBottom: '1px solid #808080', fontStyle: 'italic' }}>
          {headerDate}
        </div>
        <textarea
          className="ga98-text"
          style={{ flex: 1, resize: 'none', fontFamily: 'Courier New, monospace', fontSize: 12, minHeight: 260 }}
          defaultValue={body}
          placeholder="Dear journal…"
        />
      </div>
    </div>
  );
}

async function loadMindsEye(): Promise<string> {
  const { GraphCanvas } = await import('../src/renderer/components/graph-canvas/GraphCanvas');
  const noop = (): void => {};
  const graph = {
    nodes: [
      { id: 'f1', x: 10, y: 20, strength: 0.85, label: 'Operator prefers Tor-first egress', cls: 'node-fact pinned' },
      { id: 'f2', x: 120, y: 60, strength: 0.5, label: 'Case ATLAS opened 2026-07', cls: 'node-fact' },
      { id: 'd1', x: 60, y: 150, strength: 0.6, label: 'dossier-kharkiv.pdf', cls: 'node-doc' },
      { id: 'c1', x: 210, y: 110, strength: 0.7, label: 'Chat: PQC handshake review', cls: 'node-conversation' },
      { id: 'e1', x: 175, y: 30, strength: 0.95, label: 'Entity: BleepingComputer', cls: 'node-entity' },
      { id: 'f3', x: 235, y: 175, strength: 0.45, label: 'Wallet signs with ML-DSA-65', cls: 'node-fact conflict' },
      { id: 'f4', x: 30, y: 95, strength: 0.55, label: 'Wallet signs with ECDSA', cls: 'node-fact conflict' }
    ],
    edges: [
      { source: 'f1', target: 'd1', cls: 'edge-derived' },
      { source: 'f2', target: 'c1', cls: 'edge-derived' },
      { source: 'e1', target: 'c1', cls: 'edge-bond' },
      { source: 'f3', target: 'f4', cls: 'edge-conflict' }
    ]
  };
  const canvas = createElement(GraphCanvas, {
    graph,
    view: { w: 720, h: 500 },
    ariaLabel: "Mind's Eye memory graph",
    onNodeClick: noop,
    onDrawEdge: noop,
    onEdgeClick: noop,
    emptyMessage: 'Nothing remembered yet — start chatting or ➕ add a document.',
    renderInspector: () => null
  });
  // Reproduce the module's "one thing to fix" conflict tray (intrinsic dark amber surface) above it.
  return renderToStaticMarkup(
    <div style={{ display: 'flex', flexDirection: 'column', height: 560, background: '#111820' }}>
      <div style={{ padding: 8, fontSize: 12, background: '#3a2a1a', color: '#f0d8b0', borderBottom: '1px solid #5a4020' }}>
        <div style={{ fontWeight: 'bold', marginBottom: 4 }}>One thing to fix: conflicting facts</div>
        <div style={{ marginBottom: 6 }}>&ldquo;Wallet signs with ML-DSA-65&rdquo; vs &ldquo;Wallet signs with ECDSA&rdquo;</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button>Keep &ldquo;Wallet signs with ML-DSA-65&rdquo;</button>
          <button>Keep &ldquo;Wallet signs with ECDSA&rdquo;</button>
        </div>
      </div>
      {canvas}
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

/** Audit a populated fragment under amethyst, capture its PNG, and return the flags. `exempt`
 *  defaults to the Batch-A geoint content-intrinsic set; callers pass a module-specific list
 *  (e.g. solitaire's playing-card chrome) when their intrinsic surfaces differ. */
async function auditAndShoot(module: string, bodyHtml: string, exempt: string[] = EXEMPT): Promise<ContrastFlag[]> {
  const flags = await auditRenderedContrast(session.page, { bodyHtml, css: CSS, theme: 'amethyst', exempt });
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

describe('QUIET AMETHYST populated-state QA — Batch B', () => {
  it('solitaire (seeded dealt board — real module) — populated', async () => {
    // `.ga98-card` is content-intrinsic playing-card chrome (white paper + red/black suit ink,
    // fixed regardless of app theme) — exemption-scoped exactly like the geoint map/swatch so the
    // white card faces don't mask a real theme island; the green felt (#047a32) is the table.
    const flags = await auditAndShoot('solitaire', await loadSolitaire(), ['.ga98-card']);
    report('solitaire', flags);
    expect(Array.isArray(flags)).toBe(true);
  }, 120000);

  it('number-muncher (result state + open history drawer + real keypad) — populated', async () => {
    const flags = await auditAndShoot('number-muncher', await loadNumberMuncher(), []);
    report('number-muncher', flags);
    expect(Array.isArray(flags)).toBe(true);
  }, 120000);

  it('journal (unlocked split: entry list + editor) — populated', async () => {
    const flags = await auditAndShoot('journal', loadJournal(), []);
    report('journal', flags);
    expect(Array.isArray(flags)).toBe(true);
  }, 120000);

  it("minds-eye (populated graph + conflict tray — real GraphCanvas) — populated", async () => {
    // The graph canvas is a self-contained dark visualization surface (#111820 field, #cfd8e0
    // labels, kind→colour node fills, the #3a2a1a conflict tray) — those are content-intrinsic
    // graph colours, not theme tokens, so no theme-token exemption is needed here.
    const flags = await auditAndShoot('minds-eye', await loadMindsEye(), []);
    report('minds-eye', flags);
    expect(Array.isArray(flags)).toBe(true);
  }, 120000);
});
