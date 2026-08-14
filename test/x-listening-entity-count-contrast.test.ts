// @vitest-environment node
/**
 * X LISTENING STATION — entity-card "N FINDINGS" count legibility gate.
 *
 * GhostExodus's Enterprise renders the per-entity count as a plain classless `<b>{e.count}
 * FINDINGS</b>` — bright body text on the entity card (his main.tsx:341). Our port must reproduce
 * that: legible bright text on the card ground in BOTH shipped themes.
 *
 * The regression this guards: `.xls-entity-count` was painted with `--ga98-xls-badge-ink` (an amber
 * ink DESIGNED as text on the dark `--ga98-xls-badge-bg` pill). With no pill, that ink lands
 * directly on the entity card ground (`--ga98-grey`), which is silver #c0c0c0 in the classic/light
 * theme — ~1.3:1, illegible. This mounts the real `.xls-entity-card > .xls-entity-count` markup over
 * the real 98.css + theme.css + x-listening.css cascade in headless Chrome (jsdom cannot resolve
 * `var()`; the standing constraint mandates the CDP colour harness) and asserts the count clears
 * WCAG 4.5:1 against its card ground in classic AND amethyst.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const CSS =
  read('node_modules/98.css/dist/98.css') +
  '\n' +
  read('src/renderer/styles/theme.css') +
  '\n' +
  read('src/renderer/modules/x-listening/x-listening.css');

// The real entity-card fragment, mounted under `.xls-root` — its true DOM ancestor in the shipped
// module. `.xls-root` carries the FIXED dark-console token remap (generic --ga98-* → his --ga98-xls-*
// dark palette), so the card ground is the dark #081419 surface in BOTH themes and the count is his
// amber #e0b74d, exactly as it renders. (The harness MUST include this ancestor, per the standing
// window-shell lesson — omitting it would measure the count on the wrong, global ground.)
const DOC =
  '<head><style>' +
  CSS +
  '</style></head><body>' +
  '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  '<div class="xls-root">' +
  '<article class="xls-entity-card" id="card">' +
  '<div class="xls-entity-heading"><div class="xls-entity-headtext">' +
  '<span class="xls-entity-type">mention</span><strong>@target</strong>' +
  '</div></div>' +
  '<b class="xls-entity-count" id="count">42 FINDINGS</b>' +
  '</article>' +
  '</div>' +
  '</div></div></div>' +
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

/** getComputedStyle().color of #count (rendered text colour). */
async function countColor(): Promise<string> {
  return session.page.evaluate<string>(`getComputedStyle(document.getElementById('count')).color`);
}
/** getComputedStyle().backgroundColor of the card ground the count sits on. */
async function cardBg(): Promise<string> {
  return session.page.evaluate<string>(`getComputedStyle(document.getElementById('card')).backgroundColor`);
}

function lin(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function lum([r, g, b]: [number, number, number]): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function parseRgb(s: string): [number, number, number] {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`not an rgb() string: ${s}`);
  const p = m[1].split(',').map((x) => parseFloat(x));
  return [p[0], p[1], p[2]];
}
function contrast(la: number, lb: number): number {
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

describe('X Listening entity-card count — bright & legible on the card ground', () => {
  for (const theme of [null, 'amethyst'] as const) {
    it(`${theme ?? 'classic'}: .xls-entity-count clears 4.5:1 on the entity-card ground`, async () => {
      await setTheme(theme);
      const fg = lum(parseRgb(await countColor()));
      const bg = lum(parseRgb(await cardBg()));
      const r = contrast(fg, bg);
      expect(r, `.xls-entity-count vs .xls-entity-card ground = ${r.toFixed(3)}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});
