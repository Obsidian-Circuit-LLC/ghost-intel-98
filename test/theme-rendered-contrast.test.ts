// @vitest-environment jsdom
/**
 * QUIET AMETHYST — RENDERED-CONTRAST ORACLE.
 *
 * The hand-written light-island / dim-text theme tests (theme-lightisland-readability,
 * theme-task9-readability, theme-longtail …) each pin a KNOWN site with bespoke markup. This
 * oracle is the driver that finds the sites we DON'T already know: it server-renders every
 * built-in module to static HTML, injects each into the real `.ga98-window-shell > .window >
 * .window-body` chain over the real stylesheet set (98.css + theme.css + 98.overrides.css + every
 * module css) in a REAL Chrome cascade+var engine under `data-ga98-theme='amethyst'`, and walks
 * every element flagging:
 *   (a) CONTRAST — visible text whose resolved colour fails WCAG against its nearest
 *       non-transparent ancestor background (< 4.5:1, or < 3:1 for >=18px / bold), and
 *   (b) LIGHT-ISLAND — any element whose resolved background luminance > 0.6 with a rendered box
 *       area above a small threshold (a bright island on the near-black amethyst desktop).
 *
 * WHY jsdom + real Chrome BOTH: the React components assume a browser at render (window/document/
 * matchMedia/stores), so they are server-rendered under jsdom with a COMPREHENSIVE window.api
 * auto-mock; the CONTRAST audit then runs in real Chrome because jsdom's getComputedStyle does not
 * resolve var()/cascade (standing constraint — the whole theme is var()-based).
 *
 * HONESTY: a module that cannot be server-rendered (throws) is NOT silently skipped — it lands on
 * an explicit COVERAGE-GAP list (key + error) that is printed and written to the inventory. The
 * exemption list is for GENUINE content-intrinsic colour only (named game boards, print paper) —
 * each entry carries a specific cite — and is asserted to stay small.
 *
 * This oracle is EXPECTED TO FAIL until the amethyst sweep greens every flagged site; that failure
 * is the driver. The full inventory is written to
 * docs/superpowers/plans/quiet-amethyst-oracle-inventory.md on every run.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditRenderedContrast,
  launchChrome,
  type ChromeSession,
  type ContrastFlag
} from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

// The real stylesheet set, in cascade order — exactly what main.tsx bundles globally, plus every
// co-located module css (each module's css is imported at that module's top level, so at runtime
// all of them are present in the single global cascade).
const CSS: string[] = [
  read('node_modules/98.css/dist/98.css'),
  read('src/renderer/styles/theme.css'),
  read('src/renderer/styles/98.overrides.css'),
  read('src/renderer/modules/searchlight/searchlight.css'),
  read('src/renderer/modules/socmint/socmint.css'),
  read('src/renderer/modules/investigation-graph/investigation.css'),
  read('src/renderer/modules/osint-toolkit/osint-toolkit.css')
];

// ── CURATED EXEMPTIONS — genuine content-intrinsic colour ONLY ────────────────────────────────
// Each entry must be a named content surface whose colour is DATA, not chrome: a game board with
// canonical colours, chart/map series, or print paper. NOT a place to silence a real light island.
// Kept deliberately tiny and asserted small below. (Empty for the inventory pass — we want the
// COMPLETE unfiltered inventory first; entries are added only with a specific cite as the sweep
// greens genuine content surfaces.)
const EXEMPT: string[] = [
  // Solitaire playing-card faces: canonical white card stock carrying red/black suit pips — this is
  // GAME-BOARD CONTENT (a named card game), not theming chrome. A white card under a dark skin is a
  // card, exactly the "named game board" the honesty rule cites. Tightly scoped to `.ga98-card`
  // (faces, backs, empty-foundation suit watermark) so it never masks a real chrome light island.
  '.ga98-card',
  // Chess board: the canonical lichess/chess.com two-tone board (#f0d9b5 light / #b58863 dark
  // squares) with white pieces (#fff) that carry a 2px black text-shadow outline making them
  // legible on the light squares (the WCAG fill-vs-bg ratio the walker computes ignores the
  // outline). This is content-intrinsic NAMED-GAME-BOARD colour, exactly the honesty-rule cite.
  // A stable class hook (`ga98-chess-board`, added in ChessModule) scopes the exemption to the
  // grid so it never masks a real chrome light island elsewhere.
  '.ga98-chess-board',
  // PDF Signer capture pad: a WYSIWYG white "paper" canvas you sign in black ink; the captured
  // strokes are composited onto the white PDF page, so the pad MUST match the output medium
  // (black-on-white). This is content-paper (the "print paper" cite), not chrome. Scoped to the
  // single `.ga98-sig-canvas` element.
  '.ga98-sig-canvas',
  // Minesweeper board: the canonical Windows Minesweeper grid — #c0c0c0 raised-bevel cells whose
  // classic per-count number palette (blue 1 / green 2 / red 3 …) is designed to read on the silver
  // cell. Darkening the cells would break that iconic content palette. This is NAMED-GAME-BOARD
  // content, exactly the chess/solitaire cite. Scoped to the grid via a stable `ga98-mine-grid`
  // hook so the (already dark) mine-counter LEDs and level chrome are still audited.
  '.ga98-mine-grid',
  // GeoINT map canvas: the MapLibre surface — a dark night-map (base #05070e) with, before tiles
  // load, a decorative sub-2px white star-field. The gradient-stop island heuristic takes the
  // brightest stop (a 1px star) and cannot weight it by its <2% coverage, so a genuinely dark map
  // reads as a light island. Real tiles are likewise map DATA (content-intrinsic per the theme
  // spec's map-data-layer cite). Scoped to `.ga98-geo-map`.
  '.ga98-geo-map',
  // GeoINT legend colour key: the category-colour swatches (conflict/cyber/protest…) are the map's
  // data legend — chart/series colour, content-intrinsic per the spec (only the protest orange
  // #e67e22 crosses the island cut). Scoped to the `ga98-geo-cat-swatch` hook on the individual
  // colour CHIPS (in GeoIntModule's Legend + CommandRail's category rows) so ONLY the data-colour
  // dot is exempt — the adjacent category-NAME text labels stay audited (never mask chrome/text).
  '.ga98-geo-cat-swatch',
  // GeoINT threat-level pill: a status-severity indicator whose FILL is the datum — a green→red step
  // scale (NONE #2c7 … SEVERE #e33) carrying near-black ink at high contrast. The colour IS the
  // message (a traffic-light severity readout), exactly the spec's "severity scale" content cite;
  // darkening it would erase the encoding. Scoped to a `ga98-geo-threat` hook on the pill only.
  '.ga98-geo-threat'
];

// A module whose static render produces fewer than this many elements has no auditable chrome — it
// is a bare loading / PIN-gate / empty-state stub (e.g. `<div>Loading…</div>`) because its real
// surface is built only after an effect-driven data load that renderToStaticMarkup never runs. Such
// a module is NOT "audited clean"; it is a module the oracle CANNOT meaningfully render, so it goes
// on the explicit COVERAGE-GAP list (honesty rule) rather than silently passing with zero flags.
// Threshold is deliberately low with a wide margin: the four known stubs render 1 element each; the
// smallest module with real chrome renders ~12, so nothing substantive is near this line.
const SUBSTANTIVE_ELEMENT_MIN = 3;

// Fix 5 (SSR coverage honesty): the element-count gate alone lets an effect-only module count as
// "audited" when renderToStaticMarkup emits only its structural SHELL — a few wrapper divs / a
// toolbar with no words — while the real, text-bearing surface never renders. A shell like that
// carries no text to contrast-check and typically no chrome light island either, so a zero-flag
// result is meaningless, not clean. We therefore require a SECOND signal: at least one element that
// actually bears rendered text. A module that clears the element count but renders ZERO text nodes
// is routed to the COVERAGE-GAP list ("shell-only") with that reason, never silently passed. This
// only strengthens the signal where the DOM makes it visible; a module whose real surface simply
// cannot be server-rendered still lands on the gap list with its render error / stub reason.
const SUBSTANTIVE_TEXT_MIN = 1;

/** Count elements in a rendered fragment that carry their own non-whitespace text node. */
function countTextBearingElements(container: Element): number {
  let n = 0;
  for (const el of Array.from(container.querySelectorAll('*'))) {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3 && (node.nodeValue ?? '').trim() !== '') {
        n += 1;
        break;
      }
    }
  }
  return n;
}

