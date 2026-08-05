// @vitest-environment node
/**
 * QUIET AMETHYST — app-chrome straggler smoke (plan Task 5, Step 1).
 *
 * The desktop chrome that lives OUTSIDE the 98.css control set — the floating Date/Time clock
 * widget (its own titlebar gradient, digital body text, and analog SVG face), the taskbar, and
 * the Access-menu flyout — hardcoded classic palette literals (`#000080/#1084d0` gradients,
 * `#000` body text, a white `#fff` clock face, `#c0c0c0` flyout surfaces) that a `var()`-only
 * theme cannot reach. Task 5 rewires those to the palette tokens. This test loads the REAL
 * `theme.css` cascade through headless Chrome (jsdom cannot resolve `var()`), mounts the mandated
 * `.ga98-window-shell > .window > .window-body` ancestor chain, and asserts under amethyst the
 * clock titlebar renders the amethyst gradient, the analog face is dark, the clock body text is
 * light, the taskbar is dark, and the Access flyout is dark — while classic keeps its light
 * surfaces (the control group proving the token flip, not a rewrite of the base values, does it).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const CSS_98 = readFileSync(join(ROOT, 'node_modules/98.css/dist/98.css'), 'utf8');
const THEME_CSS = readFileSync(join(ROOT, 'src/renderer/styles/theme.css'), 'utf8');

// Markup mirrors the shell chrome under test: ClockWidget's DOM (`.ga98-clock*` classes styled by
// theme.css; the analog SVG carries the token fills the component now sets inline), the taskbar,
// and the AccessMenu flyout (its inline token surface). Wrapped in the window-shell chain per the
// standing CSS-harness constraint.
const DOC =
  '<head><style>' + CSS_98 + '</style><style>' + THEME_CSS + '</style></head><body>' +
  '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  '  <div class="ga98-taskbar" id="taskbar"></div>' +
  '  <div class="ga98-clock" id="clock">' +
  '    <div class="ga98-clock-bar" id="clockbar">' +
  '      <span class="ga98-clock-title">Date/Time</span>' +
  '      <button class="ga98-clock-btn" id="clockbtn">12h</button>' +
  '    </div>' +
  '    <div class="ga98-clock-body">' +
  '      <div class="ga98-clock-left">' +
  '        <div class="ga98-clock-time" id="clocktime">12:00:00</div>' +
  '        <div class="ga98-clock-date">date</div>' +
  '      </div>' +
  '      <div class="ga98-clock-analog">' +
  '        <svg viewBox="0 0 100 100" width="100" height="100">' +
  '          <circle id="analogface" cx="50" cy="50" r="47" style="fill: var(--ga98-shadow-light); stroke: #808080;" stroke-width="2"></circle>' +
  '          <line id="secondhand" x1="50" y1="50" x2="50" y2="14" style="stroke: var(--ga98-status-error);" stroke-width="0.8"></line>' +
  '        </svg>' +
  '      </div>' +
  '    </div>' +
  '  </div>' +
  '  <div role="menu" id="accessflyout" style="background: var(--ga98-grey); border: 2px outset var(--ga98-shadow-light);">flyout</div>' +
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

/** WCAG relative luminance of a computed property that resolves to a single rgb(a) colour. */
async function lumOf(id: string, prop: string): Promise<number> {
  return session.page.evaluate<number>(
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
       return lum(parse(getComputedStyle(el).getPropertyValue('${prop}')));
     })()`
  );
}

async function backgroundImageOf(id: string): Promise<string> {
  return session.page.evaluate<string>(
    `getComputedStyle(document.getElementById('${id}')).backgroundImage`
  );
}

describe('app-chrome under amethyst — dark surfaces, light text, amethyst titlebar', () => {
  beforeAll(async () => {
    await setTheme('amethyst');
  });

  it('clock titlebar renders the amethyst gradient (not classic navy)', async () => {
    const bg = await backgroundImageOf('clockbar');
    expect(bg, 'clock titlebar should use the amethyst blue start stop').toContain('rgb(36, 26, 51)');
    expect(bg, 'clock titlebar should use the amethyst titlebar-to end stop').toContain('rgb(58, 42, 82)');
    expect(bg, 'clock titlebar must NOT keep the classic navy').not.toContain('rgb(0, 0, 128)');
  });

  it('analog clock face is dark', async () => {
    expect(await lumOf('analogface', 'fill')).toBeLessThan(0.25);
  });

  it('clock body text is light', async () => {
    expect(await lumOf('clocktime', 'color')).toBeGreaterThan(0.6);
  });

  it('taskbar surface is dark', async () => {
    expect(await lumOf('taskbar', 'background-color')).toBeLessThan(0.25);
  });

  it('Access-menu flyout surface is dark', async () => {
    expect(await lumOf('accessflyout', 'background-color')).toBeLessThan(0.25);
  });
});

describe('app-chrome under classic — light surfaces (control group)', () => {
  beforeAll(async () => {
    await setTheme(null);
  });

  it('clock titlebar keeps the classic navy gradient', async () => {
    const bg = await backgroundImageOf('clockbar');
    expect(bg).toContain('rgb(0, 0, 128)');
  });

  it('analog clock face stays light', async () => {
    expect(await lumOf('analogface', 'fill')).toBeGreaterThan(0.6);
  });

  it('clock body text stays black', async () => {
    expect(await lumOf('clocktime', 'color')).toBeLessThan(0.05);
  });

  it('Access-menu flyout stays light', async () => {
    expect(await lumOf('accessflyout', 'background-color')).toBeGreaterThan(0.4);
  });
});
