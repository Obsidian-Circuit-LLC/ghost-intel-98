// @vitest-environment node
/**
 * CLASSIC PARITY — Task P: three shell sites that had been routed to the theme-aware LOCKED status
 * tier, shifting their classic colour. Each is restored to a parity-EXACT purpose token whose CLASSIC
 * value equals the original inline literal byte-for-byte, while the amethyst variant stays legible.
 *
 *   (1) Toaster.tsx — the four toast title-bar FILLS (dark backgrounds carrying 98.css WHITE title
 *       text). Original literals info #000080 / success #006400 / warn #8a5a00 / error #900000 had
 *       gone to the LOCKED --ga98-status-*-fill tier (#124a8f / #0a5c30 / #7a4f00 / #a01722), shifting
 *       every classic toast. Restored to DEDICATED --ga98-toast-*-fill purpose tokens (byte-exact
 *       classic literals; amethyst kept white-legible). The LOCKED fill tier is left UNTOUCHED —
 *       "CLASSIC PARITY IS SACRED" forbids bending a LOCKED token to a site literal (badge-ink
 *       precedent: give the site its own parity-exact purpose token).
 *   (2) ModuleErrorBoundary.tsx — the error code-box. Original literals bg #fee / text #900 /
 *       border #c99 (modeled on MapErrorBoundary). Routing text+border to --ga98-status-error
 *       (#9a1621) had shifted the classic hue; restored to the parity-exact MapErrorBoundary trio
 *       --ga98-error-surface / --ga98-danger-ink / --ga98-error-border-soft.
 *   (3) LockScreen.tsx — the unlock-error text. Original literal #a00; routing to --ga98-status-error
 *       (#9a1621) had shifted it. Restored to the sibling --ga98-neg-ink (#a00).
 *
 * Each token must resolve to its EXACT original classic literal under the DEFAULT (classic) theme,
 * and to a legible value under amethyst. jsdom cannot resolve var(); the standing constraint mandates
 * the CDP-over-ws colour harness against /opt/google/chrome/chrome, mounting within
 * .ga98-window-shell > .window > .window-body.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const THEME_CSS = read('src/renderer/styles/theme.css');

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

async function setTheme(value: string | null): Promise<void> {
  if (value === null) {
    await session.page.evaluate(`delete document.documentElement.dataset.ga98Theme; true`);
  } else {
    await session.page.evaluate(`document.documentElement.dataset.ga98Theme = '${value}'; true`);
  }
}

/** Resolve a custom property through the ACTIVE cascade to a computed rgb() string. */
async function resolvedRgb(cssVar: string): Promise<string> {
  return session.page.evaluate<string>(
    `(() => {
       const p = document.getElementById('probe');
       p.style.color = 'var(${cssVar})';
       return getComputedStyle(p).color;
     })()`
  );
}

const WHITE = 'rgb(255, 255, 255)'; // 98.css title-bar text
// The amethyst window-body surface the code-box / error captions sit on (--ga98-grey in amethyst).
const AMETHYST_SURFACE = 'rgb(26, 24, 34)'; // #1a1822

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

// ── (1) Toaster title-bar fills: classic = exact original literal (dedicated purpose tokens) ──────
const TOAST_FILLS: Array<{ kind: string; cssVar: string; literal: string; rgb: string }> = [
  { kind: 'info', cssVar: '--ga98-toast-info-fill', literal: '#000080', rgb: 'rgb(0, 0, 128)' },
  { kind: 'success', cssVar: '--ga98-toast-success-fill', literal: '#006400', rgb: 'rgb(0, 100, 0)' },
  { kind: 'warn', cssVar: '--ga98-toast-warn-fill', literal: '#8a5a00', rgb: 'rgb(138, 90, 0)' },
  { kind: 'error', cssVar: '--ga98-toast-error-fill', literal: '#900000', rgb: 'rgb(144, 0, 0)' }
];

