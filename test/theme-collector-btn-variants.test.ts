// @vitest-environment node
/**
 * QUIET AMETHYST — collector semantic-button-variant COLLAPSE guard.
 *
 * Each of the three collector modules (X · SOCMINT · Searchlight) ships an amethyst-scoped generic
 * button override — `:root[data-ga98-theme='amethyst'] .xc-btn` / `.sm-btn` / `.sl-sweep-btn` — at
 * specificity (0,3,0). The semantic variant classes (`.xc-btn-accept`, `.sm-btn-danger`,
 * `.sl-sweep-btn-primary`, …) are only (0,1,0), so before the fix the generic override outranked
 * them under amethyst and every accept/reject/primary/danger button collapsed to the same grey
 * chrome — losing its meaning. The fix re-asserts each variant at (0,3,0) AFTER the generic rule.
 *
 * This proves, in a REAL Chrome cascade+var engine (jsdom is blind to var()/cascade — standing
 * constraint), mounting within the real `.ga98-window-shell > .window > .window-body` chain over the
 * real stylesheet set, that under amethyst each variant renders a DISTINCT, semantically-correct,
 * legible fill (NOT the generic grey), AND under the default (classic) theme each variant keeps its
 * EXACT original classic colour byte-for-byte.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const CSS = [
  read('node_modules/98.css/dist/98.css'),
  read('src/renderer/styles/theme.css'),
  read('src/renderer/styles/98.overrides.css'),
  read('src/renderer/modules/x/x-collector.css'),
  read('src/renderer/modules/socmint/socmint.css'),
  read('src/renderer/modules/searchlight/searchlight.css')
]
  .map((c) => `<style>${c}</style>`)
  .join('');

// Each variant mounted next to its own generic-base button so the (0,3,0) generic amethyst override
// is live in the cascade — the exact condition under which the collapse occurred.
const MARKUP =
  '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  // X collector
  '<div class="xc-root">' +
  '<button class="xc-btn" id="xc-generic">Generic</button>' +
  '<button class="xc-btn xc-btn-primary" id="xc-primary">Primary</button>' +
  '<button class="xc-btn xc-btn-accept" id="xc-accept">Accept</button>' +
  '<button class="xc-btn xc-btn-reject" id="xc-reject">Reject</button>' +
  '<button class="xc-btn xc-btn-danger" id="xc-danger">Danger</button>' +
  '</div>' +
  // SOCMINT
  '<div class="sm-root">' +
  '<button class="sm-btn" id="sm-generic">Generic</button>' +
  '<button class="sm-btn sm-btn-primary" id="sm-primary">Primary</button>' +
  '<button class="sm-btn sm-btn-accept" id="sm-accept">Accept</button>' +
  '<button class="sm-btn sm-btn-danger" id="sm-danger">Danger</button>' +
  '<button class="sm-btn sm-btn-reject" id="sm-reject">Reject</button>' +
  '</div>' +
  // Searchlight sweep
  '<div class="sl-root">' +
  '<button class="sl-sweep-btn" id="sl-generic">Generic</button>' +
  '<button class="sl-sweep-btn sl-sweep-btn-primary" id="sl-primary">Sweep</button>' +
  '<button class="sl-sweep-btn sl-sweep-btn-danger" id="sl-danger">Stop</button>' +
  '</div>' +
  '</div></div></div>';

const DOC = `<head>${CSS}</head><body>${MARKUP}</body>`;

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

async function bg(id: string): Promise<string> {
  return session.page.evaluate<string>(
    `getComputedStyle(document.getElementById(${JSON.stringify(id)})).backgroundColor`
  );
}
async function fg(id: string): Promise<string> {
  return session.page.evaluate<string>(
    `getComputedStyle(document.getElementById(${JSON.stringify(id)})).color`
  );
}

const rel = (rgb: string): number => {
  const m = rgb.match(/rgba?\(([^)]+)\)/);
  const p = m ? m[1].split(',').map((x) => parseFloat(x)) : [0, 0, 0];
  const a = [p[0], p[1], p[2]].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [rel(a), rel(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// A fill is "red-dominant" / "green-dominant" / "blue-dominant" when that channel clearly leads.
const rgbOf = (s: string): [number, number, number] => {
  const m = s.match(/rgba?\(([^)]+)\)/);
  const p = m ? m[1].split(',').map((x) => parseFloat(x)) : [0, 0, 0];
  return [p[0], p[1], p[2]];
};
const redLeads = (s: string): boolean => {
  const [r, g, b] = rgbOf(s);
  return r > g + 20 && r > b + 20;
};
const greenLeads = (s: string): boolean => {
  const [r, g, b] = rgbOf(s);
  return g > r + 20 && g > b + 10;
};
const blueLeads = (s: string): boolean => {
  const [r, g, b] = rgbOf(s);
  return b > r + 20 && b >= g;
};

// ── CLASSIC PARITY — every variant keeps its exact original classic fill + ink (byte-for-byte) ────
describe('CLASSIC PARITY — variants render their exact classic colour under the default theme', () => {
  beforeAll(async () => { await setTheme(null); });

  const CASES: Array<{ id: string; bg: string; fg: string }> = [
    { id: 'xc-primary', bg: 'rgb(26, 42, 58)', fg: 'rgb(208, 232, 255)' },
    { id: 'xc-accept', bg: 'rgb(26, 74, 26)', fg: 'rgb(216, 255, 216)' },
    { id: 'xc-reject', bg: 'rgb(92, 26, 26)', fg: 'rgb(255, 216, 216)' },
    // PRE-EXISTING CLASSIC QUIRK (out of scope for the amethyst fix, documented here so the byte
    // value is not silently wrong): `.xc-btn-danger` is declared at line 137, BEFORE the `.xc-btn`
    // base (line 181). Both are specificity (0,1,0), so on the composed `xc-btn xc-btn-danger`
    // element the LATER base wins in classic → grey #c0c0c0 fill / black ink. The danger red is
    // therefore already collapsed in classic today; we keep classic byte-for-byte (rules unchanged)
    // and the amethyst rule below still restores the semantic red under the skin.
    { id: 'xc-danger', bg: 'rgb(192, 192, 192)', fg: 'rgb(0, 0, 0)' },
    { id: 'sm-primary', bg: 'rgb(61, 26, 92)', fg: 'rgb(232, 216, 255)' },
    { id: 'sm-accept', bg: 'rgb(26, 74, 26)', fg: 'rgb(216, 255, 216)' },
    { id: 'sm-danger', bg: 'rgb(92, 26, 26)', fg: 'rgb(255, 216, 216)' },
    { id: 'sm-reject', bg: 'rgb(92, 26, 26)', fg: 'rgb(255, 216, 216)' },
    { id: 'sl-primary', bg: 'rgb(0, 0, 128)', fg: 'rgb(255, 255, 255)' }, // classic navy
    { id: 'sl-danger', bg: 'rgb(128, 0, 0)', fg: 'rgb(255, 255, 255)' }   // classic maroon
  ];

  for (const c of CASES) {
    it(`${c.id} — classic bg ${c.bg} / ink ${c.fg}`, async () => {
      expect(await bg(c.id), `${c.id} bg`).toBe(c.bg);
      expect(await fg(c.id), `${c.id} ink`).toBe(c.fg);
    });
  }
});

// ── AMETHYST — variants DO NOT collapse to grey; each is distinct, semantic, legible ──────────────
describe('AMETHYST — variants restore a distinct, semantically-correct, legible fill', () => {
  beforeAll(async () => { await setTheme('amethyst'); });

  it('every variant fill is DISTINCT from the generic grey chrome (no collapse)', async () => {
    const groups: Array<[string, string[]]> = [
      ['xc-generic', ['xc-primary', 'xc-accept', 'xc-reject', 'xc-danger']],
      ['sm-generic', ['sm-primary', 'sm-accept', 'sm-danger', 'sm-reject']],
      ['sl-generic', ['sl-primary', 'sl-danger']]
    ];
    for (const [generic, variants] of groups) {
      const g = await bg(generic);
      for (const v of variants) {
        expect(await bg(v), `${v} must differ from generic grey ${generic}`).not.toBe(g);
      }
    }
  });

  it('accept fills are green-dominant', async () => {
    expect(greenLeads(await bg('xc-accept')), 'xc-accept green').toBe(true);
    expect(greenLeads(await bg('sm-accept')), 'sm-accept green').toBe(true);
  });

  it('reject / danger fills are red-dominant', async () => {
    for (const id of ['xc-reject', 'xc-danger', 'sm-danger', 'sm-reject', 'sl-danger']) {
      expect(redLeads(await bg(id)), `${id} red`).toBe(true);
    }
  });

  it('primary fills are blue/accent (blue channel leads)', async () => {
    expect(blueLeads(await bg('xc-primary')), 'xc-primary blue').toBe(true);
    expect(blueLeads(await bg('sl-primary')), 'sl-primary blue').toBe(true);
    // SOCMINT primary is the accent purple (#3d1a5c) — a violet primary reads as accent, not grey.
    const [r, , b] = rgbOf(await bg('sm-primary'));
    expect(b > r, 'sm-primary violet accent (blue > red)').toBe(true);
  });

  it('each variant carries legible ink on its fill (>= 4.5:1)', async () => {
    for (const id of [
      'xc-primary', 'xc-accept', 'xc-reject', 'xc-danger',
      'sm-primary', 'sm-accept', 'sm-danger', 'sm-reject',
      'sl-primary', 'sl-danger'
    ]) {
      expect(contrast(await fg(id), await bg(id)), `${id} contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the semantic families are mutually distinct (accept != reject != primary)', async () => {
    const accept = await bg('xc-accept');
    const reject = await bg('xc-reject');
    const primary = await bg('xc-primary');
    expect(accept).not.toBe(reject);
    expect(accept).not.toBe(primary);
    expect(reject).not.toBe(primary);
  });
});
