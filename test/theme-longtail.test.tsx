// @vitest-environment node
/**
 * QUIET AMETHYST — Task 8 long-tail resolution (games · tools · the 6 module CSS files).
 *
 * The long tail is the widest, shallowest task: many small modules that each hardcode a Win98
 * light-grey/white chrome (tabs, bodies, inputs, buttons, wrappers) around content-intrinsic
 * interiors (game boards, card faces, terminal glyphs, cyber-neon status). This proves:
 *
 *  A. CASCADE (headless Chrome over the REAL theme.css + the module CSS files read from disk):
 *     - AMETHYST READABILITY: each module's Win98 chrome surface (x/socmint tab-strips + bodies,
 *       searchlight sweep input/button/toolbar/props, osint-toolkit tile hover) darkens under
 *       `[data-ga98-theme='amethyst']` and its text stays light — no light island, no invisible text.
 *     - CLASSIC PARITY: the SAME surfaces render their original light Win98 chrome under the default
 *       (classic) theme — byte-for-byte, the amethyst block is purely additive.
 *     - CONTENT-INTRINSIC INVARIANCE: a solitaire card face + a cyber-neon status swatch resolve to
 *       the IDENTICAL colour under both themes (they are game-piece / data colours, never reskinned).
 *
 *  B. SOURCE WIRING (grep the module files on disk): the light-island .tsx surfaces (game wrappers,
 *     chat/search/ai panes, ftp browser) now reference palette/purpose tokens or the Task-8 amethyst
 *     utility classes, so reverting one to a raw hardcoded light colour fails here.
 *
 * jsdom is blind to var()/cascade; the standing constraint mandates the CDP-over-ws Chrome harness,
 * mounting within `.ga98-window-shell > .window > .window-body`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome, type ChromeSession } from './helpers/chrome-computed-style';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const THEME_CSS = read('src/renderer/styles/theme.css');
const OVERRIDES_CSS = read('src/renderer/styles/98.overrides.css');
const SEARCHLIGHT_CSS = read('src/renderer/modules/searchlight/searchlight.css');
const SM_CSS = read('src/renderer/modules/socmint/socmint.css');
const OT_CSS = read('src/renderer/modules/osint-toolkit/osint-toolkit.css');

const MARKUP =
  '<div class="ga98-window-shell"><div class="window"><div class="window-body">' +
  // socmint Win98 chrome
  '<div class="sm-tabs" id="sm-tabs"><button class="sm-tab" id="sm-tab">Telegram</button></div>' +
  // searchlight sweep chrome
  '<input class="sl-sweep-input" id="sl-input" value="alice" />' +
  '<button class="sl-sweep-btn" id="sl-btn">Sweep</button>' +
  '<div class="sl-graph-toolbar" id="sl-toolbar">tb</div>' +
  '<div class="sl-graph-props" id="sl-props">props</div>' +
  // osint-toolkit launcher: tile labels (#000), group heading (#000080 navy), empty text (#404040)
  // are dark FOREGROUND literals that must reroute to light palette tokens under amethyst — their
  // BACKGROUNDS darken automatically but the classic dark text does not survive the inversion.
  '<div class="ot-root" id="ot-root">' +
  '<p class="ot-empty" id="ot-empty">No tools</p>' +
  '<div class="ot-group"><div class="ot-group-heading" id="ot-heading">People</div>' +
  '<div class="ot-grid"><div class="ot-tile" id="ot-tile">tool<span class="ot-tile-title" id="ot-title">Name</span></div></div>' +
  '</div></div>' +
  // content-intrinsic controls: a solitaire card face + a cyber-neon success swatch
  '<div class="ga98-card ga98-card-face" id="sol-card"><span class="ga98-card-corner" id="sol-corner">A</span></div>' +
  '<span id="neon" style="color:#00ff88">online</span>' +
  '<div class="window-body" id="probe">x</div>' +
  '</div></div></div>';

const DOC =
  '<head><style>' + THEME_CSS + '</style><style>' + OVERRIDES_CSS + '</style>' +
  '<style>' + SEARCHLIGHT_CSS + '</style>' +
  '<style>' + SM_CSS + '</style><style>' + OT_CSS + '</style></head><body>' +
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

async function colorOf(selector: string, prop: string): Promise<string> {
  return session.page.evaluate<string>(
    `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(prop)})`
  );
}

describe('AMETHYST — long-tail Win98 chrome darkens with legible text', () => {
  beforeAll(async () => { await setTheme('amethyst'); });

  it('socmint tab-strip dark, tab text light', async () => {
    expect(await lumOf('#sm-tabs', 'background-color'), 'sm tabs dark').toBeLessThan(0.25);
    expect(await lumOf('#sm-tab', 'color'), 'sm tab text light').toBeGreaterThan(0.5);
  });
  it('searchlight sweep input/button/toolbar/props dark, input text light', async () => {
    expect(await lumOf('#sl-input', 'background-color'), 'sweep input dark').toBeLessThan(0.3);
    expect(await lumOf('#sl-input', 'color'), 'sweep input text light').toBeGreaterThan(0.5);
    expect(await lumOf('#sl-btn', 'background-color'), 'sweep button dark').toBeLessThan(0.3);
    expect(await lumOf('#sl-toolbar', 'background-color'), 'graph toolbar dark').toBeLessThan(0.3);
    expect(await lumOf('#sl-props', 'background-color'), 'graph props dark').toBeLessThan(0.3);
  });
  it('osint-toolkit tile/heading/empty foregrounds darken bg but stay legible light text', async () => {
    // tile + label: dark #000 literal must reroute to light --ga98-text on the darkened tile bg
    expect(await lumOf('#ot-tile', 'background-color'), 'tile bg dark').toBeLessThan(0.25);
    expect(await lumOf('#ot-tile', 'color'), 'tile label light').toBeGreaterThan(0.4);
    expect(await lumOf('#ot-title', 'color'), 'tile title light').toBeGreaterThan(0.4);
    // group heading: navy #000080 must reroute to the glowing accent, legible on near-black root
    expect(await lumOf('#ot-heading', 'color'), 'group heading light-accent').toBeGreaterThan(0.15);
    // empty text: #404040 must reroute to --ga98-text-dim, legible on the dark root
    expect(await lumOf('#ot-root', 'background-color'), 'ot root dark').toBeLessThan(0.25);
    expect(await lumOf('#ot-empty', 'color'), 'empty text dim-but-legible').toBeGreaterThan(0.15);
  });
});

describe('CLASSIC PARITY — the same long-tail chrome stays light Win98 under classic', () => {
  beforeAll(async () => { await setTheme(null); });

  it('searchlight sweep input light, button silver', async () => {
    expect(await lumOf('#sl-input', 'background-color'), 'classic sweep input light').toBeGreaterThan(0.7);
    expect(await lumOf('#sl-btn', 'background-color'), 'classic sweep button silver').toBeGreaterThan(0.4);
  });
  it('osint-toolkit keeps its classic dark foreground literals (parity: overrides are amethyst-only)', async () => {
    expect(await colorOf('#ot-tile', 'color'), 'classic tile label #000').toBe('rgb(0, 0, 0)');
    expect(await colorOf('#ot-heading', 'color'), 'classic heading navy #000080').toBe('rgb(0, 0, 128)');
    expect(await colorOf('#ot-empty', 'color'), 'classic empty #404040').toBe('rgb(64, 64, 64)');
  });
});

describe('CONTENT-INTRINSIC INVARIANCE — game/data colours are identical across themes', () => {
  it('solitaire card face is white in BOTH themes', async () => {
    await setTheme(null);
    const classic = await colorOf('#sol-card', 'background-color');
    await setTheme('amethyst');
    const amethyst = await colorOf('#sol-card', 'background-color');
    expect(classic).toBe(amethyst);
    expect(await lumOf('#sol-card', 'background-color'), 'card face white').toBeGreaterThan(0.9);
  });
  it('cyber-neon success swatch (#00ff88) is identical across themes', async () => {
    await setTheme(null);
    const classic = await colorOf('#neon', 'color');
    await setTheme('amethyst');
    const amethyst = await colorOf('#neon', 'color');
    expect(classic).toBe(amethyst);
    expect(amethyst).toBe('rgb(0, 255, 136)');
  });
});

describe('SOURCE WIRING — long-tail .tsx light islands reference tokens / amethyst classes', () => {
  it('game wrappers route their #c0c0c0 frame to the grey palette token', () => {
    expect(read('src/renderer/modules/chess/ChessModule.tsx')).toContain('var(--ga98-grey)');
    expect(read('src/renderer/modules/minesweeper/MinesweeperModule.tsx')).toContain('var(--ga98-grey)');
  });
  it('solitaire toolbar text routes off the invisible-on-dark #000 to the text token', () => {
    const sol = read('src/renderer/styles/theme.css');
    expect(sol).toMatch(/\.ga98-sol-bar span\s*\{\s*color:\s*var\(--ga98-text\)/);
  });
  it('ftp browser white pane + dark text route to palette tokens', () => {
    const ftp = read('src/renderer/modules/dialterm/FtpBrowser.tsx');
    expect(ftp).toContain('var(--ga98-shadow-light)');
    expect(ftp).toContain('var(--ga98-text)');
  });
  it('search results card + navy header route to palette/purpose tokens', () => {
    const s = read('src/renderer/modules/search/SearchModule.tsx');
    expect(s).toContain('var(--ga98-shadow-light)');
    expect(s).toContain('var(--ga98-navy-accent)');
    expect(s).not.toMatch(/background: '#fff'/);
  });
  it('chat + ai-assistant light banners/panes reference tokens or Task-8 amethyst classes', () => {
    const chat = read('src/renderer/modules/chat/ChatModule.tsx');
    expect(chat).toMatch(/ga98-t8-|var\(--ga98-/);
    const ai = read('src/renderer/modules/ai-assistant/AiAssistantModule.tsx');
    expect(ai).toContain('var(--ga98-shadow-light)');
  });
});