// Class-name shapes that denote a DATA container (the thing populated by a runtime fetch): a list,
// table body, result/feed/timeline surface, card/entry grid. Matched as a whole hyphen/underscore
// segment so `.searchlight-results` / `.geo-event-list` / `.socmint-feed` hit but `.blocklist-note`
// does not fire on an incidental substring.
const DATA_CONTAINER_CLASS =
  /(^|[-_])(results?|rows?|list|listing|feed|timeline|items?|entries|cards?|grid|events|matches|hits|records|table-body|tbody)([-_]|$)/i;

/**
 * COVERAGE HONESTY — detect whether a rendered fragment's SUBSTANTIVE data surface is effect-gated:
 * the module server-rendered a non-trivial empty-state SHELL, but its key data containers (lists /
 * table bodies / result grids / feeds) came back EMPTY because renderToStaticMarkup never runs the
 * effect that fetches and populates the rows. Such a module IS still audited here (its chrome +
 * empty-state IS a real, worthwhile regression surface) — but a zero-flag result on it must NOT be
 * reported as full contrast coverage, because the populated rows/cells (where most runtime text
 * contrast actually lives) never rendered. Returns a short reason naming the empty data containers,
 * or null when nothing on the surface looks data-gated (e.g. a game board or a self-contained tool).
 */
