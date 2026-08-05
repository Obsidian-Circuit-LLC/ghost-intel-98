// @vitest-environment node
/**
 * QUIET AMETHYST — Task 9 readability proof for the dim-text sites the no-straggler
 * guard forced to resolve. The genuine dark-on-dark bugs were dim helper/caption
 * text that hardcoded a mid-grey (`#666`/`#555`/`#404040`…): legible on the classic
 * light window, invisible on the amethyst near-black one. Each was routed to a
 * theme-aware token (`--ga98-dim-*` → `var(--ga98-text-dim)` under amethyst, or an
 * explicit amethyst reroute for the self-consistent Searchlight console labels).
 *
 * This mounts the REAL theme.css + searchlight.css over headless Chrome (jsdom is
 * blind to var()/cascade — standing constraint) inside the
 * `.ga98-window-shell > .window > .window-body` ancestor chain, and proves:
 *   • under amethyst the dim text resolves LIGHT (legible on the dark body),
 *   • under classic the SAME text keeps its original dark value (parity),
 *   • the reminders highlight row keeps DARK text so it is never light-on-yellow.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const THEME_CSS = read('src/renderer/styles/theme.css');
const SEARCHLIGHT_CSS = read('src/renderer/modules/searchlight/searchlight.css');

const MARKUP =
  '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  // a mail read-pane empty/caption line (MailModule "No messages" / "Select a message")
  '<div class="ga98-pane"><span id="mail-dim" style="color: var(--ga98-dim-soft)">No messages</span></div>' +
  // the markets "off by default" notice (#555 → --ga98-dim-mid)
  '<p id="mkt-notice" style="color: var(--ga98-dim-mid)">Off by default — no quote is fetched…</p>' +
  // the searchlight graph-props labels (self-consistent #0a0a14 console; classic #404040/#606060,
  // amethyst reroute to --ga98-text-dim)
  '<div class="sl-graph-props"><span class="sl-graph-props-type-label" id="sl-type">Type</span>' +
  '<span class="sl-graph-props-field-label" id="sl-field">Field</span></div>' +
  // the reminders highlight row — yellow flash with explicit dark text
  '<ul class="ga98-list"><li id="rem-hl" style="background: #ffff00; color: #000">Reminder</li></ul>' +
  '</div></div></div>';

const DOC =
  '<head><style>' + THEME_CSS + '</style><style>' + SEARCHLIGHT_CSS + '</style></head><body>' +
  MARKUP + '</body>';

let session: ChromeSession;

beforeAll(async () => {
  session = await launchChrome();
  await session.page.setContent(DOC);
}, 30000);

afterAll(async () => {
  await session?.close();
});

async function setTheme(value: string | null): Promise<void> {
  await session.page.evaluate(
    value === null
      ? `delete document.documentElement.dataset.ga98Theme; true`
      : `document.documentElement.dataset.ga98Theme = '${value}'; true`,
  );
}

async function lumOf(selector: string, prop: string): Promise<number> {
  return session.page.evaluate<number>(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) throw new Error('no element matches ' + ${JSON.stringify(selector)});
       const m = getComputedStyle(el).getPropertyValue(${JSON.stringify(prop)}).match(/rgba?\\(([^)]+)\\)/);
       const p = m ? m[1].split(',').map((x) => parseFloat(x)) : [255,255,255];
       const a = [p[0],p[1],p[2]].map((v) => { const c = v/255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); });
       return 0.2126*a[0] + 0.7152*a[1] + 0.0722*a[2];
     })()`,
  );
}

// Read a colour's luminance under each theme so a site proves BOTH that its
// amethyst value is a legible light dim AND that it got meaningfully lighter than
// its (parity-preserved) classic value — a single absolute floor can't separate a
// dark mid-grey (#666 ≈ 0.13) from the light dim token (≈ 0.24).
async function dimAcrossThemes(selector: string): Promise<{ classic: number; amethyst: number }> {
  await setTheme(null);
  const classic = await lumOf(selector, 'color');
  await setTheme('amethyst');
  const amethyst = await lumOf(selector, 'color');
  return { classic, amethyst };
}

describe('AMETHYST — Task 9 dim text resolves LIGHT and gets lighter than classic', () => {
  it('mail read-pane caption: light dim under amethyst, darker under classic (parity)', async () => {
    const { classic, amethyst } = await dimAcrossThemes('#mail-dim');
    expect(amethyst, 'mail dim light under amethyst').toBeGreaterThan(0.18);
    expect(amethyst - classic, 'mail dim lighter than classic').toBeGreaterThan(0.05);
  });
  it('markets notice: light dim under amethyst, darker under classic (parity)', async () => {
    const { classic, amethyst } = await dimAcrossThemes('#mkt-notice');
    expect(amethyst, 'markets notice light under amethyst').toBeGreaterThan(0.18);
    expect(amethyst - classic, 'markets notice lighter than classic').toBeGreaterThan(0.05);
  });
  it('searchlight graph-props labels: amethyst reroute lights them on the #0a0a14 console', async () => {
    const type = await dimAcrossThemes('#sl-type');
    const field = await dimAcrossThemes('#sl-field');
    expect(type.amethyst, 'type-label light under amethyst').toBeGreaterThan(0.18);
    expect(field.amethyst, 'field-label light under amethyst').toBeGreaterThan(0.18);
    // classic keeps its dark #404040/#606060 literal — the reroute is amethyst-only
    expect(type.amethyst - type.classic, 'type-label lighter under amethyst').toBeGreaterThan(0.05);
    expect(field.amethyst - field.classic, 'field-label lighter under amethyst').toBeGreaterThan(0.05);
  });
});

describe('REMINDERS highlight — dark text on the yellow flash in BOTH themes', () => {
  it('never renders light-on-yellow', async () => {
    await setTheme('amethyst');
    expect(await lumOf('#rem-hl', 'color'), 'amethyst highlight text dark').toBeLessThan(0.05);
    await setTheme(null);
    expect(await lumOf('#rem-hl', 'color'), 'classic highlight text dark').toBeLessThan(0.05);
  });
});
