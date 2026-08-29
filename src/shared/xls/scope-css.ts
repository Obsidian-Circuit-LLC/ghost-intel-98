/**
 * Confine GhostExodus's stylesheet to his module.
 *
 * His `styles.css` was written for a standalone app, so it styles global element selectors — `*`,
 * `html, body, #root`, `button`, `input, select, textarea`, `nav`, `main`, `h1`–`h3`, `label`,
 * `::-webkit-scrollbar`. v3.73.0 imported it straight into Ghost Intel 98's renderer, which applied
 * every one of those to the WHOLE APP: gold gradient buttons across every module, dark text fields
 * with pale text on light surfaces, and a Case Manager whose layout collapsed into itself.
 *
 * His file is not edited to fix this — it stays byte-identical to his original, which is the point
 * of the embed. It is transformed here instead, at mount time.
 *
 * This is a deliberately small transformer, not a CSS parser. It handles exactly the shapes his
 * sheet uses, and its behaviour on each of them is pinned by tests:
 *
 *   - his app-root selectors (`:root`, `html`, `body`, `#root`) BECOME the module root — in his app
 *     they meant "the whole surface", and here that surface is his container
 *   - every other selector is prefixed so it can only match inside his subtree
 *   - `@media` is descended into; the at-rule line itself is never prefixed
 *   - `@keyframes` bodies are passed through untouched (`from` / `to` / `50%` are not selectors)
 */

/** Selectors that meant "the whole page" in his standalone app. */
const ROOT_SELECTORS = new Set([':root', 'html', 'body', '#root']);

/** At-rules whose bodies contain declarations or frames, never selectors to scope. */
const OPAQUE_AT_RULES = /^@(keyframes|-\w+-keyframes|font-face|counter-style|property|page)\b/i;

/** At-rules that wrap ordinary rules, whose bodies must be scoped. */
const NESTING_AT_RULES = /^@(media|supports|container|layer)\b/i;

function scopeSelectorList(selectorList: string, scope: string): string {
  const parts = selectorList.split(',').map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    if (ROOT_SELECTORS.has(part)) {
      // `html, body, #root { … }` collapses to one scoped rule rather than three copies.
      if (!out.includes(scope)) out.push(scope);
      continue;
    }
    if (part === '*') {
      // His reset must cover the container as well as everything inside it.
      out.push(scope, `${scope} *`);
      continue;
    }
    // Already inside the module (or is the module) — leave it alone rather than double-prefix.
    if (part === scope || part.startsWith(`${scope} `) || part.startsWith(`${scope}.`)) {
      out.push(part);
      continue;
    }
    out.push(`${scope} ${part}`);
  }
  return [...new Set(out)].join(', ');
}

/**
 * Return `css` with every selector confined to `scope` (e.g. `.xls-embed-root`).
 * Declaration blocks are copied through byte-for-byte.
 */
export function scopeCss(css: string, scope: string): string {
  let out = '';
  let i = 0;

  while (i < css.length) {
    // Copy comments through untouched — they can contain braces.
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }

    const braceAt = css.indexOf('{', i);
    if (braceAt === -1) {
      out += css.slice(i);
      break;
    }

    const prelude = css.slice(i, braceAt);
    const trimmed = prelude.trim();

    // Find the matching close brace for this block, tracking nesting.
    let depth = 0;
    let j = braceAt;
    for (; j < css.length; j += 1) {
      if (css.startsWith('/*', j)) {
        const end = css.indexOf('*/', j + 2);
        j = end === -1 ? css.length : end + 1;
        continue;
      }
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const bodyStart = braceAt + 1;
    const bodyEnd = j < css.length ? j : css.length;
    const body = css.slice(bodyStart, bodyEnd);

    if (trimmed.startsWith('@')) {
      if (OPAQUE_AT_RULES.test(trimmed)) {
        // Keyframes / font-face: the body holds frames or descriptors, not selectors.
        out += `${prelude}{${body}}`;
      } else if (NESTING_AT_RULES.test(trimmed)) {
        // Media / supports: scope what is INSIDE, never the at-rule itself.
        out += `${prelude}{${scopeCss(body, scope)}}`;
      } else {
        out += `${prelude}{${body}}`;
      }
    } else {
      const leading = prelude.slice(0, prelude.length - prelude.trimStart().length);
      out += `${leading}${scopeSelectorList(trimmed, scope)} {${body}}`;
    }

    i = bodyEnd + 1;
  }

  return out;
}
