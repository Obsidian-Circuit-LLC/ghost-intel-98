// @vitest-environment node
/**
 * QUIET AMETHYST — light-island readability proof for the chrome surfaces the
 * systematic sweep darkened. Each of these painted a hardcoded LIGHT background
 * (white/silver) on a MODULE/PANEL/CHROME surface: legible on the classic light
 * window, a glaring bright island on the amethyst near-black desktop. Each was
 * routed to a dark token under `[data-ga98-theme='amethyst']` with legible light
 * text, while classic keeps its original literal (byte-exact parity).
 *
 * Mounts the REAL theme.css + 98.overrides.css over headless Chrome (jsdom is
 * blind to var()/cascade — standing constraint; and the dark surface tokens
 * `--ga98-recessed-bg` / `--ga98-select-bg` live in 98.overrides.css, so both
 * sheets must be present for the cascade to match runtime) inside the
 * `.ga98-window-shell > .window > .window-body` ancestor chain, and proves for
 * the Calendar grid, the Reports Recent table + heading, and a doc-viewer text
 * body:
 *   • under amethyst the surface resolves DARK and its text resolves LIGHT,
 *   • under classic the SAME surface stays light with dark text (parity).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const THEME_CSS = read('src/renderer/styles/theme.css');
const OVERRIDES_CSS = read('src/renderer/styles/98.overrides.css');

const MARKUP =
  '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  // Calendar month grid: an in-month cell (white → dark) and its day-number text.
  '<div class="ga98-grid-calendar"><div id="cal-cell" data-today="false">12' +
  '</div><div id="cal-muted" data-muted="true">30</div></div>' +
  // Reports dashboard Recent table + heading.
  '<div class="ga98-report-dashboard"><div class="ga98-report-recent-heading" id="rec-head">Recent Reports</div>' +
  '<table class="ga98-report-recent"><thead><tr><th id="rec-th">Title</th></tr></thead>' +
  '<tbody><tr><td id="rec-td">Operation Report</td></tr></tbody></table></div>' +
  // Doc-viewer text-body wrapper (white sheet behind text/code/eml bodies).
  '<div class="ga98-docviewer-surface" id="doc-surface"><pre>plain text body</pre></div>' +
  // Calculator history drawer: a white <ul> list whose rows set NO colour (inherit --ga98-text)
  // plus an empty-state row. Under amethyst the list must go dark so the inherited light text (and
  // the dim empty text) stays legible instead of light-on-white.
  '<div class="ga98-calc-history-drawer">' +
  '<ul class="ga98-calc-hist-list" id="calc-hist"><li class="ga98-calc-hist-item" id="calc-hist-item">2 + 2 = 4</li></ul>' +
  '<ul class="ga98-calc-hist-list"><li class="ga98-calc-hist-empty" id="calc-hist-empty">No history yet</li></ul>' +
  '</div>' +
  '</div></div></div>';

const DOC =
  '<head><style>' + THEME_CSS + '</style><style>' + OVERRIDES_CSS + '</style></head><body>' +
  MARKUP + '</body>';

let session: ChromeSession;

beforeAll(async () => {
  session = await launchChrome();
  await session.page.setContent(DOC);
}, 30000);

afterAll(async () => {
  await session?.close();
});

async function setTheme(value: string | null): Promise<void> {
  await session.page.evaluate(
    value === null
      ? `delete document.documentElement.dataset.ga98Theme; true`
      : `document.documentElement.dataset.ga98Theme = '${value}'; true`,
  );
}

// Relative luminance (WCAG) of a resolved colour on `selector`'s `prop`. A fully
// transparent value (alpha 0 / no match) resolves to white here — which would
// FAIL the "dark surface" assertions rather than silently pass — so an unresolved
// var() can never masquerade as a dark background.
async function lumOf(selector: string, prop: string): Promise<number> {
  return session.page.evaluate<number>(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) throw new Error('no element matches ' + ${JSON.stringify(selector)});
       const raw = getComputedStyle(el).getPropertyValue(${JSON.stringify(prop)});
       const m = raw.match(/rgba?\\(([^)]+)\\)/);
       const p = m ? m[1].split(',').map((x) => parseFloat(x)) : [255,255,255];
       if (p[3] === 0) return 1; // transparent → treat as light so dark-surface checks fail loudly
       const a = [p[0],p[1],p[2]].map((v) => { const c = v/255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); });
       return 0.2126*a[0] + 0.7152*a[1] + 0.0722*a[2];
     })()`,
  );
}

interface Pair { classic: number; amethyst: number; }
async function acrossThemes(selector: string, prop: string): Promise<Pair> {
  await setTheme(null);
  const classic = await lumOf(selector, prop);
  await setTheme('amethyst');
  const amethyst = await lumOf(selector, prop);
  return { classic, amethyst };
}

const DARK = 0.06;   // near-black surface / dark text ceiling
const LIGHT = 0.18;  // legible light text / light surface floor

describe('AMETHYST light-island sweep — Calendar grid', () => {
  it('in-month cell: white→dark surface with light day-number text (classic stays light/dark)', async () => {
    const bg = await acrossThemes('#cal-cell', 'background-color');
    const fg = await acrossThemes('#cal-cell', 'color');
    expect(bg.classic, 'classic cell white').toBeGreaterThan(0.7);
    expect(bg.amethyst, 'amethyst cell dark').toBeLessThan(DARK);
    expect(fg.amethyst, 'amethyst day-number light').toBeGreaterThan(LIGHT);
    expect(fg.classic, 'classic day-number dark').toBeLessThan(DARK);
  });
  it('muted (out-of-month) cell: dark surface with legible dim text under amethyst', async () => {
    const bg = await acrossThemes('#cal-muted', 'background-color');
    const fg = await acrossThemes('#cal-muted', 'color');
    expect(bg.classic, 'classic muted near-white').toBeGreaterThan(0.7);
    expect(bg.amethyst, 'amethyst muted dark').toBeLessThan(0.12); // --ga98-grey #1a1822
    expect(fg.amethyst, 'amethyst muted text lighter than surface').toBeGreaterThan(bg.amethyst);
  });
});

describe('AMETHYST light-island sweep — Reports Recent table + heading', () => {
  it('heading: black→light text under amethyst (classic stays dark)', async () => {
    const fg = await acrossThemes('#rec-head', 'color');
    expect(fg.amethyst, 'amethyst heading light').toBeGreaterThan(LIGHT);
    expect(fg.classic, 'classic heading dark').toBeLessThan(DARK);
  });
  it('row cell: white→dark surface with light text under amethyst', async () => {
    const bg = await acrossThemes('#rec-td', 'background-color');
    const fg = await acrossThemes('#rec-td', 'color');
    expect(bg.classic, 'classic row white').toBeGreaterThan(0.7);
    expect(bg.amethyst, 'amethyst row dark').toBeLessThan(DARK);
    expect(fg.amethyst, 'amethyst row text light').toBeGreaterThan(LIGHT);
    expect(fg.classic, 'classic row text dark').toBeLessThan(DARK);
  });
});

describe('AMETHYST light-island sweep — doc-viewer text body', () => {
  it('surface: white→dark with light text under amethyst (classic stays a white sheet)', async () => {
    const bg = await acrossThemes('#doc-surface', 'background-color');
    const fg = await acrossThemes('#doc-surface', 'color');
    expect(bg.classic, 'classic doc surface white').toBeGreaterThan(0.7);
    expect(bg.amethyst, 'amethyst doc surface dark').toBeLessThan(DARK);
    expect(fg.amethyst, 'amethyst doc text light').toBeGreaterThan(LIGHT);
  });
});

describe('AMETHYST light-island sweep — Calculator history drawer', () => {
  it('list: white→dark surface, rows inherit light text under amethyst (classic light/dark)', async () => {
    const bg = await acrossThemes('#calc-hist', 'background-color');
    const fg = await acrossThemes('#calc-hist-item', 'color');
    expect(bg.classic, 'classic list white').toBeGreaterThan(0.7);
    expect(bg.amethyst, 'amethyst list dark').toBeLessThan(DARK); // --ga98-inset-panel #141119
    expect(fg.amethyst, 'amethyst row text light').toBeGreaterThan(LIGHT);
    expect(fg.classic, 'classic row text dark').toBeLessThan(DARK);
  });
  it('empty state: dim text stays lighter than the dark surface under amethyst', async () => {
    const bg = await acrossThemes('#calc-hist', 'background-color');
    const fg = await acrossThemes('#calc-hist-empty', 'color');
    expect(fg.amethyst, 'amethyst empty text legible on dark').toBeGreaterThan(bg.amethyst);
    expect(fg.amethyst, 'amethyst empty text reaches light floor').toBeGreaterThan(0.12);
  });
});