// The LOCKED --ga98-status-*-fill classic values the toast must NOT collapse onto (Amendment-2 tier).
const LOCKED_FILL_CLASSIC: Record<string, string> = {
  info: 'rgb(18, 74, 143)', // #124a8f
  success: 'rgb(10, 92, 48)', // #0a5c30
  warn: 'rgb(122, 79, 0)', // #7a4f00
  error: 'rgb(160, 23, 34)' // #a01722
};

// ── (2)+(3) code-box + unlock-error inks/border/surface: classic = exact original literal ────────
const INKS: Array<{ site: string; cssVar: string; literal: string; rgb: string }> = [
  { site: 'ModuleErrorBoundary code-box bg', cssVar: '--ga98-error-surface', literal: '#fee', rgb: 'rgb(255, 238, 238)' },
  { site: 'ModuleErrorBoundary code-box text', cssVar: '--ga98-danger-ink', literal: '#900', rgb: 'rgb(153, 0, 0)' },
  { site: 'ModuleErrorBoundary code-box border', cssVar: '--ga98-error-border-soft', literal: '#c99', rgb: 'rgb(204, 153, 153)' },
  { site: 'LockScreen unlock-error text', cssVar: '--ga98-neg-ink', literal: '#a00', rgb: 'rgb(170, 0, 0)' }
];

