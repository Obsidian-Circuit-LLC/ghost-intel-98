/**
 * Ghost Social Media Manager — the Compose page must SCROLL, measured in a real layout engine.
 *
 * FIELD BUG (GhostExodus, v3.72.1): "when I go over to Compose and select which profile to send
 * through, the windows are locked and the page won't scroll down to the other profiles."
 *
 * `.gsm-page` already carried `overflow:auto`, so the defect is invisible to CSS reading AND to
 * jsdom (which does no layout): `.gsm-shell` is a `display:grid` with a single IMPLICIT row, and an
 * implicit row is `auto`-sized while grid items default to `min-height:auto` — so the row grew to
 * the content's height instead of being capped at the shell's. `.gsm-main{height:100%}` then
 * resolved against the grown row and `.gsm-page{flex:1}` filled it, so it never overflowed and
 * never scrolled, while `.gsm-root{overflow:hidden}` silently clipped everything below the fold.
 *
 * These assertions are therefore about MEASURED geometry in real Chrome, not about declarations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const CSS = [
  read('node_modules/98.css/dist/98.css'),
  read('src/renderer/styles/theme.css'),
  read('src/renderer/styles/98.overrides.css'),
  read('src/renderer/modules/ghost-social/ghost-social.css'),
].join('\n');

/** The module's registered window size (`register-builtins.tsx`: 1180×760). */
const WIN_W = 1180;
const WIN_H = 734;

let session: ChromeSession;
beforeAll(async () => {
  session = await launchChrome();
}, 60000);
afterAll(async () => {
  await session?.close();
});

/** The Compose page inside its REAL ancestor chain — the `.ga98-window-shell > .window >
 *  .window-body` cascade the module actually renders under. */
function composeHtml(accounts: number): string {
  const dest = Array.from({ length: accounts }, (_, i) =>
    `<div class="gsm-destination"><div><i>x</i><span><b>acct${i}</b><small>Open in account wall</small></span></div><button class="gsm-switch on"><span></span></button></div>`).join('');
  const cards = Array.from({ length: accounts }, (_, i) =>
    `<div class="gsm-compose-browser-card"><div class="gsm-compose-browser-title"><div><span><b>acct${i}</b><small>drag</small></span></div><button>REFRESH</button></div><div class="gsm-compose-browser-host"></div></div>`).join('');
  return `<style>${CSS}</style>
  <div class="ga98-window-shell" style="left:0;top:0;width:${WIN_W}px;height:${WIN_H}px">
    <div class="window" style="width:100%">
      <div class="title-bar"><div class="title-bar-text">Ghost Social</div></div>
      <div class="window-body">
        <div class="gsm-root"><div class="gsm-shell">
          <aside class="gsm-sidebar"><b>rail</b></aside>
          <div class="gsm-main">
            <header class="gsm-header"><b>Ghost</b></header>
            <section class="gsm-page gsm-compose-page">
              <div class="gsm-page-title"><div><span>PUBLISHING</span><h1>Universal Composer</h1></div></div>
              <div class="gsm-compose-layout">
                <div class="gsm-panel gsm-composer"><label>MASTER POST</label><textarea></textarea>
                  <div class="gsm-media-row"><button>PHOTO</button><button>VIDEO</button></div>
                  <div class="gsm-composer-footer"><span>0 characters</span><button class="gsm-primary">PREPARE</button></div></div>
                <div class="gsm-panel gsm-destinations"><label>DESTINATIONS / LIVE TILES</label>${dest}</div>
              </div>
              <div class="gsm-compose-live-head"><div><span>LIVE ACCOUNT WALL</span><h2>Campaign Accounts</h2></div><p>Two per row.</p></div>
              <div class="gsm-compose-browser-grid">${cards}</div>
            </section>
          </div>
        </div></div>
      </div>
    </div>
  </div>`;
}

interface Geometry {
  rootClient: number;
  rootScroll: number;
  mainHeight: number;
  pageClient: number;
  pageScroll: number;
  canScroll: boolean;
  /** Distance from the bottom of the last account tile to the bottom of the clipping root, AFTER
   *  scrolling the page as far down as it will go. <= 0 means the tile is reachable. */
  lastTileOverhangAfterScroll: number;
}

async function measure(accounts: number): Promise<Geometry> {
  await session.page.setContent(composeHtml(accounts));
  const raw = await session.page.evaluate<string>(`(() => {
    const root = document.querySelector('.gsm-root');
    const main = document.querySelector('.gsm-main');
    const page = document.querySelector('.gsm-page');
    page.scrollTop = page.scrollHeight;
    const cards = document.querySelectorAll('.gsm-compose-browser-card');
    const last = cards[cards.length - 1].getBoundingClientRect();
    return JSON.stringify({
      rootClient: root.clientHeight,
      rootScroll: root.scrollHeight,
      mainHeight: Math.round(main.getBoundingClientRect().height),
      pageClient: page.clientHeight,
      pageScroll: page.scrollHeight,
      canScroll: page.scrollHeight > page.clientHeight + 1,
      lastTileOverhangAfterScroll: Math.round(last.bottom - root.getBoundingClientRect().bottom)
    });
  })()`);
  return JSON.parse(raw) as Geometry;
}

describe('Ghost Social Compose page — scrolls instead of clipping', () => {
  it('scrolls the page rather than growing past the window (8 accounts)', async () => {
    const g = await measure(8);
    expect(g.canScroll, 'the compose page must be scrollable, not grown to fit').toBe(true);
    expect(g.pageScroll).toBeGreaterThan(g.pageClient);
  }, 60000);

  it('never lets the shell row grow past the window height', async () => {
    const g = await measure(8);
    // The runaway grid row is the actual defect: main must stay within the clipping root.
    expect(g.mainHeight).toBeLessThanOrEqual(g.rootClient + 1);
    expect(g.rootScroll).toBeLessThanOrEqual(g.rootClient + 1);
  }, 60000);

  it('leaves the last account tile reachable by scrolling', async () => {
    const g = await measure(8);
    expect(g.lastTileOverhangAfterScroll).toBeLessThanOrEqual(0);
  }, 60000);

  it('still scrolls with only two accounts', async () => {
    const g = await measure(2);
    expect(g.canScroll).toBe(true);
    expect(g.lastTileOverhangAfterScroll).toBeLessThanOrEqual(0);
  }, 60000);
});
