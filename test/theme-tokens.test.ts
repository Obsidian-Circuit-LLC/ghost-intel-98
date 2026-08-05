/**
 * QUIET AMETHYST — two-tier token map + classic-parity parse guard (plan Task 3, Step 1).
 *
 * This is a pure text/parse check of `theme.css` (no browser): it proves the SHAPE of the token
 * layer — that the base `:root` tier defines all 11 skinnable palette tokens at their exact classic
 * values plus all 5 fixed-tier tokens, and that the `:root[data-ga98-theme='amethyst']` override
 * tier redefines every palette token at its locked amethyst value while containing NONE of the
 * fixed tokens. The last clause is the charter-critical two-tier invariant: a skin must never
 * recolour or hide a status/honesty colour, so those tokens live ONLY in base `:root`.
 *
 * (Computed cascade + var() resolution is asserted separately in theme-computed.test.ts against
 * real Chrome — jsdom cannot resolve var(), so colour is never asserted here.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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

/** The 5 fixed-tier tokens (semantic + honesty) — one value, base `:root` only, never in a skin. */
const FIXED_TIER: Record<string, string> = {
  '--ga98-status-error': '#e5484d',
  '--ga98-status-success': '#30a46c',
  '--ga98-status-warning': '#d98a00',
  '--ga98-status-info': '#4c8dff',
  '--ga98-unverified': '#d98a00'
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

describe('theme.css token layer — base :root tier', () => {
  const base = declMap(ruleBody(':root'));

  it('defines all 11 palette tokens at their exact classic values', () => {
    for (const [name, value] of Object.entries(CLASSIC_PALETTE)) {
      expect(base[name], `base :root must define ${name}`).toBe(value);
    }
  });

  it('defines all 5 fixed-tier (semantic + honesty) tokens', () => {
    for (const [name, value] of Object.entries(FIXED_TIER)) {
      expect(base[name], `base :root must define ${name}`).toBe(value);
    }
  });
});

describe("theme.css token layer — :root[data-ga98-theme='amethyst'] override tier", () => {
  const amethyst = declMap(ruleBody(":root[data-ga98-theme='amethyst']"));

  it('redefines every palette token at its locked amethyst value', () => {
    for (const [name, value] of Object.entries(AMETHYST_PALETTE)) {
      expect(amethyst[name], `amethyst block must define ${name}`).toBe(value);
    }
  });

  it('contains NONE of the fixed-tier tokens (two-tier invariant)', () => {
    for (const name of Object.keys(FIXED_TIER)) {
      expect(amethyst[name], `${name} must NOT appear in the amethyst skin`).toBeUndefined();
    }
  });
});
