// @vitest-environment node
/**
 * X LISTENING STATION — command-console TYPOGRAPHY reproduction gate.
 *
 * GhostExodus's Enterprise (CYBERVS DOMINATVS) console renders its chrome — nav items, count
 * badges, the masthead heading, the eyebrow label, and the dashboard stat figures/labels — in
 * Consolas monospace (his `src/styles.css` sets the nav/labels/h1/stat font to Consolas). The
 * FIXED dark-console reproduction must carry that monospace trait, otherwise the chrome reads in
 * the app's inherited UI sans-serif and the reproduction is visually incomplete on a named
 * dimension (his frames are unmistakably monospace).
 *
 * font-family is not a palette literal (no colour token needed, no-straggler stays green), so we
 * assert it directly against the real cascade in headless Chrome (jsdom cannot resolve the
 * inherited/`inherit` font chain the way a real engine does). Every probed surface is mounted under
 * the real `.xls-root` ancestor, exactly as the dark-console gate requires.
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

// Real console chrome mounted under `.xls-root` — nav tab + badge, topbar eyebrow + title, and a
// dashboard stat tile (figure + label). The app shell around it uses a sans-serif UI font, so any
// surface that resolves to monospace is proof the module explicitly set his Consolas stack.
const DOC =
  '<head><style>body{font-family:"Segoe UI",Tahoma,sans-serif}' +
  CSS +
  '</style></head><body>' +
  '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  '<div class="xls-root" id="xlsroot">' +
  '  <aside class="xls-sidebar">' +
  '    <nav class="xls-nav">' +
  '      <button class="xls-tab xls-tab-active" id="navactive"><span class="xls-nav-label">ENTITY INDEX</span>' +
  '        <b class="xls-nav-badge" id="badge">236</b></button>' +
  '      <button class="xls-tab" id="navidle"><span class="xls-nav-label">LIVE FEED</span></button>' +
  '    </nav>' +
  '  </aside>' +
  '  <div class="xls-main">' +
  '    <header class="xls-topbar"><div class="xls-topbar-titles">' +
  '      <span class="xls-eyebrow" id="eyebrow">X LISTENING STATION</span>' +
  '      <h1 class="xls-topbar-title" id="title">ENTITY INDEX</h1>' +
  '    </div></header>' +
  '    <main class="xls-body"><div class="xls-stat-grid">' +
  '      <div class="xls-stat"><span id="statlabel">ENTITIES</span><strong id="statfigure">236</strong></div>' +
  '    </div></main>' +
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

async function fontFamily(id: string): Promise<string> {
  return session.page.evaluate<string>(
    `getComputedStyle(document.getElementById('${id}')).getPropertyValue('font-family')`,
  );
}

// The console-chrome surfaces his frames render in Consolas monospace.
const MONO_IDS = ['navactive', 'navidle', 'badge', 'eyebrow', 'title', 'statfigure', 'statlabel'];

describe('X Listening — console chrome reproduces GhostExodus Consolas monospace', () => {
  it('nav / badges / heading / eyebrow / stat figure+label all resolve to the Consolas monospace stack', async () => {
    for (const id of MONO_IDS) {
      const ff = (await fontFamily(id)).toLowerCase();
      // His stack is `Consolas, 'Courier New', monospace` — Consolas leads, monospace anchors.
      expect(ff, `#${id} font-family = "${ff}" (want Consolas-led monospace)`).toContain('consolas');
      expect(ff, `#${id} font-family = "${ff}" (must anchor on the generic monospace family)`).toContain(
        'monospace',
      );
    }
  });
});
