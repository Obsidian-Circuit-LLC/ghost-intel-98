/**
 * QUIET AMETHYST — two-tier token map + classic-parity parse guard (plan Task 3, Step 1;
 * rewritten for Amendment 2, 2026-08-05).
 *
 * This is a pure text/parse check of `theme.css` (no browser): it proves the SHAPE of the token
 * layer.
 *
 *  • Skinnable PALETTE tokens live in base `:root` at their exact classic values and are redefined
 *    in the `:root[data-ga98-theme='amethyst']` block at their locked amethyst values.
 *
 *  • The 10 LOCKED status/honesty tokens (Amendment 2) are theme-AWARE but LOCKED: every one must
 *    be defined in BOTH the base `:root` tier AND the amethyst override block. This supersedes the
 *    old "fixed tokens absent from every skin" rule — a single value could not contrast both the
 *    light classic surface and the near-black amethyst surface, so status/honesty colours are now
 *    per-theme. They stay LOCKED via `themes.ts` `LOCKED_TOKENS` (excluded from any user-pack
 *    loader), which is what preserves the charter guarantee that a skin can never recolour or hide
 *    a status/honesty stamp. This test only proves presence-in-both + exact per-theme values here;
 *    the >=4.5:1 legibility of each is proven in theme-contrast.test.ts against real Chrome.
 *
 * (Computed cascade + var() resolution is asserted separately in theme-computed.test.ts against
 * real Chrome — jsdom cannot resolve var(), so colour is never asserted here.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCKED_TOKENS } from '../src/renderer/styles/themes';

// Strip /* … */ comments so a preceding comment never bleeds into the captured selector.
const CSS = readFileSync(join(process.cwd(), 'src/renderer/styles/theme.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

/** The 11 skinnable palette tokens and their exact classic (base) values. */
const CLASSIC_PALETTE: Record<string, string> = {
  '--ga98-desktop-bg': '#008080',
  '--ga98-grey': '#c0c0c0',
  '--ga98-shadow-dark': '#808080',
  '--ga98-shadow-light': '#ffffff',
  '--ga98-shadow-deep': '#000000',
  '--ga98-blue': '#000080',
  '--ga98-titlebar-to': '#1084d0',
  '--ga98-titlebar-text': '#ffffff',
  '--ga98-accent': '#1084d0',
  '--ga98-text': '#000000',
  '--ga98-text-dim': '#3a3a3a'
};

/** The same 11 palette tokens at their locked amethyst values. */
const AMETHYST_PALETTE: Record<string, string> = {
  '--ga98-desktop-bg': '#0c0a12',
  '--ga98-grey': '#1a1822',
  '--ga98-shadow-dark': '#0e0c14',
  '--ga98-shadow-light': '#2c2938',
  '--ga98-shadow-deep': '#000000',
  '--ga98-blue': '#241a33',
  '--ga98-titlebar-to': '#3a2a52',
  '--ga98-titlebar-text': '#efeaff',
  '--ga98-accent': '#9d6bff',
  '--ga98-text': '#cfc9dd',
  '--ga98-text-dim': '#8a86a0'
};

/**
 * The 10 LOCKED status/honesty tokens and their per-theme values.
 *  - status FOREGROUND tokens are theme-AWARE (classic dark → legible on #c0c0c0; amethyst bright
 *    → legible on #1a1822).
 *  - status FILL tokens carry white text in both themes, so they hold one dark value in each block.
 *    Their CLASSIC values are the EXACT original toast title-bar literals (parity is sacred — the
 *    Toaster is the sole classic consumer): info #000080 / success #006400 / warn #8a5a00 /
 *    error #900000. The amethyst block keeps its own white-legible darks (they need not match
 *    classic — white title text is >=4.5:1 on both), so the FILL role is theme-AWARE, not invariant.
 *  - honesty tokens are self-contained and theme-INVARIANT (identical in every block).
 */
const LOCKED_CLASSIC: Record<string, string> = {
  '--ga98-status-error': '#9a1621',
  '--ga98-status-success': '#0a5a2f',
  '--ga98-status-warning': '#6b4600',
  '--ga98-status-info': '#124a8f',
  '--ga98-status-error-fill': '#900000',
  '--ga98-status-success-fill': '#006400',
  '--ga98-status-warning-fill': '#8a5a00',
  '--ga98-status-info-fill': '#000080',
  '--ga98-unverified': '#d9a441',
  '--ga98-unverified-ink': '#0a0f1a'
};
const LOCKED_AMETHYST: Record<string, string> = {
  '--ga98-status-error': '#ff6b70',
  '--ga98-status-success': '#4bd07f',
  '--ga98-status-warning': '#f5b53d',
  '--ga98-status-info': '#6ba9ff',
  '--ga98-status-error-fill': '#a01722',
  '--ga98-status-success-fill': '#0a5c30',
  '--ga98-status-warning-fill': '#7a4f00',
  '--ga98-status-info-fill': '#124a8f',
  '--ga98-unverified': '#d9a441',
  '--ga98-unverified-ink': '#0a0f1a'
};

/** Return the declaration body of the rule whose selector is EXACTLY `selector`. */
function ruleBody(selector: string): string {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS)) !== null) {
    if (m[1].trim() === selector) return m[2];
  }
  throw new Error(`no rule with selector exactly \`${selector}\``);
}

