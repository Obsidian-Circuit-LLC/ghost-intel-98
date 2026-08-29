// @vitest-environment node
/**
 * The button-colour override must be INERT until someone chooses a colour.
 *
 * First attempt used `background-color: var(--ga98-btn-face, initial)`. For background-color
 * `initial` is TRANSPARENT, not "leave the cascade alone" — so with no colour chosen the rule
 * silently overrode 98.css's silver face and every button in the app went transparent. Nothing in
 * the unit tests could see it; it was caught by measuring the default in a real browser.
 *
 * The rule is therefore gated on a root attribute that only exists when an override is set.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';
import { buttonInk } from '../src/shared/theme/button-color';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const CSS =
  read('node_modules/98.css/dist/98.css') +
  read('src/renderer/styles/theme.css') +
  read('src/renderer/styles/98.overrides.css');

let session: ChromeSession;

beforeAll(async () => {
  session = await launchChrome();
  await session.page.setContent(
    '<head><style>' + CSS + '</style></head><body>' +
    '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
    '<button id="b">Open Notepad…</button></div></div></div></body>'
  );
}, 30000);

afterAll(async () => { await session?.close(); });

const face = () => session.page.evaluate<string>(`getComputedStyle(document.getElementById('b')).backgroundColor`);
const ink = () => session.page.evaluate<string>(`getComputedStyle(document.getElementById('b')).color`);

async function setOverride(hex: string | null) {
  await session.page.evaluate(
    hex
      ? `document.documentElement.dataset.ga98Btn='';
         document.documentElement.style.setProperty('--ga98-btn-face','${hex}');
         document.documentElement.style.setProperty('--ga98-btn-ink','${buttonInk(hex)}');`
      : `delete document.documentElement.dataset.ga98Btn;
         document.documentElement.style.removeProperty('--ga98-btn-face');
         document.documentElement.style.removeProperty('--ga98-btn-ink');`
  );
}

describe('button colour override', () => {
  it('leaves the classic silver face alone when nothing is chosen', async () => {
    await setOverride(null);
    expect(await face()).toBe('rgb(192, 192, 192)');
    // The specific regression: NOT transparent.
    expect(await face()).not.toBe('rgba(0, 0, 0, 0)');
  });

  it('paints the chosen face with dark ink on a light colour', async () => {
    await setOverride('#e8c461');
    expect(await face()).toBe('rgb(232, 196, 97)');
    expect(await ink()).toBe('rgb(0, 0, 0)');
  });

  it('paints the chosen face with light ink on a dark colour', async () => {
    await setOverride('#2a1a4a');
    expect(await face()).toBe('rgb(42, 26, 74)');
    expect(await ink()).toBe('rgb(255, 255, 255)');
  });

  it('returns to silver when reset to default', async () => {
    await setOverride('#e8c461');
    await setOverride(null);
    expect(await face()).toBe('rgb(192, 192, 192)');
  });
});
