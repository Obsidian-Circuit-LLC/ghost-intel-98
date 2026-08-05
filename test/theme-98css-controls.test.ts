// @vitest-environment node
/**
 * QUIET AMETHYST — dark 98.css control override smoke (plan Task 4, Step 1).
 *
 * The bundled `98.css` library hardcodes every control colour (silver surfaces, white fields,
 * navy selection) with NO custom properties, so a `var()`-only theme cannot recolour them — a
 * dedicated override sheet gated on `[data-ga98-theme='amethyst']` must. This test loads the
 * REAL cascade — `98.css` (the shipped `dist/98.css` entry) + `theme.css` + `98.overrides.css`,
 * in the same order `main.tsx` imports them — through real headless Chrome (jsdom cannot resolve
 * `var()`), mounts the mandated `.ga98-window-shell > .window > .window-body` ancestor chain, and
 * asserts every common 98.css control renders DARK-on-LIGHT-text under amethyst and stays
 * LIGHT-surfaced under classic (the control group proving the gate, not the base sheet, flips it).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const CSS_98 = readFileSync(join(ROOT, 'node_modules/98.css/dist/98.css'), 'utf8');
const THEME_CSS = readFileSync(join(ROOT, 'src/renderer/styles/theme.css'), 'utf8');
const OVERRIDES_CSS = readFileSync(join(ROOT, 'src/renderer/styles/98.overrides.css'), 'utf8');

// A window mounted inside the window-shell cascade chain, holding one of each common control.
// The inner window carries a `.title-bar-controls` (glyph buttons), a select (dropdown-arrow glyph),
// a 98.css-markup checkbox (`input + label` sibling — the pattern whose `:after` draws the check
// glyph), and a `.ga98-dropzone`, so the glyph + dropzone assertions have real targets.
const DOC =
  '<head>' +
  '<style>' + CSS_98 + '</style>' +
  '<style>' + THEME_CSS + '</style>' +
  '<style>' + OVERRIDES_CSS + '</style>' +
  '</head><body>' +
  '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  '  <div class="window" id="win">' +
  '    <div class="title-bar">' +
  '      <div class="title-bar-text">T</div>' +
  '      <div class="title-bar-controls">' +
  '        <button aria-label="Minimize" id="btnMin"></button>' +
  '        <button aria-label="Maximize" id="btnMax"></button>' +
  '        <button aria-label="Close" id="btnClose"></button>' +
  '      </div>' +
  '    </div>' +
  '    <div class="window-body">' +
  '      <input type="text" id="inp" value="x" />' +
  '      <select id="sel"><option>a</option></select>' +
  '      <input type="checkbox" id="cb" checked /><label for="cb" id="cblab">c</label>' +
  '      <table id="tbl"><thead><tr><th id="th">H</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>' +
  '      <ul class="tree-view" id="tree"><li>a</li></ul>' +
  '      <div class="ga98-dropzone" id="dz">drop</div>' +
  '    </div>' +
  '  </div>' +
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

interface Measure {
  bgLum: number;
  fgLum: number;
}

/** Measure the WCAG relative luminance of an element's computed background-color and color. */
async function measure(id: string): Promise<Measure> {
  return session.page.evaluate<Measure>(
    `(() => {
       const parse = (s) => {
         const m = s.match(/rgba?\\(([^)]+)\\)/);
         if (!m) return [255, 255, 255];
         const p = m[1].split(',').map((x) => parseFloat(x));
         return [p[0], p[1], p[2]];
       };
       const lum = (rgb) => {
         const a = rgb.map((v) => {
           const c = v / 255;
           return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
         });
         return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
       };
       const el = document.getElementById('${id}');
       const cs = getComputedStyle(el);
       return { bgLum: lum(parse(cs.backgroundColor)), fgLum: lum(parse(cs.color)) };
     })()`
  );
}