function detectEmptyDataSurface(container: Element): string | null {
  const empties = new Set<string>();
  const childless = (el: Element): boolean => el.children.length === 0;
  for (const el of Array.from(container.querySelectorAll('ul, ol'))) {
    if (el.querySelector(':scope > li') == null) empties.add(el.tagName.toLowerCase());
  }
  for (const el of Array.from(container.querySelectorAll('tbody'))) {
    if (el.querySelector(':scope > tr') == null) empties.add('tbody');
  }
  for (const el of Array.from(container.querySelectorAll('table'))) {
    if (el.querySelector('tr') == null) empties.add('table');
  }
  for (const role of ['list', 'grid', 'table', 'listbox', 'feed', 'rowgroup', 'tree']) {
    for (const el of Array.from(container.querySelectorAll(`[role="${role}"]`))) {
      if (childless(el)) empties.add(`role=${role}`);
    }
  }
  for (const el of Array.from(container.querySelectorAll('[class]'))) {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (DATA_CONTAINER_CLASS.test(cls) && childless(el)) {
      empties.add('.' + (cls.trim().split(/\s+/).find((c) => DATA_CONTAINER_CLASS.test(c)) ?? cls.trim().split(/\s+/)[0]));
    }
  }
  if (empties.size === 0) return null;
  return `empty data container(s): ${Array.from(empties).slice(0, 6).join(', ')}`;
}

interface ModuleRenderResult {
  key: string;
  title: string;
  html?: string;
  error?: string;
  /** Set when the module rendered but too shallowly to audit — routed to the coverage-gap list. */
  gap?: string;
  /**
   * Set when the module DID render an auditable empty-state shell but its data containers are empty
   * (effect-gated). The module is still audited; this flag routes it to the honest "empty-state-only
   * (data surfaces unaudited)" tally instead of overstating it as fully-covered.
   */
  dataGated?: string;
}

let session: ChromeSession;
let renderResults: ModuleRenderResult[] = [];

/**
 * Install a COMPREHENSIVE window.api auto-mock + the browser globals the module components touch at
 * render time. window.api is a recursive callable Proxy: any property access yields another
 * callable, any call returns a resolved Promise — so a module reading `window.api.x.y()` never
 * throws on access. (Data-fetching happens in useEffect, which renderToStaticMarkup never runs, so
 * the real payloads are irrelevant; the stores supply their initial empty state.)
 */
