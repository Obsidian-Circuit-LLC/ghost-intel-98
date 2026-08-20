/**
 * WebSDR Viewer — the receiver host region must have real height, measured in a real layout engine.
 *
 * FIELD BUG (GhostExodus, v3.72.1): the receiver plays audio but the waterfall only appears after a
 * manual Reload, and then disappears again about a second later.
 *
 * Cause: `.sdr-main` is a grid with POSITIONAL row tracks (`auto auto auto 1fr 28px`) but its second
 * child — the Tor warning banner — is conditionally rendered. With the banner absent there are only
 * four children, so every later child shifts up one track: `.sdr-browser-frame` (the receiver host,
 * which has no DOM children while a receiver is loaded) inherits `auto` and collapses to 0, and the
 * 28px `.sdr-footer` inherits the `1fr`.
 *
 * A zero-height host makes the renderer's overlay guard measure `<2px`, exhaust its 40-frame retry
 * budget, and then explicitly hide the native view — which is the ~1s "appears then vanishes" cycle.
 * It also hides the `.sdr-empty` placeholder (`position:absolute; inset:0` inside a 0-height box).
 *
 * jsdom does no layout and would pass the broken build, so this asserts MEASURED geometry.
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
  read('src/renderer/modules/websdr/websdr.css'),
].join('\n');

/** The module's registered window size (`register-builtins.tsx`). */
const WIN_W = 1400;
const WIN_H = 820;
/** `.sdr-main`'s designed footer track. */
const FOOTER_PX = 28;

let session: ChromeSession;
beforeAll(async () => {
  session = await launchChrome();
}, 60000);
afterAll(async () => {
  await session?.close();
});

/** The receiver column inside its REAL ancestor chain, with the Tor banner present or absent. */
function html(warning: boolean, selected: boolean, w: number = WIN_W, h: number = WIN_H): string {
  return `<style>${CSS}</style>
  <div class="ga98-window-shell" style="left:0;top:0;width:${w}px;height:${h}px">
   <div class="window"><div class="title-bar"><div class="title-bar-text">WebSDR</div></div>
   <div class="window-body">
    <div class="sdr-root">
      <header class="sdr-banner"><img class="sdr-banner-art" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" /></header>
      <div class="sdr-layout">
        <aside class="sdr-sidebar"><div class="sdr-receiver-list"></div></aside>
        <main class="sdr-main">
          <section class="sdr-toolbar"><label>FREQUENCY</label><div class="sdr-freq"><input value="7100000"></div></section>
          ${warning ? '<div class="sdr-tor-warning"><span>Tor is enabled for this receiver session.</span></div>' : ''}
          <section class="sdr-receiver-header"><div><b>[FELINE] 0-30MHZ SDR</b><span>http://example.invalid:8073/</span></div></section>
          <div class="sdr-browser-frame">${selected ? '' : '<div class="sdr-empty"><h2>WebSDR Viewer</h2><p>851 feeds are ready.</p></div>'}</div>
          <footer class="sdr-footer"><span>loaded.</span><span>KiwiSDR adapter</span></footer>
        </main>
      </div>
    </div>
   </div></div></div>`;
}

interface Geo {
  mainH: number;
  frameH: number;
  footerH: number;
  emptyH: number | null;
}

async function measure(warning: boolean, selected = true): Promise<Geo> {
  await session.page.setContent(html(warning, selected));
  const raw = await session.page.evaluate<string>(`(() => {
    const h = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().height) : null; };
    return JSON.stringify({ mainH: h('.sdr-main'), frameH: h('.sdr-browser-frame'), footerH: h('.sdr-footer'), emptyH: h('.sdr-empty') });
  })()`);
  return JSON.parse(raw) as Geo;
}

describe('WebSDR receiver host geometry', () => {
  it('gives the receiver host real height WITHOUT the Tor banner', async () => {
    const g = await measure(false);
    // The host must take the free space, not collapse — the overlay is positioned from this rect.
    expect(g.frameH, 'the receiver host must not collapse to zero').toBeGreaterThan(200);
    expect(g.footerH, 'the footer must stay on its 28px track').toBeLessThanOrEqual(FOOTER_PX + 2);
  }, 60000);

  it('gives the receiver host real height WITH the Tor banner', async () => {
    const g = await measure(true);
    expect(g.frameH).toBeGreaterThan(200);
    expect(g.footerH).toBeLessThanOrEqual(FOOTER_PX + 2);
  }, 60000);

  it('keeps the host the same size whether or not the banner is showing, minus the banner', async () => {
    const off = await measure(false);
    const on = await measure(true);
    expect(off.frameH).toBeGreaterThan(on.frameH); // only the banner's own height differs
    expect(off.frameH - on.frameH).toBeLessThan(60);
  }, 60000);

  it('renders the empty-state placeholder with real height when no receiver is selected', async () => {
    const g = await measure(false, false);
    expect(g.emptyH, 'the "choose a feed" placeholder must be visible').toBeGreaterThan(100);
  }, 60000);

  /**
   * FIELD BUG (GhostExodus, persistent): "as long as it's not resized, the display is perfect."
   * The overlay is positioned from this host rect, so if the host misbehaves at some window sizes the
   * receiver is drawn wrong no matter how correct the overlay code is. Sweep real sizes.
   */
  it('keeps a usable host at every window size the module can be dragged to', async () => {
    const sizes: Array<[number, number]> = [
      [1400, 820],  // registered default
      [2560, 1400], // maximised on his display
      [1000, 700],
      [820, 560],
      [640, 480],   // small but legitimate
      [420, 320],   // near the shell's minimum clamp
    ];
    const bad: string[] = [];
    for (const [w, h] of sizes) {
      await session.page.setContent(html(false, true, w, h));
      const raw = await session.page.evaluate<string>(`(() => {
        const f = document.querySelector('.sdr-browser-frame').getBoundingClientRect();
        const shell = document.querySelector('.ga98-window-shell').getBoundingClientRect();
        return JSON.stringify({ h: Math.round(f.height), w: Math.round(f.width),
          overflowsRight: Math.round(f.right - shell.right), overflowsBottom: Math.round(f.bottom - shell.bottom) });
      })()`);
      const g = JSON.parse(raw) as { h: number; w: number; overflowsRight: number; overflowsBottom: number };
      if (g.h < 40 || g.w < 40) bad.push(`${w}x${h}: host collapsed to ${g.w}x${g.h}`);
      if (g.overflowsRight > 1 || g.overflowsBottom > 1) {
        bad.push(`${w}x${h}: host escapes the window by ${g.overflowsRight}x${g.overflowsBottom}px`);
      }
    }
    expect(bad, bad.join(' | ')).toEqual([]);
  }, 90000);
});
