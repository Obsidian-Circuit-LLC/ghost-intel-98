// @vitest-environment node
/**
 * QUIET AMETHYST — computed-style + var()-resolution guard (plan Task 3, Step 6).
 *
 * Runs the REAL `theme.css` through real headless Chrome (jsdom cannot resolve `var()` — a probe
 * confirmed `color: var(--x)` returns the literal string, never the resolved rgb). The document
 * mounts within the mandated `.ga98-window-shell > .window > .window-body` ancestor chain.
 *
 * Asserts:
 *  - classic (attribute unset): `--ga98-grey` resolves to `#c0c0c0`; body `color` → rgb(0,0,0).
 *  - amethyst: `--ga98-grey` → `#1a1822`; `--ga98-desktop-bg` → `#0c0a12`; body `color` →
 *    rgb(207,201,221) (the global text wire flips light through `color: var(--ga98-text)`).
 *  - `--ga98-status-error` resolves to the SAME value under BOTH themes (fixed tier is skin-proof).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const THEME_CSS = readFileSync(join(process.cwd(), 'src/renderer/styles/theme.css'), 'utf8');

// Full document: theme.css in <head>, mounted within the window-shell cascade chain in <body>.
const DOC =
  '<head><style>' +
  THEME_CSS +
  '</style></head><body>' +
  '<div class="ga98-window-shell"><div class="window"><div class="window-body" id="probe">x</div></div></div>' +
  '</body>';

let session: ChromeSession;

beforeAll(async () => {
  session = await launchChrome();
  await session.page.setContent(DOC);
}, 30000);

afterAll(async () => {
  await session?.close();
});

/** Resolve a custom property off documentElement (trimmed, lower-cased). */
async function tokenValue(name: string): Promise<string> {
  return session.page.evaluate<string>(
    `getComputedStyle(document.documentElement).getPropertyValue('${name}').trim().toLowerCase()`
  );
}

/** Resolved computed body text colour (an rgb string). */
async function bodyColor(): Promise<string> {
  return session.page.evaluate<string>(`getComputedStyle(document.body).color`);
}

async function setTheme(value: string | null): Promise<void> {
  if (value === null) {
    await session.page.evaluate(`delete document.documentElement.dataset.ga98Theme; true`);
  } else {
    await session.page.evaluate(`document.documentElement.dataset.ga98Theme = '${value}'; true`);
  }
}

describe('theme.css computed cascade — classic (attribute unset)', () => {
  it('resolves palette tokens and body text to the classic values', async () => {
    await setTheme(null);
    expect(await tokenValue('--ga98-grey')).toBe('#c0c0c0');
    expect(await bodyColor()).toBe('rgb(0, 0, 0)');
  });
});

describe("theme.css computed cascade — amethyst (data-ga98-theme='amethyst')", () => {
  it('flips palette tokens and inherited body text to the amethyst values', async () => {
    await setTheme('amethyst');
    expect(await tokenValue('--ga98-grey')).toBe('#1a1822');
    expect(await tokenValue('--ga98-desktop-bg')).toBe('#0c0a12');
    expect(await bodyColor()).toBe('rgb(207, 201, 221)');
  });
});

describe('theme.css fixed tier — skin-proof across themes', () => {
  it('--ga98-status-error resolves to the SAME value under classic and amethyst', async () => {
    await setTheme(null);
    const classic = await tokenValue('--ga98-status-error');
    await setTheme('amethyst');
    const amethyst = await tokenValue('--ga98-status-error');
    expect(classic).toBe('#e5484d');
    expect(amethyst).toBe(classic);
  });
});