function installBrowserStubs(): void {
  const makeApi = (): unknown => {
    const fn: (...a: unknown[]) => unknown = () => Promise.resolve(undefined);
    return new Proxy(fn, {
      get(_t, prop): unknown {
        if (prop === 'then') return undefined; // never a thenable
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
      matches: false,
      media: '',
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      }
    });
    win.matchMedia = mm;
    (w as Record<string, unknown>).matchMedia = mm;
  }
  // maplibre-gl (geoint) calls `window.URL.createObjectURL(new Blob(...))` at import time to spin up
  // its worker; jsdom's URL has no object-URL support. Stub it (+ revoke) inertly.
  const urlObj = (win.URL ?? (w as Record<string, unknown>).URL) as Record<string, unknown> | undefined;
  if (urlObj && typeof urlObj.createObjectURL !== 'function') {
    urlObj.createObjectURL = () => 'blob:oracle';
    urlObj.revokeObjectURL = () => {};
  }

  // doc-viewer instantiates `new Worker(...)` at module top level (pdf.js worker port); jsdom has
  // no Worker. An inert stub keeps that static import from throwing.
  if (typeof (w as Record<string, unknown>).Worker !== 'function') {
    class WorkerStub {
      onmessage: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      constructor(_url?: unknown, _opts?: unknown) {
        void _url;
        void _opts;
      }
      postMessage(): void {}
      terminate(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    }
    (w as Record<string, unknown>).Worker = WorkerStub;
    win.Worker = WorkerStub;
  }
  class Observer {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
      return [];
    }
  }
  for (const name of ['ResizeObserver', 'IntersectionObserver', 'MutationObserver']) {
    if (typeof (w as Record<string, unknown>)[name] !== 'function') {
      (w as Record<string, unknown>)[name] = Observer;
      win[name] = Observer;
    }
  }
  // pdfjs-dist (pulled in by doc-viewer / pdf-signer at import time) constructs `new DOMMatrix()`
  // during module init — jsdom ships none, so provide inert stubs to keep the static import chain
  // from throwing and taking down the whole registry import.
  class DOMMatrixStub {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    constructor(_init?: unknown) {
      void _init;
    }
    multiply(): DOMMatrixStub {
      return this;
    }
    translate(): DOMMatrixStub {
      return this;
    }
    scale(): DOMMatrixStub {
      return this;
    }
    inverse(): DOMMatrixStub {
      return this;
    }
  }
  class DOMPointStub {
    x = 0;
    y = 0;
    z = 0;
    e = 1;
  }
  class Path2DStub {
    addPath(): void {}
    moveTo(): void {}
    lineTo(): void {}
    closePath(): void {}
  }
  for (const [name, ctor] of [
    ['DOMMatrix', DOMMatrixStub],
    ['DOMPoint', DOMPointStub],
    ['Path2D', Path2DStub]
  ] as const) {
    if (typeof (w as Record<string, unknown>)[name] !== 'function') {
      (w as Record<string, unknown>)[name] = ctor;
      win[name] = ctor;
    }
  }
  if (typeof (w as Record<string, unknown>).requestAnimationFrame !== 'function') {
    const raf = (cb: (t: number) => void): number => {
      void cb;
      return 0;
    };
    (w as Record<string, unknown>).requestAnimationFrame = raf;
    win.requestAnimationFrame = raf;
    (w as Record<string, unknown>).cancelAnimationFrame = () => {};
    win.cancelAnimationFrame = () => {};
  }
}

