// @vitest-environment node
/**
 * CLASSIC PARITY — five inline-style literals routed to purpose tokens (Fix task 2).
 *
 * "CLASSIC PARITY IS SACRED": any literal routed to a token must land on a token whose CLASSIC
 * value equals the original literal EXACTLY. These five sites use INLINE styles (which a stylesheet
 * rule cannot override), so each routes through a purpose token whose base `:root` (classic) value
 * is the original literal; the amethyst block redefines it for the near-black skin.
 *
 * This asserts each token resolves to its EXACT original classic literal under the DEFAULT (classic)
 * theme — no `data-ga98-theme` set. jsdom cannot resolve `var()`; the standing constraint mandates
 * the CDP-over-ws colour harness against /opt/google/chrome/chrome, mounting within the
 * `.ga98-window-shell > .window > .window-body` ancestor chain.
 *
 *   ClockWidget analog second hand        #c00000  -> --ga98-clock-secondhand
 *   LockScreen bgconn inset bevel         #404040  -> --ga98-lock-bevel
 *   ModuleErrorBoundary code-block bg     #ffeeee  -> --ga98-status-error-tint
 *   AccessMenu flyout `outset` highlight  #f5f5f5  -> --ga98-flyout-outset
 *   Welcome first-step helper text        #444444  -> --ga98-welcome-helper
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const THEME_CSS = readFileSync(join(process.cwd(), 'src/renderer/styles/theme.css'), 'utf8');

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
  // DEFAULT theme = classic: assert no skin is active (base :root cascade only).
  const t = await session.page.evaluate<string | undefined>(
    `document.documentElement.dataset.ga98Theme`
  );
  expect(t, 'default theme must be classic (no data-ga98-theme)').toBeUndefined();
}, 30000);

afterAll(async () => {
  await session?.close();
});

/** Resolve a custom property through the classic cascade to a computed rgb() string. */
async function resolvedRgb(cssVar: string): Promise<string> {
  return session.page.evaluate<string>(
    `(() => {
       const p = document.getElementById('probe');
       p.style.color = 'var(${cssVar})';
       return getComputedStyle(p).color;
     })()`
  );
}

const CASES: Array<{ site: string; cssVar: string; literal: string; rgb: string }> = [
  { site: 'ClockWidget analog second hand', cssVar: '--ga98-clock-secondhand', literal: '#c00000', rgb: 'rgb(192, 0, 0)' },
  { site: 'LockScreen bgconn inset bevel', cssVar: '--ga98-lock-bevel', literal: '#404040', rgb: 'rgb(64, 64, 64)' },
  { site: 'ModuleErrorBoundary code-block bg', cssVar: '--ga98-status-error-tint', literal: '#ffeeee', rgb: 'rgb(255, 238, 238)' },
  { site: 'AccessMenu flyout outset highlight', cssVar: '--ga98-flyout-outset', literal: '#f5f5f5', rgb: 'rgb(245, 245, 245)' },
  { site: 'Welcome first-step helper text', cssVar: '--ga98-welcome-helper', literal: '#444444', rgb: 'rgb(68, 68, 68)' }
];

describe('CLASSIC PARITY — purpose tokens resolve to their exact original literal (classic theme)', () => {
  for (const c of CASES) {
    it(`${c.site}: ${c.cssVar} === ${c.literal}`, async () => {
      const got = await resolvedRgb(c.cssVar);
      expect(got, `${c.cssVar} classic = ${got}, expected ${c.rgb} (${c.literal})`).toBe(c.rgb);
    });
  }
});
