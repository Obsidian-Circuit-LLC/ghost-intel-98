// @vitest-environment jsdom
/**
 * QUIET AMETHYST — app-chrome straggler smoke (plan Task 5, Step 1).
 *
 * The desktop chrome that lives OUTSIDE the 98.css control set — the floating Date/Time clock
 * widget (its own titlebar gradient, digital body text, and analog SVG face) and the Access-menu
 * flyout — used to hardcode classic palette literals (`#000080` gradients, a white `#fff` clock
 * face, a `#c00000` sweep hand, `#c0c0c0` flyout surfaces) that a `var()`-only theme cannot reach.
 * Task 5 rewired those to palette tokens the amethyst tier overrides.
 *
 * This test does NOT hand-author the token markup (the earlier version did, which made it a
 * tautology: it stayed green even if `ClockWidget`/`AccessMenu` were reverted to literals, because
 * the token vars lived in the test string, not the components). Instead it RENDERS THE ACTUAL
 * COMPONENTS (React 18 createRoot + act, in jsdom), serialises their emitted DOM, and:
 *
 *   (1) asserts the emitted INLINE STYLE STRINGS carry the token references — proving the component
 *       rewiring itself (jsdom is blind to `var()` resolution, but it faithfully serialises the
 *       inline style the component set); and
 *   (2) feeds that SAME real serialised DOM through the real `theme.css` cascade in headless Chrome
 *       (jsdom cannot resolve `var()`) and asserts the tokens resolve dark/light correctly under
 *       amethyst vs classic — the true cascade proof.
 *
 * Because the Chrome phase consumes the components' own serialised output, reverting any component
 * to a hardcoded literal breaks BOTH phases: phase (1) no longer finds the token reference, and
 * phase (2) resolves the literal (e.g. a `#fff` face stays light under amethyst) and fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';
import { ClockWidget, CLOCK_ENABLED_KEY } from '../src/renderer/shell/ClockWidget';
import { AccessMenu } from '../src/renderer/shell/AccessMenu';
import { useSettings, useWindows } from '../src/renderer/state/store';
import { _resetRegistryForTest, registerModule } from '../src/renderer/state/registry';
import { defaultSettings } from '@shared/types';

const ROOT = process.cwd();
const CSS_98 = readFileSync(join(ROOT, 'node_modules/98.css/dist/98.css'), 'utf8');
const THEME_CSS = readFileSync(join(ROOT, 'src/renderer/styles/theme.css'), 'utf8');

// Minimal registry so AccessMenu's Programs flyout has items (glyphFor lookups) without dragging the
// whole builtin module tree (pdfjs/canvas) into jsdom.
const Dummy = (): null => null;
function registerFixtureModules(): void {
  for (const [key, title, glyph] of [
    ['cases', 'My Cases', '📁'], ['notepad', 'Notepad 98', '📝'], ['briefcase', 'Briefcase', '💼'],
    ['markets', 'Markets', '📈'], ['search', 'Search', '🔍'], ['ai-assistant', 'Q', '🤖'],
    ['osint-toolkit', 'OSINT Toolkit', '🧰']
  ] as const) {
    registerModule({ key, title, glyph, component: Dummy, builtin: true });
  }
}

// Captured serialised output of the REAL components (filled in beforeAll).
let clockHTML = '';
let flyoutHTML = '';
let session: ChromeSession;

/** Render `node` into a fresh jsdom container, run `after`, then unmount. Returns whatever
 *  `after(container)` produced (typically a serialised outerHTML string). */
function withRender<T>(node: JSX.Element, after: (container: HTMLElement) => T): T {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(node));
  try {
    return after(container);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
}

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  // (a) Real ClockWidget — enable it (off by default) so it renders its bar/body/analog face.
  localStorage.setItem(CLOCK_ENABLED_KEY, '1');
  clockHTML = withRender(<ClockWidget />, (c) => {
    const el = c.querySelector('.ga98-clock');
    if (!el) throw new Error('ClockWidget did not render its .ga98-clock root (is it enabled?)');
    return el.outerHTML;
  });

  // (b) Real AccessMenu — mount, open the Programs category, capture that flyout's markup.
  _resetRegistryForTest();
  registerFixtureModules();
  useWindows.setState({ open: vi.fn() });
  useSettings.setState({ settings: { ...defaultSettings, soundEnabled: false } });
  flyoutHTML = withRender(<AccessMenu onClose={vi.fn()} />, (c) => {
    const trigger = [...c.querySelectorAll('[aria-haspopup="true"]')].find((n) =>
      n.textContent?.includes('Programs')
    ) as HTMLElement | undefined;
    if (!trigger) throw new Error('AccessMenu has no Programs flyout trigger');
    act(() => trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    // The opened flyout is the only role=menu carrying an inline background token (the top-level
    // .ga98-access-menu has no inline style).
    const flyout = c.querySelector('[role="menu"][style*="var(--ga98-grey)"]');
    if (!flyout) throw new Error('Programs flyout did not open with an inline --ga98-grey surface');
    return flyout.outerHTML;
  });
  useSettings.setState({ settings: null });
  _resetRegistryForTest();

  // (c) Feed the REAL serialised component DOM through the real theme.css cascade in headless
  // Chrome, wrapped in the mandated .ga98-window-shell > .window > .window-body ancestor chain.
  const DOC =
    '<head><style>' + CSS_98 + '</style><style>' + THEME_CSS + '</style></head><body>' +
    '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
    '<div class="ga98-taskbar"></div>' +
    clockHTML +
    flyoutHTML +
    '</div></div></div></body>';
  session = await launchChrome();
  await session.page.setContent(DOC);
}, 30000);

