// @vitest-environment node
/**
 * QUIET AMETHYST — Task 7 module resolution (Searchlight · GeoINT).
 *
 * Three proofs, all non-tautological, over the REAL theme.css + searchlight.css read from disk,
 * via the CDP-over-ws headless-Chrome computed-style harness (jsdom is blind to var()/cascade),
 * mounting within `.ga98-window-shell > .window > .window-body`.
 *
 *  A. CLASSIC PARITY — every Task 7 purpose token resolves to its EXACT original inline literal
 *     under the default (classic) theme, so classic renders byte-for-byte. Under amethyst the same
 *     tokens flip to light-on-dark values.
 *
 *  B. CONTENT-INTRINSIC INVARIANCE — a GeoINT map severity/category swatch (`#c0392b`) and the
 *     honesty stamp (`--ga98-unverified` bg + `--ga98-unverified-ink`) resolve IDENTICALLY under
 *     both themes: a skin must never recolour a data-layer colour or a honesty marker.
 *
 *  C. READABILITY + SOURCE WIRING — the Searchlight shell is dark with legible text under amethyst
 *     (its grey tab chrome darkens); the GeoINT command panel's rerouted inline sites reference the
 *     purpose/status tokens on disk and no longer carry the raw literal.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const THEME_CSS = readFileSync(join(ROOT, 'src/renderer/styles/theme.css'), 'utf8');
const SEARCHLIGHT_CSS = readFileSync(
  join(ROOT, 'src/renderer/modules/searchlight/searchlight.css'),
  'utf8'
);

const MARKUP =
  '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  // GeoINT content-intrinsic severity swatch (hardcoded on purpose) + honesty stamp
  '<span id="sev" style="background:#c0392b;color:#fff">RANSOMWARE</span>' +
  '<span id="badge" style="color:var(--ga98-unverified-ink);background:var(--ga98-unverified)">AI · unverified</span>' +
  // Searchlight shell (styled by searchlight.css)
  '<div class="sl-root" id="sl-root"><div class="sl-tabs" id="sl-tabs">' +
  '<button class="sl-tab sl-tab-active">Sweep</button></div>' +
  '<div class="sl-body" id="sl-body">results</div></div>' +
  '<div class="window-body" id="probe">x</div>' +
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
  if (value === null) {
    await session.page.evaluate(`delete document.documentElement.dataset.ga98Theme; true`);
  } else {
    await session.page.evaluate(`document.documentElement.dataset.ga98Theme = '${value}'; true`);
  }
}

/** Resolve a custom property through the live cascade to a computed rgb() string. */
async function resolvedRgb(cssVar: string): Promise<string> {
  return session.page.evaluate<string>(
    `(() => { const p = document.getElementById('probe');
       p.style.color = 'var(${cssVar})';
       return getComputedStyle(p).color; })()`
  );
}