beforeAll(async () => {
  installBrowserStubs();

  // Enumerate the real built-in module set from the registry (the single source of truth), then
  // server-render each adapter with an empty synthetic spec — the exact prop-wiring the app uses.
  // Import AFTER the browser stubs are installed so any module-top-level browser access is safe.
  const { registerBuiltins } = await import('../src/renderer/modules/register-builtins');
  const { listModules, _resetRegistryForTest } = await import('../src/renderer/state/registry');
  _resetRegistryForTest();
  registerBuiltins();

  const modules = listModules().filter((m) => m.builtin);
  renderResults = modules.map((m) => {
    const spec = { id: `oracle-${m.key}`, module: m.key, title: m.title, props: {} };
    try {
      const html = renderToStaticMarkup(createElement(m.component, { spec }));
      // Count real elements in the fragment (jsdom is the test environment). A stub render with no
      // auditable chrome is a coverage gap, not a clean pass — see SUBSTANTIVE_ELEMENT_MIN.
      const probe = document.createElement('div');
      probe.innerHTML = html;
      const elementCount = probe.querySelectorAll('*').length;
      if (elementCount < SUBSTANTIVE_ELEMENT_MIN) {
        const stubText = (probe.textContent ?? '').trim().slice(0, 60);
        return {
          key: m.key,
          title: m.title,
          html,
          gap:
            `non-substantive static render (${elementCount} element${elementCount === 1 ? '' : 's'}` +
            `${stubText ? `: "${stubText}"` : ''}) — real surface is gated behind an effect-driven ` +
            `data/PIN load that renderToStaticMarkup does not run; not exercised by this oracle`
        };
      }
      // Fix 5: an element-rich but TEXT-LESS render is a structural shell whose real (text-bearing)
      // surface is effect-driven — a zero-flag audit of it is not evidence of clean, so it is a gap.
      const textBearing = countTextBearingElements(probe);
      if (textBearing < SUBSTANTIVE_TEXT_MIN) {
        return {
          key: m.key,
          title: m.title,
          html,
          gap:
            `shell-only static render (${elementCount} elements, ${textBearing} text-bearing) — only ` +
            `structural chrome server-rendered; the real text surface is built by an effect-driven ` +
            `data load renderToStaticMarkup never runs, so its contrast is NOT audited here`
        };
      }
      // The shell is auditable, but flag whether its substantive data surface is effect-gated so the
      // oracle reports it as "empty-state-only", not as full coverage (COVERAGE HONESTY).
      const dataGated = detectEmptyDataSurface(probe) ?? undefined;
      return { key: m.key, title: m.title, html, dataGated };
    } catch (err) {
      return { key: m.key, title: m.title, error: (err as Error)?.message ?? String(err) };
    }
  });

  session = await launchChrome();
}, 60000);

afterAll(async () => {
  await session?.close();
});

/** Audit one already-rendered module fragment under amethyst. */
async function auditModule(html: string): Promise<ContrastFlag[]> {
  return auditRenderedContrast(session.page, {
    bodyHtml: html,
    css: CSS,
    theme: 'amethyst',
    exempt: EXEMPT
  });
}

