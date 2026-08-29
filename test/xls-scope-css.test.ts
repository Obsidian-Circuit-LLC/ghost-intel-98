// @vitest-environment node
/**
 * Confining GhostExodus's stylesheet to his module.
 *
 * THE v3.73.0 REGRESSION. His `styles.css` was written for a standalone app, so it styles global
 * element selectors — `*`, `html, body, #root`, `button`, `input, select, textarea`, `nav`, `main`,
 * `h1`–`h3`, `label`, `::-webkit-scrollbar`. Importing it into Ghost Intel 98's renderer applied
 * all of that to the WHOLE APP: gold gradient buttons everywhere, dark text fields with pale text
 * on light surfaces (his "text colour for actual text input"), and a Case Manager whose layout
 * collapsed into itself.
 *
 * The plan said his stylesheet ships "verbatim, scoped under his root class". It shipped verbatim
 * and unscoped, and the fidelity test I wrote pinned the unscoped version in place.
 *
 * His file is not edited — it stays byte-identical to his original — and is instead transformed at
 * mount time by this function. The rules that matter:
 *
 *   - his app-root selectors (`:root`, `html`, `body`, `#root`) BECOME the module root: in his app
 *     they meant "the whole surface", and inside ours that surface is his container
 *   - everything else is prefixed, so it can only ever match inside his subtree
 *   - `@media` blocks are descended into; the at-rule itself is not prefixed
 *   - `@keyframes` bodies are left completely alone — `from`/`to`/`50%` are not selectors
 */
import { describe, expect, it } from 'vitest';
import { scopeCss } from '../src/shared/xls/scope-css';

const S = '.xls-embed-root';

describe('scopeCss', () => {
  it('prefixes a plain element selector so it cannot escape the module', () => {
    expect(scopeCss('button { color: red; }', S)).toContain(`${S} button {`);
  });

  it('scopes EVERY selector in a comma-separated list', () => {
    const out = scopeCss('button, input, select { font: inherit; }', S);
    expect(out).toContain(`${S} button`);
    expect(out).toContain(`${S} input`);
    expect(out).toContain(`${S} select`);
    // …and nothing is left bare, which is what leaked into the whole app.
    expect(out).not.toMatch(/(^|,)\s*button\s*[,{]/);
  });

  it('turns his app-root selectors into the module root itself', () => {
    // `body { background: … }` must paint HIS panel, not Ghost Intel 98's desktop.
    for (const root of [':root', 'html', 'body', '#root']) {
      const out = scopeCss(`${root} { background: black; }`, S);
      expect(out, root).toContain(`${S} {`);
      expect(out, root).not.toMatch(/(^|\s)(html|body|:root|#root)\s*\{/);
    }
  });

  it('collapses his combined root rule to a single scoped rule', () => {
    const out = scopeCss('html, body, #root { height: 100%; }', S);
    expect(out.match(new RegExp(S.replace('.', '\\.'), 'g'))?.length).toBe(1);
  });

  it('scopes the universal selector to his subtree, including his container', () => {
    const out = scopeCss('* { box-sizing: border-box; }', S);
    expect(out).toContain(`${S},`);
    expect(out).toContain(`${S} *`);
  });

  it('scopes bare pseudo-elements like his scrollbar styling', () => {
    const out = scopeCss('::-webkit-scrollbar { width: 10px; }', S);
    expect(out).toContain(`${S} ::-webkit-scrollbar`);
  });

  it('keeps a pseudo-class attached to the element it qualifies', () => {
    const out = scopeCss('button:hover:not(:disabled) { opacity: .9; }', S);
    expect(out).toContain(`${S} button:hover:not(:disabled)`);
  });

  it('descends into @media without prefixing the at-rule', () => {
    const out = scopeCss('@media (max-width: 700px) { nav { display: none; } }', S);
    expect(out).toContain('@media (max-width: 700px)');
    expect(out).toContain(`${S} nav`);
    expect(out).not.toContain(`${S} @media`);
  });

  it('leaves @keyframes bodies untouched — from/to are not selectors', () => {
    const out = scopeCss('@keyframes spin { from { opacity: 0 } to { opacity: 1 } }', S);
    expect(out).toContain('@keyframes spin');
    expect(out).not.toContain(`${S} from`);
    expect(out).not.toContain(`${S} to`);
  });

  it('passes through at-rules that have no selectors', () => {
    const out = scopeCss('@font-face { font-family: X; src: url(a.woff2); }', S);
    expect(out).toContain('@font-face');
    expect(out).not.toContain(`${S} @font-face`);
  });

  it('does not double-scope something already inside the module', () => {
    const out = scopeCss(`${S} .panel { color: red; }`, S);
    expect(out.match(new RegExp(S.replace('.', '\\.'), 'g'))?.length).toBe(1);
  });

  it('preserves declarations exactly, including urls and gradients with braces', () => {
    const css = 'button { background: linear-gradient(180deg, #e8c461, #bd8b25); }';
    expect(scopeCss(css, S)).toContain('linear-gradient(180deg, #e8c461, #bd8b25)');
  });
});

describe('his actual stylesheet, once scoped', () => {
  const css = readFileSync(
    join(process.cwd(), 'src/renderer/modules/x-listening-embed/station.css'),
    'utf8'
  );
  const scoped = scopeCss(css, S);

  it('leaves NO global element rule that could restyle the app', () => {
    // The exact shapes that leaked: a rule whose selector starts at column 0 with a bare element.
    const leaks = scoped
      .split('\n')
      .filter((l) => /^\s*(button|input|select|textarea|label|nav|main|aside|h[1-6]|p|table|body|html|\*)\s*[,{]/.test(l));
    expect(leaks, `still global: ${leaks.join(' | ')}`).toEqual([]);
  });

  it('still contains his styling — scoping must not have eaten the sheet', () => {
    expect(scoped).toContain('linear-gradient');
    expect(scoped.length).toBeGreaterThan(css.length * 0.9);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