async function styleOf(selector: string, prop: string): Promise<string> {
  return session.page.evaluate<string>(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) throw new Error('no element ' + ${JSON.stringify(selector)});
       return getComputedStyle(el).getPropertyValue(${JSON.stringify(prop)}); })()`
  );
}

async function lumOf(selector: string, prop: string): Promise<number> {
  const raw = await styleOf(selector, prop);
  const m = raw.match(/rgba?\(([^)]+)\)/);
  const p = m ? m[1].split(',').map((x) => parseFloat(x)) : [255, 255, 255];
  const a = [p[0], p[1], p[2]].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

// --- Proof A: CLASSIC PARITY + amethyst flip ----------------------------------------------------
const PARITY: Array<{ cssVar: string; literal: string; rgb: string }> = [
  { cssVar: '--ga98-dim-deep', literal: '#333', rgb: 'rgb(51, 51, 51)' },
  { cssVar: '--ga98-dim-cap', literal: '#777', rgb: 'rgb(119, 119, 119)' },
  { cssVar: '--ga98-danger-ink', literal: '#900', rgb: 'rgb(153, 0, 0)' },
  { cssVar: '--ga98-ok-dot', literal: '#060', rgb: 'rgb(0, 102, 0)' },
  { cssVar: '--ga98-error-surface', literal: '#fee', rgb: 'rgb(255, 238, 238)' },
  { cssVar: '--ga98-error-border', literal: '#c00', rgb: 'rgb(204, 0, 0)' },
  { cssVar: '--ga98-error-border-soft', literal: '#c99', rgb: 'rgb(204, 153, 153)' },
  { cssVar: '--ga98-ok-surface', literal: '#bfe0bf', rgb: 'rgb(191, 224, 191)' },
  { cssVar: '--ga98-ok-ink', literal: '#003300', rgb: 'rgb(0, 51, 0)' }
];

describe('CLASSIC PARITY — Task 7 purpose tokens equal their exact original literal (classic)', () => {
  beforeAll(async () => { await setTheme(null); });
  for (const c of PARITY) {
    it(`${c.cssVar} === ${c.literal}`, async () => {
      expect(await resolvedRgb(c.cssVar)).toBe(c.rgb);
    });
  }
});

describe('AMETHYST — Task 7 purpose tokens flip to light-on-dark values', () => {
  beforeAll(async () => { await setTheme('amethyst'); });
  it('dim text tokens resolve to the light dim (--ga98-text-dim #8a86a0)', async () => {
    for (const v of ['--ga98-dim-deep', '--ga98-dim-cap']) {
      expect(await resolvedRgb(v), v).toBe('rgb(138, 134, 160)');
    }
  });
  it('danger/ok ink flip light so status text stays legible on near-black', async () => {
    expect(await lumOf('#probe', 'color')).toBeDefined();
    expect(await resolvedRgb('--ga98-danger-ink')).toBe('rgb(255, 138, 138)');
    expect(await resolvedRgb('--ga98-ok-dot')).toBe('rgb(111, 220, 154)');
    expect(await resolvedRgb('--ga98-ok-ink')).toBe('rgb(127, 214, 160)');
  });
  it('error/ok surfaces flip to deep fills', async () => {
    for (const v of ['--ga98-error-surface', '--ga98-ok-surface']) {
      // probe bg via a fresh element luminance check
      await session.page.evaluate(
        `document.getElementById('probe').style.background = 'var(${v})'; true`
      );
      expect(await lumOf('#probe', 'background-color'), v).toBeLessThan(0.06);
    }
    await session.page.evaluate(`document.getElementById('probe').style.background = ''; true`);
  });
});

// --- Proof B: CONTENT-INTRINSIC INVARIANCE ------------------------------------------------------
describe('content-intrinsic + honesty colours resolve IDENTICALLY across themes', () => {
  it('GeoINT severity swatch (#c0392b) is byte-identical classic vs amethyst', async () => {
    await setTheme(null);
    const classic = await styleOf('#sev', 'background-color');
    await setTheme('amethyst');
    const amethyst = await styleOf('#sev', 'background-color');
    expect(amethyst).toBe(classic);
    expect(classic).toBe('rgb(192, 57, 43)');
  });
  it('honesty stamp bg + ink are byte-identical classic vs amethyst (LOCKED tier)', async () => {
    await setTheme(null);
    const cBg = await styleOf('#badge', 'background-color');
    const cInk = await styleOf('#badge', 'color');
    await setTheme('amethyst');
    expect(await styleOf('#badge', 'background-color')).toBe(cBg);
    expect(await styleOf('#badge', 'color')).toBe(cInk);
  });
});

// --- Proof C: READABILITY (Searchlight) + SOURCE WIRING -----------------------------------------
describe('Searchlight shell dark + legible under amethyst; grey tab chrome darkens', () => {
  it('amethyst: body dark, body text light, tab chrome darkens off classic silver', async () => {
    await setTheme('amethyst');
    expect(await lumOf('#sl-body', 'background-color'), 'body dark').toBeLessThan(0.1);
    expect(await lumOf('#sl-body', 'color'), 'body text light').toBeGreaterThan(0.55);
    expect(await lumOf('#sl-tabs', 'background-color'), 'tab bar dark').toBeLessThan(0.25);
  });
  it('classic: body already dark (self-consistent), tab bar light silver', async () => {
    await setTheme(null);
    expect(await lumOf('#sl-body', 'background-color'), 'body dark in classic too').toBeLessThan(0.1);
    expect(await lumOf('#sl-tabs', 'background-color'), 'classic tab bar light').toBeGreaterThan(0.4);
  });
});

describe('SOURCE WIRING — GeoINT sites reference tokens, not raw literals', () => {
  const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
  it('GeoIntModule routes dim text / danger / error box / success toggle to tokens', () => {
    const g = read('src/renderer/modules/geoint/GeoIntModule.tsx');
    expect(g).toContain('var(--ga98-dim-mid)');
    expect(g).toContain('var(--ga98-dim-cap)');
    expect(g).toContain('var(--ga98-danger-ink)');
    expect(g).toContain('var(--ga98-error-surface)');
    expect(g).toContain('var(--ga98-ok-surface)');
    expect(g).toContain('var(--ga98-navy-accent)');
    expect(g).not.toMatch(/color: '#555'/);
    expect(g).not.toMatch(/color: '#777'/);
    expect(g).not.toMatch(/color: '#900'/);
    // content-intrinsic category colours stay hardcoded (NOT tokenised)
    expect(g).toContain('#c0392b');
    expect(g).toContain('#8e44ad');
  });
  it('MapErrorBoundary / StoryControls / TimelineBar / SaveEventDialog / NewsViewModule route to tokens', () => {
    expect(read('src/renderer/modules/geoint/MapErrorBoundary.tsx')).toContain('var(--ga98-error-surface)');
    expect(read('src/renderer/modules/geoint/StoryControls.tsx')).toContain('var(--ga98-dim-deep)');
    expect(read('src/renderer/modules/geoint/TimelineBar.tsx')).toContain('var(--ga98-dim-deep)');
    expect(read('src/renderer/modules/geoint/SaveEventDialog.tsx')).toContain('var(--ga98-dim-mid)');
    expect(read('src/renderer/modules/geoint/NewsViewModule.tsx')).toContain('var(--ga98-shadow-dark)');
    expect(read('src/renderer/modules/geoint/livefeeds/LiveFeedsPanel.tsx')).toContain('var(--ga98-dim-mid)');
    expect(read('src/renderer/modules/geoint/satellites/SatelliteManager.tsx')).toContain('var(--ga98-danger-ink)');
  });
  it('searchlight.css routes the grey tab chrome to palette tokens', () => {
    const sl = read('src/renderer/modules/searchlight/searchlight.css');
    expect(sl).toContain('var(--ga98-grey)');
    expect(sl).toContain('var(--ga98-shadow-dark)');
  });
});
