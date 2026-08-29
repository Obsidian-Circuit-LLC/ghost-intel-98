// @vitest-environment node
/**
 * GhostExodus's stylesheet must not be able to touch anything outside his module.
 *
 * This is the guard that was missing in v3.73.0. His sheet styles global element selectors, it was
 * imported into the app's renderer, and every button, input and scrollbar in Ghost Intel 98 changed
 * — gold gradient buttons across the app, dark fields with pale text on light surfaces, the Case
 * Manager collapsing into itself. Nothing caught it: jsdom does not cascade, and the existing
 * Chrome harness tests loaded the theme sheets without his.
 *
 * So this measures the actual cascade, with his sheet and the app's loaded together, on markup that
 * has app chrome BOTH outside and inside his container. It is a containment test, not a look test:
 * it asserts his styling reaches his subtree and stops at its boundary.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';
import { scopeCss } from '../src/shared/xls/scope-css';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const SCOPE = 'xls-embed-root';

const APP_CSS =
  read('node_modules/98.css/dist/98.css') +
  read('src/renderer/styles/theme.css') +
  read('src/renderer/styles/98.overrides.css');

const HIS_CSS = read('src/renderer/modules/x-listening-embed/station.css');

const DOC =
  '<head><style>' + APP_CSS + '</style>' +
  '<style>' + scopeCss(HIS_CSS, `.${SCOPE}`) + '</style></head>' +
  '<body><div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  // App chrome OUTSIDE his module — this is what v3.73.0 restyled.
  '<button id="app-button">Open Notepad…</button>' +
  '<input id="app-input" class="ga98-text" value="Alberto Daniel Hill" />' +
  '<h2 id="app-heading">Identity</h2>' +
  // …and his own chrome INSIDE it, which must still get his look.
  `<div class="${SCOPE}">` +
  '<button id="his-button">RUN SWEEP</button>' +
  '<input id="his-input" value="Operation Midnight" />' +
  '</div>' +
  '</div></div></div></body>';

let session: ChromeSession;

beforeAll(async () => {
  session = await launchChrome();
  await session.page.setContent(DOC);
}, 30000);

afterAll(async () => {
  await session?.close();
});

function styleOf(id: string, props: readonly string[]) {
  return session.page.evaluate<Record<string, string>>(
    `(() => {
      const c = getComputedStyle(document.getElementById(${JSON.stringify(id)}));
      const out = {};
      for (const p of ${JSON.stringify(props)}) out[p] = c.getPropertyValue(p);
      return out;
    })()`
  );
}

describe('his stylesheet is confined to his module', () => {
  it('does NOT paint app buttons with his gold gradient', async () => {
    const s = await styleOf('app-button', ['background-image', 'border-top-color']);
    // His button rule is `background: linear-gradient(180deg, #e8c461, #bd8b25)` with a gold border.
    expect(s['background-image']).not.toContain('linear-gradient');
    expect(s['border-top-color']).not.toBe('rgb(201, 156, 49)');
  });

  it('does NOT repaint app text inputs dark — the unreadable-text report', async () => {
    // His `input { color: #dce8ea; background: #071216 }` on a light app field made text vanish.
    const s = await styleOf('app-input', ['background-color', 'color']);
    expect(s['background-color']).not.toBe('rgb(7, 18, 22)');
    expect(s.color).not.toBe('rgb(220, 232, 234)');
  });

  it('does NOT restyle app headings with his console font', async () => {
    const s = await styleOf('app-heading', ['font-family', 'color']);
    expect(s['font-family'].toLowerCase()).not.toContain('consolas');
    expect(s.color).not.toBe('rgb(232, 238, 238)');
  });

  it('DOES give his own buttons his gold gradient', async () => {
    const s = await styleOf('his-button', ['background-image']);
    expect(s['background-image']).toContain('linear-gradient');
  });

  it('DOES give his own inputs his dark field styling', async () => {
    const s = await styleOf('his-input', ['background-color', 'color']);
    expect(s['background-color']).toBe('rgb(7, 18, 22)');
    expect(s.color).toBe('rgb(220, 232, 234)');
  });
});
