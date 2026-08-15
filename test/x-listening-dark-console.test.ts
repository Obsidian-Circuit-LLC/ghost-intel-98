// @vitest-environment node
/**
 * X LISTENING STATION — FIXED "dark command-console" reproduction gate.
 *
 * Operator decision: the X Listening Station reproduces GhostExodus's Enterprise (CYBERVS
 * DOMINATVS) console FAITHFULLY — a FIXED dark console that does NOT follow the app's classic /
 * QUIET AMETHYST skins. So the `--ga98-xls-*` token group must resolve to his EXACT palette
 * (from his `src/styles.css`) and render IDENTICALLY under BOTH the classic (no `data-ga98-theme`)
 * and amethyst skins.
 *
 * This mounts the real module chrome (sidebar rail + brand seal + nav badge + topbar title + an
 * entity card) over the real 98.css + theme.css + x-listening.css cascade in headless Chrome (jsdom
 * cannot resolve `var()`; the standing constraint mandates the CDP colour harness) inside the real
 * `.xls-root` ancestor (the module always renders under `.xls-root`, whose scoped token remap is
 * what makes the WHOLE module dark regardless of app theme — the harness MUST carry that ancestor,
 * exactly as the window-shell lesson requires). It asserts, for every probed surface:
 *   (a) the resolved colour equals GhostExodus's EXACT value, AND
 *   (b) the classic render is byte-identical to the amethyst render (fixed console, theme-independent).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const CSS =
  read('node_modules/98.css/dist/98.css') +
  '\n' +
  read('src/renderer/styles/theme.css') +
  '\n' +
  read('src/renderer/modules/x-listening/x-listening.css');

// Real module chrome, mounted under the real `.xls-root` (+ window-shell) ancestor chain.
const DOC =
  '<head><style>' +
  CSS +
  '</style></head><body>' +
  '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  '<div class="xls-root" id="xlsroot">' +
  '  <aside class="xls-sidebar" id="sidebar">' +
  '    <div class="xls-brand"><div class="xls-seal" id="seal">CD</div></div>' +
  '    <nav class="xls-nav">' +
  '      <button class="xls-tab xls-tab-active" id="navactive"><span class="xls-nav-label">ENTITY INDEX</span>' +
  '        <b class="xls-nav-badge" id="badge">236</b></button>' +
  '      <button class="xls-tab" id="navidle"><span class="xls-nav-label">LIVE FEED</span></button>' +
  '    </nav>' +
  '  </aside>' +
  '  <div class="xls-main" id="main">' +
  '    <header class="xls-topbar"><h1 class="xls-topbar-title" id="title">ENTITY INDEX</h1></header>' +
  '    <main class="xls-body">' +
  '      <article class="xls-entity-card" id="card">' +
  '        <div class="xls-entity-heading"><div class="xls-entity-headtext">' +
  '          <span class="xls-entity-type" id="etype">mention</span><strong id="ename">@target</strong>' +
  '        </div></div>' +
  '        <b class="xls-entity-count" id="count">42 FINDINGS</b>' +
  '      </article>' +
  '    </main>' +
  '  </div>' +
  '</div>' +
  '</div></div></div>' +
  '</body>';

let session: ChromeSession;

beforeAll(async () => {
  session = await launchChrome();
  await session.page.setContent(DOC);
}, 30000);

afterAll(async () => {
  await session?.close();
});

async function setTheme(value: string | null): Promise<void> {
  if (value === null) {
    await session.page.evaluate(`delete document.documentElement.dataset.ga98Theme; true`);
  } else {
    await session.page.evaluate(`document.documentElement.dataset.ga98Theme = '${value}'; true`);
  }
}

/** Resolved computed value of `prop` for #id. */
async function css(id: string, prop: string): Promise<string> {
  return session.page.evaluate<string>(
    `getComputedStyle(document.getElementById('${id}')).getPropertyValue('${prop}')`,
  );
}

function parseRgb(s: string): [number, number, number] {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`not an rgb() string: ${s}`);
  const p = m[1].split(',').map((x) => parseFloat(x));
  return [p[0], p[1], p[2]];
}

// GhostExodus's EXACT values (his src/styles.css) for each probed solid-colour surface.
// [ id, css-property, [r,g,b] ]
const COLOUR_PROBES: Array<[string, string, [number, number, number]]> = [
  ['sidebar', 'border-right-color', [28, 57, 65]], // #1c3941 sidebar right edge
  ['seal', 'border-top-color', [35, 135, 197]], // #2387c5 brand seal ring
  ['seal', 'color', [217, 244, 255]], // #d9f4ff seal "CD" ink
  ['navidle', 'color', [135, 157, 163]], // #879da3 nav text
  ['navactive', 'color', [231, 245, 246]], // #e7f5f6 active nav ink
  ['badge', 'background-color', [23, 37, 42]], // #17252a count-badge pill fill
  ['badge', 'color', [234, 196, 94]], // #eac45e count-badge amber ink
  ['title', 'color', [240, 244, 244]], // #f0f4f4 his h1 heading (near-white)
  ['card', 'background-color', [8, 20, 25]], // #081419 entity-card ground (via .xls-root dark remap)
  ['count', 'color', [224, 183, 77]], // #e0b74d entity-card <b> count (his .entity-card > b)
  ['ename', 'color', [216, 228, 232]], // #d8e4e8 his base text (via dark remap)
];

// Surfaces painted with a GRADIENT (his body radial + sidebar/nav/action gradients): assert the
// background-image is a real gradient (not `none`) — the exact stop list is checked for identity.
const GRADIENT_PROBES: Array<[string, string]> = [
  ['xlsroot', 'background-image'], // his body radial-gradient
  ['sidebar', 'background-image'], // his sidebar linear-gradient
  ['navactive', 'background-image'], // his active-nav linear-gradient
];

describe('X Listening — fixed dark console reproduces GhostExodus EXACT palette', () => {
  it('every probed surface resolves to his exact colour, identical in classic + amethyst', async () => {
    for (const [id, prop, want] of COLOUR_PROBES) {
      await setTheme(null);
      const classic = await css(id, prop);
      await setTheme('amethyst');
      const amethyst = await css(id, prop);
      // (b) fixed console: classic byte-identical to amethyst.
      expect(classic, `#${id} ${prop}: classic must equal amethyst`).toBe(amethyst);
      // (a) equals his exact value.
      const got = parseRgb(classic);
      expect(got, `#${id} ${prop} = ${classic}, want rgb(${want.join(',')})`).toEqual(want);
    }
  });

  it('gradient surfaces are real gradients and identical in classic + amethyst', async () => {
    for (const [id, prop] of GRADIENT_PROBES) {
      await setTheme(null);
      const classic = await css(id, prop);
      await setTheme('amethyst');
      const amethyst = await css(id, prop);
      expect(classic, `#${id} ${prop} must be a gradient, got ${classic}`).toMatch(/gradient/);
      expect(classic, `#${id} ${prop}: classic must equal amethyst`).toBe(amethyst);
    }
  });
});