/** Parse `--name: value;` declarations from a rule body into a lower-cased map. */
function declMap(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of body.split(';')) {
    const i = decl.indexOf(':');
    if (i === -1) continue;
    const name = decl.slice(0, i).trim();
    if (!name.startsWith('--')) continue;
    out[name] = decl.slice(i + 1).trim().toLowerCase();
  }
  return out;
}

const base = declMap(ruleBody(':root'));
const amethyst = declMap(ruleBody(":root[data-ga98-theme='amethyst']"));

describe('theme.css token layer — skinnable palette tier', () => {
  it('base :root defines all 11 palette tokens at their exact classic values', () => {
    for (const [name, value] of Object.entries(CLASSIC_PALETTE)) {
      expect(base[name], `base :root must define ${name}`).toBe(value);
    }
  });

  it('amethyst block redefines every palette token at its locked amethyst value', () => {
    for (const [name, value] of Object.entries(AMETHYST_PALETTE)) {
      expect(amethyst[name], `amethyst block must define ${name}`).toBe(value);
    }
  });
});

describe('theme.css token layer — LOCKED status/honesty tier (Amendment 2)', () => {
  it('exports exactly the 10 canonical LOCKED token names', () => {
    expect([...LOCKED_TOKENS].sort()).toEqual(Object.keys(LOCKED_CLASSIC).sort());
  });

  it('defines EVERY LOCKED token in BOTH base :root and the amethyst block', () => {
    for (const name of LOCKED_TOKENS) {
      expect(base[name], `base :root must define locked ${name}`).toBeDefined();
      expect(amethyst[name], `amethyst block must define locked ${name}`).toBeDefined();
    }
  });

  it('holds the exact classic value for each LOCKED token in base :root', () => {
    for (const [name, value] of Object.entries(LOCKED_CLASSIC)) {
      expect(base[name], `base :root ${name}`).toBe(value);
    }
  });

  it('holds the exact amethyst value for each LOCKED token in the amethyst block', () => {
    for (const [name, value] of Object.entries(LOCKED_AMETHYST)) {
      expect(amethyst[name], `amethyst ${name}`).toBe(value);
    }
  });

  it('keeps honesty tokens theme-INVARIANT (identical base + amethyst)', () => {
    for (const name of ['--ga98-unverified', '--ga98-unverified-ink']) {
      expect(amethyst[name], `${name} must be identical across themes`).toBe(base[name]);
    }
  });

  it('keeps status FILL tokens theme-AWARE: classic = exact original toast literal, amethyst = its own dark', () => {
    // Parity is sacred: the classic FILL value must be the byte-exact original toast title-bar
    // literal (asserted against LOCKED_CLASSIC above); the amethyst FILL keeps its own white-legible
    // dark. The two need NOT be equal — white title text stays >=4.5:1 on both (proven in
    // theme-taskp-parity.test.ts). They diverge here precisely because the classic literals were
    // restored.
    for (const name of LOCKED_TOKENS.filter((t) => t.endsWith('-fill'))) {
      expect(base[name], `classic ${name}`).toBe(LOCKED_CLASSIC[name]);
      expect(amethyst[name], `amethyst ${name}`).toBe(LOCKED_AMETHYST[name]);
      expect(amethyst[name], `${name} is theme-aware, classic and amethyst differ`).not.toBe(base[name]);
    }
  });
});
