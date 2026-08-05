// @vitest-environment node
/**
 * CLASSIC PARITY — Task B corrections for over-eager status reroutes.
 *
 * "CLASSIC PARITY IS SACRED": a literal may be routed to a token ONLY if that token's CLASSIC
 * value equals the literal EXACTLY. The module sweep had collapsed three distinct groups into the
 * LOCKED status tier, shifting/losing classic hues:
 *
 *   (1) the password-strength meter's FIVE distinct classic step colours
 *       [#a00000, #c06000, #a0a000, #2080a0, #008000] were flattened onto
 *       error/warning/warning/info/success — losing a step and shifting hues. Restored to five
 *       parity-exact --ga98-pw-* tokens (a DECORATIVE gradient, not the status tier).
 *   (2) semantic greens whose classic value differs from --ga98-status-success (#0a5a2f) —
 *       #008000 (Settings), #006400 (Local AI), #080 (Cases) — restored to parity-exact
 *       --ga98-ok-text / --ga98-ok-text-deep / --ga98-ok-text-fired.
 *   (3) #900 danger captions routed to --ga98-status-error (#9a1621) restored to the existing
 *       parity-exact --ga98-danger-ink (#900).
 *
 * Each token must resolve to its EXACT original classic literal under the DEFAULT (classic) theme.
 * jsdom cannot resolve var(); the standing constraint mandates the CDP-over-ws colour harness
 * against /opt/google/chrome/chrome, mounting within .ga98-window-shell > .window > .window-body.
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
  // (1) password-strength gradient — five distinct classic steps
  { site: 'pw meter step 0 (very weak)', cssVar: '--ga98-pw-vweak', literal: '#a00000', rgb: 'rgb(160, 0, 0)' },
  { site: 'pw meter step 1 (weak)', cssVar: '--ga98-pw-weak', literal: '#c06000', rgb: 'rgb(192, 96, 0)' },
  { site: 'pw meter step 2 (fair)', cssVar: '--ga98-pw-fair', literal: '#a0a000', rgb: 'rgb(160, 160, 0)' },
  { site: 'pw meter step 3 (good)', cssVar: '--ga98-pw-good', literal: '#2080a0', rgb: 'rgb(32, 128, 160)' },
  { site: 'pw meter step 4 (strong)', cssVar: '--ga98-pw-strong', literal: '#008000', rgb: 'rgb(0, 128, 0)' },
  // (2) semantic greens differing from --ga98-status-success (#0a5a2f)
  { site: 'Settings success caption (stored/valid/ok)', cssVar: '--ga98-ok-text', literal: '#008000', rgb: 'rgb(0, 128, 0)' },
  { site: 'Local AI ready caption', cssVar: '--ga98-ok-text-deep', literal: '#006400', rgb: 'rgb(0, 100, 0)' },
  { site: 'Cases alert-rule fired marker', cssVar: '--ga98-ok-text-fired', literal: '#080', rgb: 'rgb(0, 136, 0)' },
  // (3) #900 danger ink — the single parity-exact token every #900 site routes to
  { site: 'danger/error caption ink', cssVar: '--ga98-danger-ink', literal: '#900', rgb: 'rgb(153, 0, 0)' },
  // (4) status-badge inks — original literals differ from the LOCKED status tier
  //     (--ga98-status-error #9a1621 / --ga98-status-warning #6b4600), so routing through it shifted
  //     the classic hue. Parity-exact purpose tokens restore the byte-exact original literal.
  { site: 'X-session Expired badge + status-error text', cssVar: '--ga98-badge-error-ink', literal: '#a00000', rgb: 'rgb(160, 0, 0)' },
  { site: 'X test status inconclusive/warn text', cssVar: '--ga98-badge-warn-ink', literal: '#a06000', rgb: 'rgb(160, 96, 0)' }
];

describe('CLASSIC PARITY (Task B) — corrected tokens resolve to their exact original literal (classic theme)', () => {
  for (const c of CASES) {
    it(`${c.site}: ${c.cssVar} === ${c.literal}`, async () => {
      const got = await resolvedRgb(c.cssVar);
      expect(got, `${c.cssVar} classic = ${got}, expected ${c.rgb} (${c.literal})`).toBe(c.rgb);
    });
  }

  it('the five pw-strength steps are visually distinct (no collapsed/lost step)', async () => {
    const steps = ['--ga98-pw-vweak', '--ga98-pw-weak', '--ga98-pw-fair', '--ga98-pw-good', '--ga98-pw-strong'];
    const rgbs: string[] = [];
    for (const v of steps) rgbs.push(await resolvedRgb(v));
    expect(new Set(rgbs).size, `expected 5 distinct step colours, got ${JSON.stringify(rgbs)}`).toBe(5);
  });

  it('the semantic greens do NOT collapse onto --ga98-status-success (classic #0a5a2f)', async () => {
    const success = await resolvedRgb('--ga98-status-success');
    expect(success).toBe('rgb(10, 90, 47)');
    for (const v of ['--ga98-ok-text', '--ga98-ok-text-deep', '--ga98-ok-text-fired']) {
      const got = await resolvedRgb(v);
      expect(got, `${v} must differ from status-success in classic`).not.toBe(success);
    }
  });

  it('the badge inks do NOT collapse onto the LOCKED status tier in classic (hue not shifted)', async () => {
    // LOCKED tier classic values that the sweep had wrongly routed these badges to.
    expect(await resolvedRgb('--ga98-status-error')).toBe('rgb(154, 22, 33)'); // #9a1621
    expect(await resolvedRgb('--ga98-status-warning')).toBe('rgb(107, 70, 0)'); // #6b4600
    expect(
      await resolvedRgb('--ga98-badge-error-ink'),
      'badge-error-ink must NOT equal status-error (#9a1621) in classic',
    ).not.toBe('rgb(154, 22, 33)');
    expect(
      await resolvedRgb('--ga98-badge-warn-ink'),
      'badge-warn-ink must NOT equal status-warning (#6b4600) in classic',
    ).not.toBe('rgb(107, 70, 0)');
  });
});

/** Relative luminance (WCAG 2.x) of an `rgb(r, g, b)` string. */
function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+/g) ?? ['0', '0', '0']).map(Number).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `rgb()` strings. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('AMETHYST LEGIBILITY (Task B) — badge inks read legibly on the near-black skin', () => {
  beforeAll(async () => {
    await session.page.evaluate(`document.documentElement.dataset.ga98Theme = 'amethyst'`);
  });
  afterAll(async () => {
    await session.page.evaluate(`delete document.documentElement.dataset.ga98Theme`);
  });

  // The amethyst window-body surface these captions sit on (--ga98-grey in the amethyst block).
  const AMETHYST_SURFACE = 'rgb(26, 24, 34)'; // #1a1822

  for (const cssVar of ['--ga98-badge-error-ink', '--ga98-badge-warn-ink']) {
    it(`${cssVar} is legible (>=4.5:1) on the amethyst surface and differs from its classic value`, async () => {
      const amethyst = await resolvedRgb(cssVar);
      const classic = CASES.find((c) => c.cssVar === cssVar)?.rgb;
      expect(amethyst, `${cssVar} must be redefined for amethyst (not the dark classic literal)`).not.toBe(classic);
      const ratio = contrast(amethyst, AMETHYST_SURFACE);
      expect(ratio, `${cssVar} amethyst=${amethyst} contrast ${ratio.toFixed(2)}:1 on ${AMETHYST_SURFACE}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});
