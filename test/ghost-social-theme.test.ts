// @vitest-environment node
/**
 * Ghost Social Media Manager (hardened port) — his TEAL console is a FIXED theme (constraint 10).
 *
 * Proof, over the REAL theme.css + ghost-social.css read from disk, via the headless-Chrome
 * computed-style harness (jsdom is blind to var()/cascade): `.gsm-root` and its inner surfaces
 * resolve to GhostExodus's exact teal-console literals, and — critically — resolve IDENTICALLY
 * under the default (classic) theme AND under QUIET AMETHYST (`data-ga98-theme='amethyst'`). The
 * `--ga98-gsm-*` tokens are defined ONLY in the base :root and never re-mapped in the amethyst
 * block, so the module wears his console, never the app skin.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const THEME_CSS = readFileSync(join(ROOT, 'src/renderer/styles/theme.css'), 'utf8');
const GSM_CSS = readFileSync(join(ROOT, 'src/renderer/modules/ghost-social/ghost-social.css'), 'utf8');

const MARKUP =
  '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  '<div class="gsm-root" id="gsmroot"><div class="gsm-shell" id="shell">' +
  '<aside class="gsm-sidebar" id="sidebar"></aside>' +
  '<main class="gsm-main"><div class="gsm-panel" id="panel"></div>' +
  '<button class="gsm-primary" id="primary">GO</button>' +
  '<span class="gsm-armed-marker" id="armed"><span></span>ARMED</span>' +
  '</main></div></div>' +
  '</div></div></div>';

const DOC =
  '<head><style>' + THEME_CSS + '</style><style>' + GSM_CSS + '</style></head><body>' + MARKUP + '</body>';

let session: ChromeSession;

beforeAll(async () => {
  session = await launchChrome();
  await session.page.setContent(DOC);
}, 30000);

afterAll(async () => { await session?.close(); });

async function setTheme(value: string | null): Promise<void> {
  if (value === null) await session.page.evaluate(`delete document.documentElement.dataset.ga98Theme; true`);
  else await session.page.evaluate(`document.documentElement.dataset.ga98Theme = '${value}'; true`);
}

async function styleOf(selector: string, prop: string): Promise<string> {
  return session.page.evaluate<string>(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) throw new Error('no element ' + ${JSON.stringify(selector)});
       return getComputedStyle(el).getPropertyValue(${JSON.stringify(prop)}); })()`
  );
}

// His exact console literals (src/styles.css), as computed rgb().
const EXPECT: Array<{ sel: string; prop: string; rgb: string; what: string }> = [
  { sel: '#gsmroot', prop: 'background-color', rgb: 'rgb(7, 11, 13)', what: 'deep ground #070b0d' },
  { sel: '#gsmroot', prop: 'color', rgb: 'rgb(215, 227, 227)', what: 'primary ink #d7e3e3' },
  { sel: '#sidebar', prop: 'background-color', rgb: 'rgb(9, 16, 19)', what: 'sidebar #091013' },
  { sel: '#panel', prop: 'background-color', rgb: 'rgb(10, 16, 18)', what: 'panel #0a1012' },
  { sel: '#primary', prop: 'background-color', rgb: 'rgb(82, 221, 185)', what: 'teal action #52ddb9' },
  { sel: '#primary', prop: 'color', rgb: 'rgb(6, 16, 14)', what: 'teal ink #06100e' },
];

describe('Ghost Social — his teal console renders under classic', () => {
  beforeAll(async () => { await setTheme(null); });
  for (const c of EXPECT) {
    it(`${c.what} (${c.sel} ${c.prop})`, async () => {
      expect(await styleOf(c.sel, c.prop)).toBe(c.rgb);
    });
  }
});

describe('Ghost Social — the teal console is IDENTICAL under QUIET AMETHYST (fixed theme)', () => {
  it('every surface resolves byte-for-byte the same classic vs amethyst', async () => {
    await setTheme(null);
    const classic: Record<string, string> = {};
    for (const c of EXPECT) classic[`${c.sel}:${c.prop}`] = await styleOf(c.sel, c.prop);
    await setTheme('amethyst');
    for (const c of EXPECT) {
      const amethyst = await styleOf(c.sel, c.prop);
      expect(amethyst).toBe(classic[`${c.sel}:${c.prop}`]);
      expect(amethyst).toBe(c.rgb);
    }
  });
});
