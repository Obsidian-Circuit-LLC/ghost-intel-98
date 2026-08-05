// @vitest-environment node
/**
 * QUIET AMETHYST — Task 6 module resolution (Cases · Settings · Reports · investigations).
 *
 * Two proofs, both non-tautological:
 *
 *  A. CASCADE (headless Chrome over the REAL theme.css + investigation.css read from disk):
 *     - CLASSIC PARITY: every purpose token this task introduced resolves to its EXACT original
 *       inline literal under the default (classic) theme — no classic colour shifts.
 *     - AMETHYST READABILITY: the same tokens flip to the dark-skin values (dim text → light,
 *       recessed panels/tracks → near-black, navy accents → the glowing accent), and the Reports
 *       chrome + investigation panels render dark with legible text while the printable Reports
 *       "paper" deliberately stays white in BOTH themes (content-intrinsic document).
 *
 *  B. SOURCE WIRING (grep the actual module files on disk): each rerouted site now references the
 *     purpose/status token and no longer carries the raw literal — so reverting any component to a
 *     hardcoded colour fails here even though the token itself still resolves in proof A.
 *
 * jsdom is blind to var()/cascade; the standing constraint mandates the CDP-over-ws Chrome harness,
 * mounting within `.ga98-window-shell > .window > .window-body`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const THEME_CSS = readFileSync(join(ROOT, 'src/renderer/styles/theme.css'), 'utf8');
const INVESTIGATION_CSS = readFileSync(
  join(ROOT, 'src/renderer/modules/investigation-graph/investigation.css'),
  'utf8'
);

const MARKUP =
  '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  '<div class="ga98-report-appshell" id="rep-shell">' +
  '  <div class="ga98-report-panel"><div class="ga98-report-titlebar" id="rep-title">T</div>' +
  '    <div class="ga98-report-nav-leaf" id="rep-leaf">leaf</div></div>' +
  '  <div class="ga98-report-pagescroll" id="rep-scroll">' +
  '    <div class="ga98-report-page" id="rep-page">paper</div></div>' +
  '  <div class="ga98-report-contact-org" id="rep-dim">dim</div>' +
  '</div>' +
  '<div class="investigation-side-panel" id="inv-panel">' +
  '  <div class="run-panel" id="inv-run"><div class="run-panel__title" id="inv-title">x</div>' +
  '    <div class="run-panel__muted" id="inv-muted">muted</div>' +
  '    <ul class="run-panel__feed" id="inv-feed"><li>log</li></ul></div>' +
  '</div>' +
  '<div class="window-body" id="probe">x</div>' +
  '</div></div></div>';

const DOC =
  '<head><style>' + THEME_CSS + '</style><style>' + INVESTIGATION_CSS + '</style></head><body>' +
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

async function lumOf(selector: string, prop: string): Promise<number> {
  return session.page.evaluate<number>(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (!el) throw new Error('no element matches ' + ${JSON.stringify(selector)});
       const m = getComputedStyle(el).getPropertyValue(${JSON.stringify(prop)}).match(/rgba?\\(([^)]+)\\)/);
       const p = m ? m[1].split(',').map((x) => parseFloat(x)) : [255,255,255];
       const a = [p[0],p[1],p[2]].map((v) => { const c = v/255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); });
       return 0.2126*a[0] + 0.7152*a[1] + 0.0722*a[2];
     })()`
  );
}

// --- Proof A1: CLASSIC PARITY — purpose tokens resolve to their exact original literal ------------
const PARITY: Array<{ cssVar: string; literal: string; rgb: string }> = [
  { cssVar: '--ga98-dim-strong', literal: '#444', rgb: 'rgb(68, 68, 68)' },
  { cssVar: '--ga98-dim-mid', literal: '#555', rgb: 'rgb(85, 85, 85)' },
  { cssVar: '--ga98-dim-soft', literal: '#666', rgb: 'rgb(102, 102, 102)' },
  { cssVar: '--ga98-dim-faint', literal: '#888', rgb: 'rgb(136, 136, 136)' },
  { cssVar: '--ga98-dim-hint', literal: '#999', rgb: 'rgb(153, 153, 153)' },
  { cssVar: '--ga98-divider', literal: '#ccc', rgb: 'rgb(204, 204, 204)' },
  { cssVar: '--ga98-track', literal: '#dfdfdf', rgb: 'rgb(223, 223, 223)' },
  { cssVar: '--ga98-row-hover', literal: '#d8d8d8', rgb: 'rgb(216, 216, 216)' },
  { cssVar: '--ga98-hairline', literal: '#b0b0b0', rgb: 'rgb(176, 176, 176)' },
  { cssVar: '--ga98-inset-panel', literal: '#f4f4f4', rgb: 'rgb(244, 244, 244)' },
  { cssVar: '--ga98-inset-border', literal: '#d0d0d0', rgb: 'rgb(208, 208, 208)' },
  { cssVar: '--ga98-navy-accent', literal: '#000080', rgb: 'rgb(0, 0, 128)' }
];

describe('CLASSIC PARITY — Task 6 purpose tokens equal their exact original literal (classic)', () => {
  beforeAll(async () => { await setTheme(null); });
  for (const c of PARITY) {
    it(`${c.cssVar} === ${c.literal}`, async () => {
      expect(await resolvedRgb(c.cssVar)).toBe(c.rgb);
    });
  }
});

// --- Proof A2: AMETHYST READABILITY — tokens flip to the dark-skin values ------------------------
describe('AMETHYST — purpose tokens flip to the near-black skin values', () => {
  beforeAll(async () => { await setTheme('amethyst'); });

  it('every dim-text token resolves to the light dim (--ga98-text-dim #8a86a0)', async () => {
    for (const v of ['--ga98-dim-strong', '--ga98-dim-mid', '--ga98-dim-soft', '--ga98-dim-faint', '--ga98-dim-hint']) {
      expect(await resolvedRgb(v), v).toBe('rgb(138, 134, 160)');
    }
  });
  it('recessed panel + meter track resolve to deep near-black', async () => {
    expect(await resolvedRgb('--ga98-inset-panel')).toBe('rgb(20, 17, 25)');
    expect(await resolvedRgb('--ga98-track')).toBe('rgb(20, 17, 25)');
  });
  it('navy inline accent flips to the glowing amethyst accent', async () => {
    expect(await resolvedRgb('--ga98-navy-accent')).toBe('rgb(157, 107, 255)');
  });
});

// --- Proof A3: Reports + investigation surfaces under amethyst vs classic ------------------------
describe('Reports chrome darkens under amethyst; the printable paper stays white in both', () => {
  it('under amethyst: shell dark, titlebar dark, leaf text light, dim preview light — paper white', async () => {
    await setTheme('amethyst');
    expect(await lumOf('#rep-shell', 'background-color'), 'shell bg dark').toBeLessThan(0.25);
    expect(await lumOf('#rep-title', 'background-color'), 'titlebar dark').toBeLessThan(0.25);
    expect(await lumOf('#rep-scroll', 'background-color'), 'workspace dark').toBeLessThan(0.1);
    expect(await lumOf('#rep-leaf', 'color'), 'nav text light').toBeGreaterThan(0.55);
    expect(await lumOf('#rep-dim', 'color'), 'dim preview still legible').toBeGreaterThan(0.15);
    expect(await lumOf('#rep-page', 'background-color'), 'paper stays white').toBeGreaterThan(0.9);
  });
  it('under classic: shell light silver, paper white (by-design light skin preserved)', async () => {
    await setTheme(null);
    expect(await lumOf('#rep-shell', 'background-color'), 'classic shell light').toBeGreaterThan(0.4);
    expect(await lumOf('#rep-page', 'background-color'), 'classic paper white').toBeGreaterThan(0.9);
  });
});

describe('investigation cockpit side panel darkens under amethyst with legible text', () => {
  it('amethyst: panel + run card dark bg, body text light, muted text still legible', async () => {
    await setTheme('amethyst');
    expect(await lumOf('#inv-panel', 'background-color'), 'panel dark').toBeLessThan(0.25);
    expect(await lumOf('#inv-run', 'background-color'), 'run card dark').toBeLessThan(0.25);
    expect(await lumOf('#inv-title', 'color'), 'title text light').toBeGreaterThan(0.55);
    expect(await lumOf('#inv-muted', 'color'), 'muted text legible').toBeGreaterThan(0.15);
    expect(await lumOf('#inv-feed', 'background-color'), 'feed recessed dark').toBeLessThan(0.1);
  });
  it('classic: side panel stays light silver with dark text', async () => {
    await setTheme(null);
    expect(await lumOf('#inv-panel', 'background-color'), 'classic panel light').toBeGreaterThan(0.4);
    expect(await lumOf('#inv-title', 'color'), 'classic title dark').toBeLessThan(0.1);
  });
});

// --- Proof B: SOURCE WIRING — the module files reference the tokens, not the old literals --------
describe('SOURCE WIRING — rerouted module sites reference tokens, not raw literals', () => {
  const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
  it('SettingsModule routes dim text + status + track to tokens', () => {
    const s = read('src/renderer/modules/settings/SettingsModule.tsx');
    expect(s).toContain('var(--ga98-dim-strong)');
    // Error/status sites route to the parity-exact purpose tokens (danger-ink #900,
    // badge-error-ink #a00000) — NOT the LOCKED status tier, whose classic value
    // differs and would shift classic. See theme-taskb-parity.
    expect(s).toContain('var(--ga98-danger-ink)');
    expect(s).toContain('var(--ga98-track)');
    expect(s).not.toMatch(/color: '#444'/);
    expect(s).not.toMatch(/color: '#900'/);
  });
  it('Cases modules route greys / inset panels / navy accent to tokens', () => {
    const c = read('src/renderer/modules/cases/CasesModule.tsx');
    expect(c).toContain('var(--ga98-dim-soft)');
    expect(c).toContain('var(--ga98-row-hover)');
    expect(read('src/renderer/modules/cases/EntitiesSection.tsx')).toContain('var(--ga98-inset-panel)');
    expect(read('src/renderer/modules/cases/BioImagesSection.tsx')).toContain('var(--ga98-navy-accent)');
    expect(read('src/renderer/modules/cases/CaseDetail.tsx')).toContain('var(--ga98-navy-accent)');
  });
  it('investigation.css routes body text off the raw #000', () => {
    const inv = read('src/renderer/modules/investigation-graph/investigation.css');
    expect(inv).toContain('color: var(--ga98-text)');
    expect(inv).not.toMatch(/color: #000;/);
  });
});