describe('CLASSIC PARITY (Task P) — the three restored shell sites resolve to their exact original literal', () => {
  beforeAll(async () => { await setTheme(null); });

  for (const c of TOAST_FILLS) {
    it(`Toaster ${c.kind} fill: ${c.cssVar} === ${c.literal}`, async () => {
      const got = await resolvedRgb(c.cssVar);
      expect(got, `${c.cssVar} classic = ${got}, expected ${c.rgb} (${c.literal})`).toBe(c.rgb);
    });
  }
  for (const c of INKS) {
    it(`${c.site}: ${c.cssVar} === ${c.literal}`, async () => {
      const got = await resolvedRgb(c.cssVar);
      expect(got, `${c.cssVar} classic = ${got}, expected ${c.rgb} (${c.literal})`).toBe(c.rgb);
    });
  }

  it('the four toast fills do NOT collapse onto the LOCKED --ga98-status-*-fill tier in classic', async () => {
    for (const c of TOAST_FILLS) {
      const toast = await resolvedRgb(c.cssVar);
      expect(
        toast,
        `${c.cssVar} must differ from the LOCKED status-${c.kind}-fill in classic`,
      ).not.toBe(LOCKED_FILL_CLASSIC[c.kind]);
    }
  });

  it('leaves the LOCKED --ga98-status-*-fill tier UNTOUCHED at its Amendment-2 classic values', async () => {
    expect(await resolvedRgb('--ga98-status-info-fill')).toBe(LOCKED_FILL_CLASSIC.info);
    expect(await resolvedRgb('--ga98-status-success-fill')).toBe(LOCKED_FILL_CLASSIC.success);
    expect(await resolvedRgb('--ga98-status-warning-fill')).toBe(LOCKED_FILL_CLASSIC.warn);
    expect(await resolvedRgb('--ga98-status-error-fill')).toBe(LOCKED_FILL_CLASSIC.error);
  });

  it('the code-box + unlock-error inks do NOT collapse onto the LOCKED status tier in classic', async () => {
    expect(await resolvedRgb('--ga98-status-error')).toBe('rgb(154, 22, 33)'); // #9a1621
    expect(
      await resolvedRgb('--ga98-danger-ink'),
      'danger-ink must NOT equal status-error (#9a1621) in classic',
    ).not.toBe('rgb(154, 22, 33)');
    expect(
      await resolvedRgb('--ga98-neg-ink'),
      'neg-ink must NOT equal status-error (#9a1621) in classic',
    ).not.toBe('rgb(154, 22, 33)');
  });

  it('every toast fill carries WHITE 98.css title text legibly in classic (>=4.5:1)', async () => {
    for (const c of TOAST_FILLS) {
      const fill = await resolvedRgb(c.cssVar);
      const ratio = contrast(WHITE, fill);
      expect(ratio, `${c.cssVar} classic=${fill} white-text ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the ModuleErrorBoundary code-box text is legible on its classic error surface (>=4.5:1)', async () => {
    const text = await resolvedRgb('--ga98-danger-ink');
    const surface = await resolvedRgb('--ga98-error-surface');
    const ratio = contrast(text, surface);
    expect(ratio, `danger-ink=${text} on error-surface=${surface} → ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

describe('AMETHYST LEGIBILITY (Task P) — the restored sites stay legible on the near-black skin', () => {
  beforeAll(async () => { await setTheme('amethyst'); });
  afterAll(async () => { await setTheme(null); });

  it('every toast fill keeps WHITE title text legible under amethyst (>=4.5:1)', async () => {
    for (const c of TOAST_FILLS) {
      const fill = await resolvedRgb(c.cssVar);
      const ratio = contrast(WHITE, fill);
      expect(ratio, `${c.cssVar} amethyst=${fill} white-text ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('ModuleErrorBoundary code-box text is legible on its amethyst error surface (>=4.5:1)', async () => {
    const text = await resolvedRgb('--ga98-danger-ink');
    const surface = await resolvedRgb('--ga98-error-surface');
    const ratio = contrast(text, surface);
    expect(ratio, `danger-ink=${text} on error-surface=${surface} → ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it('LockScreen unlock-error text is legible on the amethyst window surface (>=4.5:1)', async () => {
    const text = await resolvedRgb('--ga98-neg-ink');
    const ratio = contrast(text, AMETHYST_SURFACE);
    expect(ratio, `neg-ink=${text} on ${AMETHYST_SURFACE} → ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it('the restored inks are redefined for amethyst (not left at the dark classic literal)', async () => {
    for (const cssVar of ['--ga98-danger-ink', '--ga98-neg-ink']) {
      const amethyst = await resolvedRgb(cssVar);
      const classic = INKS.find((c) => c.cssVar === cssVar)?.rgb;
      expect(amethyst, `${cssVar} must be redefined for amethyst`).not.toBe(classic);
    }
  });
});

// ── source routing: each site references the parity-exact token, none the LOCKED status tier ──────
describe('Task P source routing — each shell site uses its parity-exact purpose token', () => {
  it('ModuleErrorBoundary routes the code-box to danger-ink + error-border-soft + error-surface', () => {
    const src = read('src/renderer/shell/ModuleErrorBoundary.tsx');
    expect(src).toContain('var(--ga98-danger-ink)');
    expect(src).toContain('var(--ga98-error-border-soft)');
    expect(src).toContain('var(--ga98-error-surface)');
    expect(src, 'code-box must not route to the LOCKED status tier').not.toContain('var(--ga98-status-error)');
  });

  it('Toaster routes all four fills to --ga98-toast-*-fill, never the LOCKED status fills', () => {
    const src = read('src/renderer/shell/Toaster.tsx');
    for (const t of ['info', 'success', 'warn', 'error']) {
      expect(src, `toast ${t} fill`).toContain(`var(--ga98-toast-${t}-fill)`);
    }
    expect(src.match(/var\(--ga98-status-\w+-fill\)/), 'Toaster must not use the LOCKED status fills').toBeNull();
  });

  it('LockScreen routes the unlock-error ink to --ga98-neg-ink, not the LOCKED status tier', () => {
    const src = read('src/renderer/shell/LockScreen.tsx');
    expect(src).toContain(`color: 'var(--ga98-neg-ink)'`);
    expect(src, 'unlock error must not route to the LOCKED status tier').not.toContain(
      `color: 'var(--ga98-status-error)'`
    );
  });
});