afterAll(async () => {
  await session?.close();
  localStorage.removeItem(CLOCK_ENABLED_KEY);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------
// Phase 1 — component rewiring (jsdom serialisation). Fails if a component reverts to a literal.
// ---------------------------------------------------------------------------------------------
describe('components emit palette-token inline styles (not literals)', () => {
  it('ClockWidget analog face fill references --ga98-shadow-light', () => {
    expect(clockHTML).toContain('fill: var(--ga98-shadow-light)');
  });

  it('ClockWidget analog second hand stroke references --ga98-clock-secondhand', () => {
    expect(clockHTML).toContain('stroke: var(--ga98-clock-secondhand)');
  });

  it('AccessMenu flyout background references --ga98-grey and border --ga98-flyout-outset', () => {
    expect(flyoutHTML).toContain('background: var(--ga98-grey)');
    expect(flyoutHTML).toContain('var(--ga98-flyout-outset)');
  });
});

// ---------------------------------------------------------------------------------------------
// Phase 2 — real theme.css cascade over the SAME serialised component DOM (headless Chrome).
// ---------------------------------------------------------------------------------------------
async function setTheme(value: string | null): Promise<void> {
  if (value === null) {
    await session.page.evaluate(`delete document.documentElement.dataset.ga98Theme; true`);
  } else {
    await session.page.evaluate(`document.documentElement.dataset.ga98Theme = '${value}'; true`);
  }
}

/** WCAG relative luminance of the computed `prop` of the first element matching `selector`. */
async function lumOf(selector: string, prop: string): Promise<number> {
  return session.page.evaluate<number>(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) throw new Error('no element matches ' + ${JSON.stringify(selector)});
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
       return lum(parse(getComputedStyle(el).getPropertyValue(${JSON.stringify(prop)})));
     })()`
  );
}

async function colorOf(selector: string, prop: string): Promise<string> {
  return session.page.evaluate<string>(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) throw new Error('no element matches ' + ${JSON.stringify(selector)});
       return getComputedStyle(el).getPropertyValue(${JSON.stringify(prop)});
     })()`
  );
}

async function backgroundImageOf(selector: string): Promise<string> {
  return session.page.evaluate<string>(
    `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundImage`
  );
}

describe('app-chrome under amethyst — dark surfaces, light text, amethyst titlebar', () => {
  beforeAll(async () => {
    await setTheme('amethyst');
  });

  it('clock titlebar renders the amethyst gradient (not classic navy)', async () => {
    const bg = await backgroundImageOf('.ga98-clock-bar');
    expect(bg, 'clock titlebar should use the amethyst blue start stop').toContain('rgb(36, 26, 51)');
    expect(bg, 'clock titlebar should use the amethyst titlebar-to end stop').toContain('rgb(58, 42, 82)');
    expect(bg, 'clock titlebar must NOT keep the classic navy').not.toContain('rgb(0, 0, 128)');
  });

  it('analog clock face is dark', async () => {
    expect(await lumOf('svg circle[style*="fill: var(--ga98-shadow-light)"]', 'fill')).toBeLessThan(0.25);
  });

  it('analog second hand resolves to the amethyst accent (not the classic red)', async () => {
    const stroke = await colorOf('svg line[style*="stroke: var(--ga98-clock-secondhand)"]', 'stroke');
    expect(stroke).toContain('rgb(157, 107, 255)');
    expect(stroke).not.toContain('rgb(192, 0, 0)');
  });

  it('clock body text is light', async () => {
    expect(await lumOf('.ga98-clock-time', 'color')).toBeGreaterThan(0.6);
  });

  it('taskbar surface is dark', async () => {
    expect(await lumOf('.ga98-taskbar', 'background-color')).toBeLessThan(0.25);
  });

  it('Access-menu flyout surface is dark', async () => {
    expect(await lumOf('[role="menu"][style*="var(--ga98-grey)"]', 'background-color')).toBeLessThan(0.25);
  });
});

describe('app-chrome under classic — light surfaces (control group)', () => {
  beforeAll(async () => {
    await setTheme(null);
  });

  it('clock titlebar keeps the classic navy gradient', async () => {
    const bg = await backgroundImageOf('.ga98-clock-bar');
    expect(bg).toContain('rgb(0, 0, 128)');
  });

  it('analog clock face stays light', async () => {
    expect(await lumOf('svg circle[style*="fill: var(--ga98-shadow-light)"]', 'fill')).toBeGreaterThan(0.6);
  });

  it('analog second hand stays the classic red', async () => {
    const stroke = await colorOf('svg line[style*="stroke: var(--ga98-clock-secondhand)"]', 'stroke');
    expect(stroke).toContain('rgb(192, 0, 0)');
  });

  it('clock body text stays black', async () => {
    expect(await lumOf('.ga98-clock-time', 'color')).toBeLessThan(0.05);
  });

  it('Access-menu flyout stays light', async () => {
    expect(await lumOf('[role="menu"][style*="var(--ga98-grey)"]', 'background-color')).toBeGreaterThan(0.4);
  });
});
