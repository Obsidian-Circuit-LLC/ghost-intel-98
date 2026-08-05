// @vitest-environment node
/**
 * HONESTY badge ink — theme-INVARIANT + legible (Fix task 1).
 *
 * The GeoINT "AI · unverified" badge (EventDetailsPanel.tsx) paints `--ga98-unverified-ink` on
 * `--ga98-unverified`. Both are self-contained honesty tokens: they must resolve to the SAME dark
 * ink on the SAME amber in BOTH themes (a status/honesty stamp can never be recoloured or hidden
 * by a skin), and the ink must clear WCAG 4.5:1 on that amber.
 *
 * jsdom cannot resolve `var()`; the standing constraint mandates the CDP-over-ws colour harness
 * against /opt/google/chrome/chrome, mounting within the `.ga98-window-shell > .window >
 * .window-body` ancestor chain.
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

async function resolvedRgb(cssVar: string): Promise<string> {
  return session.page.evaluate<string>(
    `(() => {
       const p = document.getElementById('probe');
       p.style.color = 'var(${cssVar})';
       return getComputedStyle(p).color;
     })()`
  );
}

function lin(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function parseRgb(s: string): [number, number, number] {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`not an rgb() string: ${s}`);
  const p = m[1].split(',').map((x) => parseFloat(x));
  return [p[0], p[1], p[2]];
}
function lum(s: string): number {
  const [r, g, b] = parseRgb(s);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

describe('HONESTY badge ink — theme-invariant + legible on its amber', () => {
  it('ink + amber resolve to the SAME value under classic and amethyst', async () => {
    await setTheme(null);
    const inkClassic = await resolvedRgb('--ga98-unverified-ink');
    const amberClassic = await resolvedRgb('--ga98-unverified');
    await setTheme('amethyst');
    const inkAmethyst = await resolvedRgb('--ga98-unverified-ink');
    const amberAmethyst = await resolvedRgb('--ga98-unverified');

    // Theme-invariant: a skin cannot recolour the honesty stamp.
    expect(inkAmethyst, `ink classic=${inkClassic} amethyst=${inkAmethyst}`).toBe(inkClassic);
    expect(amberAmethyst, `amber classic=${amberClassic} amethyst=${amberAmethyst}`).toBe(amberClassic);
    // And the ink is the dark ink (#0a0f1a → rgb(10, 15, 26)), not var(--ga98-text).
    expect(inkClassic).toBe('rgb(10, 15, 26)');
  });

  it('ink clears 4.5:1 on the amber in BOTH themes', async () => {
    for (const theme of [null, 'amethyst'] as const) {
      await setTheme(theme);
      const r = contrast(lum(await resolvedRgb('--ga98-unverified-ink')), lum(await resolvedRgb('--ga98-unverified')));
      expect(r, `${theme ?? 'classic'}: ink vs amber = ${r.toFixed(3)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