describe('QUIET AMETHYST rendered-contrast oracle', () => {
  it('renders every built-in module, audits it, and writes the full inventory', async () => {
    const perModuleFlags: { key: string; title: string; flags: ContrastFlag[]; dataGated?: string }[] = [];
    const coverageGaps: { key: string; title: string; error: string }[] = [];

    for (const r of renderResults) {
      if (r.error != null || r.html == null) {
        coverageGaps.push({ key: r.key, title: r.title, error: r.error ?? 'no html produced' });
        continue;
      }
      // A module that rendered only a stub (loading/PIN gate) is reported as a coverage gap, NOT
      // audited as clean — the oracle cannot meaningfully render its real surface (honesty rule).
      if (r.gap != null) {
        coverageGaps.push({ key: r.key, title: r.title, error: r.gap });
        continue;
      }
      const flags = await auditModule(r.html);
      perModuleFlags.push({ key: r.key, title: r.title, flags, dataGated: r.dataGated });
    }

    const audited = perModuleFlags.length;
    const totalFlags = perModuleFlags.reduce((n, m) => n + m.flags.length, 0);
    const flaggedModules = perModuleFlags.filter((m) => m.flags.length > 0);
    // COVERAGE HONESTY: split the audited set. `fullyRendered` modules exposed their real surface to
    // the walker; `emptyStateOnly` modules rendered an auditable shell but their data containers are
    // empty (effect-gated), so their populated rows/cells were NOT audited. Both are audited for
    // chrome + empty-state contrast; only the first is honestly "fully covered".
    const emptyStateOnly = perModuleFlags.filter((m) => m.dataGated);
    const fullyRendered = perModuleFlags.filter((m) => !m.dataGated);

    // ── Write the inventory artifact (always, so it tracks the live sweep). ──────────────────────
    const outPath = join(ROOT, 'docs/superpowers/plans/quiet-amethyst-oracle-inventory.md');
    const lines: string[] = [];
    lines.push('# QUIET AMETHYST — rendered-contrast oracle inventory');
    lines.push('');
    lines.push('Generated by `test/theme-rendered-contrast.test.ts` (do not hand-edit — rerun the oracle).');
    lines.push('');
    lines.push(`- modules audited: **${audited}**`);
    lines.push(`  - fully rendered (data surface present): **${fullyRendered.length}**`);
    lines.push(`  - empty-state-only (data surfaces UNAUDITED): **${emptyStateOnly.length}**`);
    lines.push(`- modules with flagged sites: **${flaggedModules.length}**`);
    lines.push(`- total flagged sites: **${totalFlags}**`);
    lines.push(`- coverage gaps (could not render an auditable surface): **${coverageGaps.length}**`);
    lines.push(`- exemptions in force: ${EXEMPT.length ? EXEMPT.map((e) => '`' + e + '`').join(', ') : '_none_'}`);
    lines.push('');
    lines.push('> **What this oracle proves — and does not.** It is a strong regression guard for the');
    lines.push('> rendered CHROME and EMPTY-STATE surface of every built-in module under QUIET AMETHYST');
    lines.push('> (real Chrome cascade + `var()` resolution, WCAG contrast, light-island + gradient +');
    lines.push('> alpha/opacity compositing). It is NOT a proof of total coverage: the empty-state-only');
    lines.push('> modules above rendered their shell but not their populated rows/cells (those are built');
    lines.push('> by effects `renderToStaticMarkup` never runs), and the walker has disclosed latent gaps');
    lines.push('> (raster background-image islands, `::before`/`::after` pseudo-element text, SSR');
    lines.push('> layout-area dependence — see `test/helpers/chrome-computed-style.ts`).');
    lines.push('');
    if (emptyStateOnly.length) {
      lines.push('## Empty-state-only modules (audited shell; data surfaces UNAUDITED)');
      lines.push('');
      for (const m of emptyStateOnly) {
        lines.push(`- **${m.key}** (${m.title}): ${m.dataGated}`);
      }
      lines.push('');
    }
    lines.push('## Flagged sites by module');
    lines.push('');
    if (flaggedModules.length === 0) {
      lines.push('_No flagged sites — the oracle is green._');
    }
    for (const m of flaggedModules) {
      lines.push(`### ${m.key} — ${m.title} (${m.flags.length})`);
      lines.push('');
      const contrast = m.flags.filter((f) => f.kind === 'contrast');
      const islands = m.flags.filter((f) => f.kind === 'light-island');
      if (contrast.length) {
        lines.push('**Contrast:**');
        lines.push('');
        for (const f of contrast) {
          lines.push(
            `- \`${f.descriptor}\` ratio **${f.ratio}** — fg \`${f.color}\` on bg \`${f.bg}\`` +
              ` (${f.fontSize}px${f.bold ? ' bold' : ''}${f.gradient ? ', gradient bg' : ''}) —` +
              ` "${(f.text ?? '').replace(/`/g, "'")}"${f.note ? ` _[${f.note}]_` : ''}`
          );
        }
        lines.push('');
      }
      if (islands.length) {
        lines.push('**Light islands:**');
        lines.push('');
        for (const f of islands) {
          lines.push(
            `- \`${f.descriptor}\`${f.gradient ? ' (gradient)' : ''} bg \`${f.bg}\`` +
              ` (lum ${f.bgLum}, area ${f.area}px²)`
          );
        }
        lines.push('');
      }
    }
    lines.push('## Coverage gaps (modules that could not be server-rendered)');
    lines.push('');
    if (coverageGaps.length === 0) {
      lines.push('_None — every built-in module server-rendered cleanly._');
    }
    for (const g of coverageGaps) {
      lines.push(`- **${g.key}** (${g.title}): ${g.error.replace(/\n/g, ' ').slice(0, 300)}`);
    }
    lines.push('');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, lines.join('\n'), 'utf8');

    // ── Console summary (visible in the vitest run). ────────────────────────────────────────────
    // eslint-disable-next-line no-console
    console.log(
      `[amethyst-oracle] audited=${audited} (fully-rendered=${fullyRendered.length} ` +
        `empty-state-only=${emptyStateOnly.length}) flaggedModules=${flaggedModules.length} ` +
        `totalFlags=${totalFlags} coverageGaps=${coverageGaps.length} → inventory at ${outPath}`
    );
    // COVERAGE HONESTY caveat — printed every run so the numbers above are never read as a claim of
    // total coverage. The oracle guards rendered chrome + empty-state surfaces; it does NOT prove the
    // contrast of data-populated rows (never server-rendered) nor the disclosed latent walker gaps.
    // eslint-disable-next-line no-console
    console.log(
      `[amethyst-oracle][caveat] STRONG REGRESSION GUARD for rendered chrome/empty-state surfaces — ` +
        `NOT a proof of total coverage: ${emptyStateOnly.length} module(s) audited in their empty-state ` +
        `shell ONLY (populated rows/cells never render under renderToStaticMarkup); latent walker gaps ` +
        `(raster background-image islands, ::before/::after text, SSR layout-area dependence) remain accepted.`
    );
    if (emptyStateOnly.length) {
      // eslint-disable-next-line no-console
      console.log(`[amethyst-oracle][empty-state-only] ${emptyStateOnly.length} module(s), data surfaces UNAUDITED:`);
      for (const m of emptyStateOnly) {
        // eslint-disable-next-line no-console
        console.log(`[amethyst-oracle][empty-state-only] ${m.key}: ${(m.dataGated ?? '').slice(0, 140)}`);
      }
    }
    // Honesty rule: PRINT the coverage-gap list every run — a module the oracle could not audit is
    // never a silent clean pass. Always emit the header (and an explicit "none") so the absence of
    // gaps is an asserted fact in the log, not an ambiguous empty section.
    // eslint-disable-next-line no-console
    console.log(`[amethyst-oracle][coverage-gaps] ${coverageGaps.length} module(s) not audited:`);
    if (coverageGaps.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[amethyst-oracle][coverage-gap] (none — every built-in module rendered an auditable surface)');
    }
    for (const g of coverageGaps) {
      // eslint-disable-next-line no-console
      console.log(`[amethyst-oracle][coverage-gap] ${g.key}: ${g.error.slice(0, 160)}`);
    }

    // ── Assertions. ─────────────────────────────────────────────────────────────────────────────
    // The exemption list must stay small (content-intrinsic only).
    expect(EXEMPT.length, 'exemptions must stay small — content-intrinsic only').toBeLessThanOrEqual(8);
    // At least most modules must actually render (a mass render failure would hide the audit).
    expect(audited, 'a majority of built-in modules must server-render for the audit to be meaningful').toBeGreaterThan(
      renderResults.length / 2
    );

    // The DRIVER assertion: zero flagged sites. Expected to FAIL until the sweep greens every site.
    const summary = flaggedModules
      .map((m) => `${m.key}(${m.flags.length})`)
      .join(', ');
    expect(totalFlags, `flagged contrast/light-island sites remain: ${summary}`).toBe(0);
  }, 180000);

  // ── Regression: ANCESTOR OPACITY is folded into effective foreground alpha. ───────────────────
  // An ancestor wrapper at opacity:0.55 (the CommandRail category-row pattern) uniformly dims its
  // descendant text; the earlier walker folded only the text element's OWN opacity and missed this,
  // so dimmed-to-unreadable text passed. #999 on the #1a1822 surface clears 4.5:1 at full alpha
  // (~6.1:1) but drops to ~2.7:1 once the 0.55 ancestor opacity is applied — the walker must now
  // flag it. A sibling control at full opacity with identical colour must NOT be flagged, proving the
  // dimming (not the colour) is what the walker caught.
  it('folds ancestor opacity into effective foreground alpha (dimmed text is flagged)', async () => {
    const flags = await auditRenderedContrast(session.page, {
      css: CSS,
      theme: 'amethyst',
      exempt: [],
      bodyHtml:
        '<div style="background:#1a1822;padding:8px">' +
        '<div class="dim-wrap" style="opacity:0.55">' +
        '<span class="dimmed-text" style="color:#999999">dimmed by ancestor opacity</span>' +
        '</div>' +
        '<div class="bright-wrap" style="opacity:1">' +
        '<span class="bright-text" style="color:#999999">same colour at full opacity</span>' +
        '</div>' +
        '</div>'
    });
    const dimmed = flags.find((f) => f.kind === 'contrast' && f.descriptor.includes('dimmed-text'));
    const bright = flags.find((f) => f.kind === 'contrast' && f.descriptor.includes('bright-text'));
    expect(dimmed, 'text dimmed by an ancestor opacity:0.55 wrapper must be flagged for contrast').toBeTruthy();
    expect(dimmed?.note, 'the flag must disclose that alpha/opacity compositing drove the math').toMatch(/alpha-composited/);
    expect(bright, 'the same colour at full opacity clears the threshold and must NOT be flagged').toBeFalsy();
  }, 60000);

  // ── Regression: exemption scope is the named element + its SUBTREE, never the ancestor chain. ──
  // An exemption on a leaf (`.ga98-geo-threat`) must suppress that element (and anything inside it),
  // but must NOT suppress a low-contrast SIBLING or the enclosing wrapper — those chrome/text
  // surfaces stay audited. This locks isExempt to self-or-enclosing-match and guards against a
  // regression where a contained exemption leaks upward and silences the surface around it.
  it('scopes exemptions to the named element/subtree, not the ancestor chain', async () => {
    const bodyHtml =
      '<div class="outer-row" style="background:#1a1822;padding:8px;display:flex;gap:8px;align-items:center">' +
      // The exempt datum pill: a bright fill that WOULD be a light island, plus near-black-on-fill text.
      '<span class="ga98-geo-threat" style="background:#22cc77;color:#0a0f1a;font-size:11px;padding:1px 8px">SEVERE</span>' +
      // A genuinely low-contrast SIBLING that shares the row: must remain audited (not suppressed).
      '<span class="leak-probe" style="color:#2a2a33;font-size:11px">low-contrast sibling</span>' +
      '</div>';
    const withExempt = await auditRenderedContrast(session.page, {
      css: CSS,
      theme: 'amethyst',
      exempt: ['.ga98-geo-threat'],
      bodyHtml
    });
    // The exemption suppresses the pill's own light-island + text …
    expect(
      withExempt.some((f) => f.descriptor.includes('ga98-geo-threat')),
      'the named pill (and its subtree) must be exempt'
    ).toBe(false);
    // … but the sibling that merely shares the ancestor row is STILL flagged.
    const sibling = withExempt.find((f) => f.kind === 'contrast' && f.descriptor.includes('leak-probe'));
    expect(sibling, 'a low-contrast sibling of an exempt element must remain audited (no ancestor-chain leak)').toBeTruthy();
    // Control: with NO exemption, the pill itself surfaces a flag (proving it was genuinely suppressible).
    const noExempt = await auditRenderedContrast(session.page, { css: CSS, theme: 'amethyst', exempt: [], bodyHtml });
    expect(
      noExempt.some((f) => f.descriptor.includes('ga98-geo-threat')),
      'without the exemption the pill must produce a flag — otherwise the exemption test proves nothing'
    ).toBe(true);
  }, 60000);
});
