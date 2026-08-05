// @vitest-environment node
/**
 * QUIET AMETHYST — LOCKED status/honesty contrast gate (Amendment 2, 2026-08-05).
 *
 * Amendment 2 makes the status/honesty tokens theme-AWARE but LOCKED, and REQUIRES each to be
 * legible on its own surface. This is that legibility gate, run against the REAL `theme.css`
 * cascade through headless Chrome (jsdom cannot resolve `var()`; the standing constraint mandates
 * the CDP-over-ws colour harness against /opt/google/chrome/chrome). The probe mounts within the
 * required `.ga98-window-shell > .window > .window-body` ancestor chain.
 *
 * Asserts, per the design's contrast gate (WCAG >= 4.5:1):
 *   - each status FOREGROUND token vs its theme surface (classic #c0c0c0, amethyst #1a1822);
 *   - each status FILL token vs white #ffffff (chips/toast title-bars carry white 98.css text);
 *   - --ga98-unverified-ink vs the resolved --ga98-unverified amber (self-contained badge).
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

const CLASSIC_SURFACE = '#c0c0c0';
const AMETHYST_SURFACE = '#1a1822';
const WHITE = '#ffffff';

const STATUS_KINDS = ['error', 'success', 'warning', 'info'] as const;

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

/** Resolve a custom property through the real cascade to an rgb() string via a rendered probe. */
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
function lumFromRgbTriplet([r, g, b]: [number, number, number]): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function parseRgb(s: string): [number, number, number] {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`not an rgb() string: ${s}`);
  const p = m[1].split(',').map((x) => parseFloat(x));
  return [p[0], p[1], p[2]];
}
function parseHex(h: string): [number, number, number] {
  const x = h.replace('#', '');
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}
function contrast(la: number, lb: number): number {
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
async function ratioVar(cssVar: string, surfaceHex: string): Promise<number> {
  const fg = lumFromRgbTriplet(parseRgb(await resolvedRgb(cssVar)));
  const bg = lumFromRgbTriplet(parseHex(surfaceHex));
  return contrast(fg, bg);
}

describe('LOCKED status FOREGROUND tokens — legible on their theme surface (>= 4.5:1)', () => {
  it('classic: each status FG token clears 4.5:1 on #c0c0c0', async () => {
    await setTheme(null);
    for (const kind of STATUS_KINDS) {
      const r = await ratioVar(`--ga98-status-${kind}`, CLASSIC_SURFACE);
      expect(r, `--ga98-status-${kind} on ${CLASSIC_SURFACE} = ${r.toFixed(3)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('amethyst: each status FG token clears 4.5:1 on #1a1822', async () => {
    await setTheme('amethyst');
    for (const kind of STATUS_KINDS) {
      const r = await ratioVar(`--ga98-status-${kind}`, AMETHYST_SURFACE);
      expect(r, `--ga98-status-${kind} on ${AMETHYST_SURFACE} = ${r.toFixed(3)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('LOCKED status FILL tokens — white text safe (>= 4.5:1 vs #ffffff)', () => {
  for (const theme of [null, 'amethyst'] as const) {
    it(`${theme ?? 'classic'}: each -fill token clears 4.5:1 against white`, async () => {
      await setTheme(theme);
      for (const kind of STATUS_KINDS) {
        const r = await ratioVar(`--ga98-status-${kind}-fill`, WHITE);
        expect(r, `--ga98-status-${kind}-fill vs #ffffff = ${r.toFixed(3)}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

describe('LOCKED honesty tokens — badge ink legible on its own amber (>= 4.5:1)', () => {
  for (const theme of [null, 'amethyst'] as const) {
    it(`${theme ?? 'classic'}: --ga98-unverified-ink vs --ga98-unverified clears 4.5:1`, async () => {
      await setTheme(theme);
      const ink = lumFromRgbTriplet(parseRgb(await resolvedRgb('--ga98-unverified-ink')));
      const amber = lumFromRgbTriplet(parseRgb(await resolvedRgb('--ga98-unverified')));
      const r = contrast(ink, amber);
      expect(r, `ink vs amber = ${r.toFixed(3)}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});
