// @vitest-environment node
/**
 * QUIET AMETHYST — the select dropdown arrow must be drawn ONCE, right-anchored.
 *
 * FIELD REPORT (GhostExodus, 2026-08-18): "the Quiet Amethyst theme does not properly show the
 * font in some of these drop down menus". It is not a font fault — the arrow TILES across the
 * whole control and the option text renders underneath the tiled chevrons.
 *
 * MECHANISM (measured, not inferred): 98.css draws the select arrow with three longhands —
 * `background-image`, `background-position: top 2px right 2px`, `background-repeat: no-repeat` —
 * on the ELEMENT selector `select` (specificity 0,0,1). Five module classes that land on a
 * `<select>` set the `background` SHORTHAND (`.xls-input`, `.gsm-select`, `.sm-input`,
 * `.sl-graph-import-select`, `.ga98-cdp-field`); a shorthand RESETS every background longhand it
 * omits, and a class (0,1,0) beats the element rule — so position/repeat fall back to
 * `0% 0%` / `repeat` and the image is wiped. Under CLASSIC that is invisible (no image => no
 * arrow at all). Under AMETHYST the override re-supplies `background-image` at (0,2,1) to get a
 * light chevron onto the dark field — resurrecting the image into a cascade whose repeat and
 * position were already destroyed. Result: a chevron tiled from the top-left, over the text.
 *
 * The fix restores the two longhands alongside the image in the amethyst rule, so the arrow is
 * placed correctly regardless of which module class wiped them. Amethyst-only: classic shows no
 * arrow on these controls today and that shipped appearance is deliberately left untouched.
 *
 * jsdom resolves no cascade and no var(); this MUST measure in real Chrome.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const CSS =
  read('node_modules/98.css/dist/98.css') +
  read('src/renderer/styles/theme.css') +
  read('src/renderer/styles/98.overrides.css') +
  read('src/renderer/modules/x-listening/x-listening.css') +
  read('src/renderer/modules/ghost-social/ghost-social.css') +
  read('src/renderer/modules/socmint/socmint.css') +
  read('src/renderer/modules/searchlight/searchlight.css');

/** Every select-bearing class whose rule sets the `background` shorthand, plus an unclassed baseline. */
const SELECTS: ReadonlyArray<{ id: string; className: string }> = [
  { id: 'plain', className: '' },
  { id: 'xls', className: 'xls-input xls-dock-select' },
  { id: 'gsm', className: 'gsm-select' },
  { id: 'sm', className: 'sm-input' },
  { id: 'sl', className: 'sl-graph-import-select' },
  { id: 'cdp', className: 'ga98-cdp-field ga98-cdp-select' },
];

const DOC =
  '<head><style>' +
  CSS +
  '</style></head><body><div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  SELECTS.map(
    (s) =>
      `<select id="${s.id}" class="${s.className}"><option>Operation Midnight</option></select>`
  ).join('') +
  '</div></div></div></body>';

let session: ChromeSession;

beforeAll(async () => {
  session = await launchChrome();
  await session.page.setContent(DOC);
  await session.page.evaluate(`document.documentElement.dataset.ga98Theme = 'amethyst'`);
  const active = await session.page.evaluate<string | undefined>(
    `document.documentElement.dataset.ga98Theme`
  );
  expect(active, 'amethyst skin must be active for this measurement').toBe('amethyst');
}, 30000);

afterAll(async () => {
  await session?.close();
});

function measure(id: string) {
  return session.page.evaluate<{ repeat: string; position: string; hasImage: boolean }>(
    `(() => {
      const c = getComputedStyle(document.getElementById(${JSON.stringify(id)}));
      return {
        repeat: c.backgroundRepeat,
        position: c.backgroundPosition,
        hasImage: c.backgroundImage !== 'none',
      };
    })()`
  );
}

describe('QUIET AMETHYST select dropdown arrow', () => {
  for (const { id, className } of SELECTS) {
    const label = className || '(unclassed select)';

    it(`draws the arrow once on ${label}`, async () => {
      const got = await measure(id);
      expect(got.hasImage, 'amethyst must supply a light chevron on dark').toBe(true);
      // `repeat` tiles the chevron across the control and buries the option text.
      expect(got.repeat).toBe('no-repeat');
    });

    it(`anchors the arrow to the right edge on ${label}`, async () => {
      const got = await measure(id);
      // 98.css places it `top 2px right 2px` (Chrome normalises to `calc(100% - 2px) 2px`); a
      // shorthand reset leaves `0% 0%` — the chevron lands on the first characters of the text.
      expect(got.position).toBe('calc(100% - 2px) 2px');
    });

    it(`reserves room so the option text never runs under the arrow on ${label}`, async () => {
      // The same module shorthands also carry a `padding` shorthand (e.g. `.xls-input`'s
      // `padding: 5px 8px`), which overrides 98.css's `padding-right: 32px` — the reservation
      // that keeps text clear of the arrow. Measured at 300px with a 68-char campaign name, the
      // text ran UNDER the chevron. The chevron is 16px wide inset 2px, so it occupies the
      // rightmost 18px; anything less than that is a collision.
      const pr = await session.page.evaluate<number>(
        `parseFloat(getComputedStyle(document.getElementById(${JSON.stringify(id)})).paddingRight)`
      );
      expect(pr).toBeGreaterThanOrEqual(20);
    });
  }
});