/** Read an element's computed `background-image` (the glyph slot). */
async function bgImage(id: string): Promise<string> {
  return session.page.evaluate<string>(
    `getComputedStyle(document.getElementById('${id}')).backgroundImage`
  );
}

/** Read a pseudo-element's computed `background-image` (98.css draws check/dot glyphs there). */
async function bgImagePseudo(id: string, pseudo: string): Promise<string> {
  return session.page.evaluate<string>(
    `getComputedStyle(document.getElementById('${id}'), '${pseudo}').backgroundImage`
  );
}

const CONTROLS = ['win', 'inp', 'sel', 'tbl', 'th', 'tree'];

describe('98.css controls under amethyst — dark surface, light text', () => {
  it('renders every common control dark-bg + light-text', async () => {
    await setTheme('amethyst');
    for (const id of CONTROLS) {
      const m = await measure(id);
      expect(m.bgLum, `${id} background should be dark`).toBeLessThan(0.25);
      expect(m.fgLum, `${id} text should be light`).toBeGreaterThan(0.6);
    }
  });
});

describe('98.css controls under classic — light surface (control group)', () => {
  it('leaves every common control light-bg (proves the gate, not the base sheet, flips it)', async () => {
    await setTheme(null);
    for (const id of CONTROLS) {
      const m = await measure(id);
      expect(m.bgLum, `${id} background should stay light under classic`).toBeGreaterThan(0.4);
    }
  });
});

// 98.css draws every control glyph (title-bar Minimize/Maximize/Restore/Close, the select dropdown
// arrow, the checkbox/radio check-mark & dot, scrollbar arrows) as a BLACK SVG data-URI. Under the
// near-black amethyst surface a black glyph is invisible — and the amethyst `button` shorthand
// override compounds it. The fix supplies light-fill (`#efeaff`) glyph data-URIs under amethyst; the
// tell-tale that the amethyst glyph (not the base black one) is in force is the `efeaff` substring.
const LIGHT_FILL = 'efeaff';

describe('98.css control glyphs under amethyst — present + light-filled', () => {
  it('title-bar-controls Close button carries a light glyph', async () => {
    await setTheme('amethyst');
    const img = await bgImage('btnClose');
    expect(img, 'close glyph must not be wiped to none').not.toBe('none');
    expect(img, 'close glyph must be the light-fill amethyst variant').toContain(LIGHT_FILL);
  });

  it('title-bar-controls Minimize button carries a light glyph', async () => {
    await setTheme('amethyst');
    const img = await bgImage('btnMin');
    expect(img).not.toBe('none');
    expect(img, 'minimize glyph must be light-filled').toContain(LIGHT_FILL);
  });

  it('select dropdown arrow is a light glyph', async () => {
    await setTheme('amethyst');
    const img = await bgImage('sel');
    expect(img, 'select arrow must not be none').not.toBe('none');
    expect(img, 'select arrow must be light-filled').toContain(LIGHT_FILL);
  });

  it('checkbox check-mark (input+label:after) is a light glyph', async () => {
    await setTheme('amethyst');
    const img = await bgImagePseudo('cblab', '::after');
    expect(img, 'checkbox check must not be none').not.toBe('none');
    expect(img, 'checkbox check must be light-filled').toContain(LIGHT_FILL);
  });
});

describe('ga98-dropzone under amethyst — dark surface, legible text', () => {
  it('renders dark-bg + light-text under amethyst', async () => {
    await setTheme('amethyst');
    const m = await measure('dz');
    expect(m.bgLum, 'dropzone background should be dark').toBeLessThan(0.25);
    expect(m.fgLum, 'dropzone text should be legible-light').toBeGreaterThan(0.5);
  });

  it('stays light-bg under classic (classic parity untouched)', async () => {
    await setTheme(null);
    const m = await measure('dz');
    expect(m.bgLum, 'dropzone background should stay light under classic').toBeGreaterThan(0.4);
  });
});
