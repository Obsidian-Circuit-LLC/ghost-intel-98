// @vitest-environment node
/**
 * Weather tool — computed-style theme guard (Phase 2). Runs the REAL theme.css + weather.css through
 * headless Chrome (jsdom cannot resolve var()) and asserts the module's key surfaces are token-driven
 * so they follow BOTH the classic skin and QUIET AMETHYST — i.e. the module is a normal native tool,
 * not a fixed bespoke theme. Mirrors theme-computed.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const THEME_CSS = readFileSync(join(process.cwd(), 'src/renderer/styles/theme.css'), 'utf8');
const WEATHER_CSS = readFileSync(join(process.cwd(), 'src/renderer/modules/weather/weather.css'), 'utf8');

// A representative slice of the module's real markup, mounted inside the mandated window-shell chain.
const DOC =
  '<head><style>' + THEME_CSS + '\n' + WEATHER_CSS + '</style></head><body>' +
  '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  '<div class="ga98-weather" id="wroot">' +
  '  <div class="ga98-weather-side"><ul class="ga98-weather-locs">' +
  '    <li class="ga98-weather-loc is-selected" id="loc"><button class="ga98-weather-loc-pick">Paris</button></li>' +
  '  </ul></div>' +
  '  <div class="ga98-weather-main">' +
  '    <div class="ga98-weather-egress is-tor" id="egress-tor"><strong>TOR MODE</strong></div>' +
  '    <div class="ga98-weather-egress is-clearnet" id="egress-clear"><strong>CLEARNET</strong></div>' +
  '    <div class="ga98-weather-current" id="current"><span class="ga98-weather-current-temp">21°C</span></div>' +
  '    <div class="ga98-weather-daily"><div class="ga98-weather-day" id="day"><span>Mon</span></div></div>' +
  '  </div>' +
  '</div></div></div></div></body>';

let session: ChromeSession;

beforeAll(async () => {
  session = await launchChrome();
  await session.page.setContent(DOC);
}, 30000);

afterAll(async () => {
  await session?.close();
});

async function bg(id: string): Promise<string> {
  return session.page.evaluate<string>(`getComputedStyle(document.getElementById('${id}')).backgroundColor`);
}
async function fg(id: string): Promise<string> {
  return session.page.evaluate<string>(`getComputedStyle(document.getElementById('${id}')).color`);
}
async function setTheme(value: string | null): Promise<void> {
  if (value === null) await session.page.evaluate(`delete document.documentElement.dataset.ga98Theme; true`);
  else await session.page.evaluate(`document.documentElement.dataset.ga98Theme = '${value}'; true`);
}

describe('weather.css — classic skin', () => {
  it('paints the module surface + text from the classic palette tokens', async () => {
    await setTheme(null);
    // --ga98-grey classic = #c0c0c0
    expect(await bg('wroot')).toBe('rgb(192, 192, 192)');
    // --ga98-text classic = black
    expect(await fg('wroot')).toBe('rgb(0, 0, 0)');
    // the Tor-safe marker uses the shared tor-ok box (classic #dcefe2)
    expect(await bg('egress-tor')).toBe('rgb(220, 239, 226)');
  });
});

describe('weather.css — QUIET AMETHYST skin', () => {
  it('flips every module surface to the amethyst tokens (nothing hardcoded)', async () => {
    // capture the classic values first, then flip.
    await setTheme(null);
    const cRoot = await bg('wroot');
    const cText = await fg('wroot');
    const cTor = await bg('egress-tor');
    const cClear = await bg('egress-clear');
    const cCurrent = await bg('current');

    await setTheme('amethyst');
    // --ga98-grey amethyst = #1a1822
    expect(await bg('wroot')).toBe('rgb(26, 24, 34)');
    // every surface differs from its classic value → it is token-driven, not a literal
    expect(await fg('wroot')).not.toBe(cText);
    expect(await bg('wroot')).not.toBe(cRoot);
    expect(await bg('egress-tor')).not.toBe(cTor);
    expect(await bg('egress-clear')).not.toBe(cClear);
    expect(await bg('current')).not.toBe(cCurrent);
  });

  it('the clearnet marker is visibly distinct from the Tor marker under amethyst', async () => {
    await setTheme('amethyst');
    expect(await bg('egress-clear')).not.toBe(await bg('egress-tor'));
  });
});
