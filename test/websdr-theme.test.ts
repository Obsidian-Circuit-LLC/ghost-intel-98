// @vitest-environment node
/**
 * WebSDR Viewer — HIS green console is a FIXED theme (Global Constraint 7).
 *
 * The `--ga98-sdr-*` token namespace is defined ONCE in theme.css's classic `:root` and is
 * deliberately NOT overridden in the `[data-ga98-theme='amethyst']` block, so `.sdr-root` must
 * render his dark-green radio-intelligence palette IDENTICALLY whether the app skin is classic or
 * QUIET AMETHYST (the X-Listening `.xls-root` precedent, but single-valued rather than per-theme).
 *
 * jsdom cannot resolve `var()` (see chrome-computed-style.ts), so this runs the real-Chrome
 * computed-style harness: it mounts theme.css + websdr.css, resolves every colour-valued
 * `--ga98-sdr-*` token to a computed `rgb(...)` under classic, flips `<html data-ga98-theme>` to
 * amethyst, resolves again, and asserts EVERY token is byte-identical across the two themes. It
 * also anchors a few tokens to his exact palette so a silent global re-tint would be caught.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const THEME_CSS = readFileSync(join(process.cwd(), 'src/renderer/styles/theme.css'), 'utf8');
const WEBSDR_CSS = readFileSync(
  join(process.cwd(), 'src/renderer/modules/websdr/websdr.css'),
  'utf8',
);

/** Every colour-valued `--ga98-sdr-*` token name (skip the two font-family tokens). */
function colourTokens(): string[] {
  const names = new Set<string>();
  const re = /(--ga98-sdr-[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(THEME_CSS)) !== null) {
    const value = m[2].trim();
    if (/^#|^rgb/i.test(value)) names.add(m[1]);
  }
  return [...names];
}

const DOC =
  '<head><style>' +
  THEME_CSS +
  '\n' +
  WEBSDR_CSS +
  '</style></head><body>' +
  '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  '<div class="sdr-root"><span id="probe">x</span></div>' +
  '</div></div></div>' +
  '</body>';

let session: ChromeSession;

beforeAll(async () => {
  session = await launchChrome();
  await session.page.setContent(DOC);
  const t = await session.page.evaluate<string | undefined>(
    `document.documentElement.dataset.ga98Theme`,
  );
  expect(t, 'default theme must be classic (no data-ga98-theme)').toBeUndefined();
}, 30000);

afterAll(async () => {
  await session?.close();
});

/** Resolve a batch of tokens to computed rgb() strings under the CURRENT theme. */
async function resolveAll(tokens: string[]): Promise<Record<string, string>> {
  const expr = `(() => {
    const p = document.getElementById('probe');
    const out = {};
    for (const t of ${JSON.stringify(tokens)}) {
      p.style.color = 'var(' + t + ')';
      out[t] = getComputedStyle(p).color;
    }
    return out;
  })()`;
  return session.page.evaluate<Record<string, string>>(expr);
}

describe('WebSDR fixed green console', () => {
  it('defines a substantial --ga98-sdr-* colour token set', () => {
    expect(colourTokens().length).toBeGreaterThan(40);
  });

  it('renders IDENTICALLY under classic and QUIET AMETHYST', async () => {
    const tokens = colourTokens();

    // Classic (default).
    await session.page.evaluate(`document.documentElement.removeAttribute('data-ga98-theme')`);
    const classic = await resolveAll(tokens);

    // Every token resolves to a real colour (not the empty string / an unresolved var).
    for (const t of tokens) {
      expect(classic[t], `${t} resolves under classic`).toMatch(/^rgba?\(/);
    }

    // Flip to amethyst and resolve again.
    await session.page.evaluate(`document.documentElement.dataset.ga98Theme = 'amethyst'`);
    const amethyst = await resolveAll(tokens);

    // The fixed console must be byte-identical across the two skins.
    for (const t of tokens) {
      expect(amethyst[t], `${t} is theme-invariant`).toBe(classic[t]);
    }
  }, 30000);

  it("anchors a few tokens to GhostExodus's exact palette", async () => {
    await session.page.evaluate(`document.documentElement.removeAttribute('data-ga98-theme')`);
    const anchors = await resolveAll([
      '--ga98-sdr-bg',
      '--ga98-sdr-green-bright',
      '--ga98-sdr-ink',
      '--ga98-sdr-mode-active-bg',
    ]);
    expect(anchors['--ga98-sdr-bg']).toBe('rgb(7, 17, 11)'); // #07110b
    expect(anchors['--ga98-sdr-green-bright']).toBe('rgb(92, 255, 129)'); // #5cff81
    expect(anchors['--ga98-sdr-ink']).toBe('rgb(215, 255, 225)'); // #d7ffe1
    expect(anchors['--ga98-sdr-mode-active-bg']).toBe('rgb(66, 214, 106)'); // #42d66a
  }, 30000);
});
