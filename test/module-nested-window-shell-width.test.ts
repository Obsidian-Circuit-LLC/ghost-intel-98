/**
 * A module that redundantly wraps its own root in `.ga98-window-shell` must still fill the real
 * window — measured in a real layout engine, since jsdom does no layout at all.
 *
 * FIELD BUG, found by actually launching the packaged app under CDP and measuring the live DOM
 * (not by reading source, and not by a jsdom test — this class of bug is invisible to both).
 * `Window.tsx` already renders every module inside its own `.ga98-window-shell` > `.window` >
 * `.window-body`, with the OUTER shell given an explicit inline width by the window manager. Two
 * modules (Address Book, Spectre) ALSO wrap their own root in a SECOND `.ga98-window-shell` div,
 * copying a pattern from each other. That class is `position:absolute` with no explicit width
 * (theme.css), so a nested instance with no `width` of its own resolves via shrink-to-fit against
 * its OWN content rather than filling the real window:
 *
 *   - Spectre (content: a lean toolbar + a map), measured live: 265.97px inside a 980px window.
 *   - Address Book (content: a denser form, which partly masked the bug), measured live:
 *     424.95px inside a 920px window — still losing more than half the window.
 *
 * `width:'100%'` on the nested shell turns it into a definite box instead of a shrink-to-fit one,
 * confirmed live (jumped 265.97px -> 980px) before being applied to source.
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
].join('\n');

let session: ChromeSession;
beforeAll(async () => { session = await launchChrome(); }, 60000);
afterAll(async () => { await session?.close(); });

/** The REAL ancestor chain a module renders under: the outer, explicitly-sized `.ga98-window-shell`
 *  (Window.tsx gives it inline left/top/width/height) > `.window` > `.window-body` > the module's
 *  own root. `innerContent` is a stand-in for a module whose own content is intrinsically narrow —
 *  exactly the shape that makes this bug visible (a dense form can mask it; a lean toolbar can't). */
function windowHtml(innerContent: string, outerW = 980, outerH = 700): string {
  return `<style>${CSS}</style>
  <div class="ga98-window-shell" data-focused="true" style="left:0;top:0;width:${outerW}px;height:${outerH}px">
    <div class="window" style="width:100%;height:100%">
      <div class="title-bar"><div class="title-bar-text">Test</div></div>
      <div class="window-body" style="height:calc(100% - 20px)">${innerContent}</div>
    </div>
  </div>`;
}

/** A module root that redundantly nests `.ga98-window-shell`, WITHOUT the width fix — reproduces
 *  the field bug's exact shape. */
function nestedShellWithoutFix(): string {
  return `<div class="ga98-window-shell" style="display:flex;flex-direction:column;height:100%">
    <div class="ga98-spectre-bar" style="display:flex;gap:4px;padding:4px">
      <button>Map Search</button><button>Settings</button><span class="ga98-spectre-egress">TOR — not ready</span>
    </div>
    <div class="ga98-split" style="flex:1;min-height:0">
      <div class="ga98-pane" style="width:260px;flex:0 0 auto"><input placeholder="Place"><button>Scan</button></div>
      <div class="ga98-pane" style="flex:1;min-width:0"><canvas id="map"></canvas></div>
    </div>
  </div>`;
}

/** The same shape, WITH the fix (`width:'100%'` alongside `height:'100%'`). */
function nestedShellWithFix(): string {
  return `<div class="ga98-window-shell" style="display:flex;flex-direction:column;width:100%;height:100%">
    <div class="ga98-spectre-bar" style="display:flex;gap:4px;padding:4px">
      <button>Map Search</button><button>Settings</button><span class="ga98-spectre-egress">TOR — not ready</span>
    </div>
    <div class="ga98-split" style="flex:1;min-height:0">
      <div class="ga98-pane" style="width:260px;flex:0 0 auto"><input placeholder="Place"><button>Scan</button></div>
      <div class="ga98-pane" style="flex:1;min-width:0"><canvas id="map"></canvas></div>
    </div>
  </div>`;
}

async function measureSplitWidth(inner: string, outerW = 980): Promise<number> {
  await session.page.setContent(windowHtml(inner, outerW));
  const raw = await session.page.evaluate<string>(`(() => {
    const split = document.querySelector('.ga98-split');
    return JSON.stringify(split.getBoundingClientRect().width);
  })()`);
  return JSON.parse(raw) as number;
}

describe('a module that nests .ga98-window-shell must still fill the real window', () => {
  it('REPRODUCES the field bug: without the width fix, the map pane shrink-wraps instead of filling the window', async () => {
    const w = await measureSplitWidth(nestedShellWithoutFix(), 980);
    // The live field measurement was 265.97px inside a 980px window. This fixture's toolbar text
    // differs slightly so the exact pixel figure won't match, but the DEFECT is the same shape:
    // shrink-to-fit against a lean toolbar, nowhere near the 980px window it should fill.
    expect(w, 'an un-fixed nested shell must not reach anywhere near the real window width').toBeLessThan(700);
  }, 60000);

  it('FIXED: with width:100% on the nested shell, the split fills the real window', async () => {
    const w = await measureSplitWidth(nestedShellWithFix(), 980);
    expect(w).toBeGreaterThan(900);
  }, 60000);

  it('holds at a different window width too, not just the one field measurement', async () => {
    const w = await measureSplitWidth(nestedShellWithFix(), 1400);
    expect(w).toBeGreaterThan(1300);
  }, 60000);
});
