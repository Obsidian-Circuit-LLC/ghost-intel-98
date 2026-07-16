// @vitest-environment jsdom
/**
 * Headless computed-style guard for the ROOT-CAUSE fix: v3.47.0 shipped Reports with ZERO
 * `ga98-report` styling, so the banner/photo rendered at native pixel size and the module sat on an
 * unstyled grey void. This locks in the presence of the new `ga98-report` stylesheet by resolving
 * class rules from the REAL theme.css through jsdom's `getComputedStyle` — the same technique the
 * repo's other CSS regressions use (see css-layout-fixes.test.ts and the 98css-table-white-cascade
 * lesson). Removing a guarded rule fails the test.
 *
 * HARNESS NOTE: the plan named this `reports-css.spec.ts` as a Playwright computed-style spec, but
 * this repo has no Playwright harness (vitest+jsdom only, and vitest's include globs `*.test.ts`).
 * Per the plan's own fallback ("mirror the existing 98css-table computed-style harness"), this is a
 * jsdom `.test.ts` mirror of css-layout-fixes.test.ts. jsdom has no layout engine, so we assert the
 * declared/resolved values of the cascade-critical rules rather than post-layout geometry.
 *
 * The document PAGE is the one white surface (it represents paper); its doc-table cells are therefore
 * intentionally white, RESTATED on the `.ga98-report-doc-table` CLASS selector so the value wins
 * deterministically over 98.css's native `<table>` element rule (the white-cascade lesson).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

function inject(cssRelPath: string): void {
  const css = readFileSync(join(process.cwd(), cssRelPath), 'utf8');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

afterEach(() => {
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  document.body.innerHTML = '';
});

describe('ga98-report stylesheet (root-cause fix)', () => {
  it('.ga98-report-banner-img is bounded to its container (max-width:100%, not native size)', () => {
    inject('src/renderer/styles/theme.css');
    const img = document.createElement('img');
    img.className = 'ga98-report-banner-img';
    document.body.appendChild(img);
    expect(getComputedStyle(img).maxWidth).toBe('100%');
  });

  it('.ga98-report-imageblock-img is bounded to its container (max-width:100%)', () => {
    inject('src/renderer/styles/theme.css');
    const img = document.createElement('img');
    img.className = 'ga98-report-imageblock-img';
    document.body.appendChild(img);
    expect(getComputedStyle(img).maxWidth).toBe('100%');
  });

  it('.ga98-report-page has a bounded width and is centered inside the scroll area', () => {
    inject('src/renderer/styles/theme.css');
    const scroll = document.createElement('div');
    scroll.className = 'ga98-report-pagescroll';
    const page = document.createElement('div');
    page.className = 'ga98-report-page';
    scroll.appendChild(page);
    document.body.appendChild(scroll);
    // Bounded, fixed document width (paper), not fluid/native.
    expect(getComputedStyle(page).width).toBe('816px');
    // The scroll area centers the page horizontally.
    expect(getComputedStyle(scroll).justifyContent).toBe('center');
  });

  it('the reusable-text library overlays style the classes the components actually render', () => {
    // Guards the dead-CSS regression: a generic `.ga98-report-library*` namespace no component used
    // was styled while the real DescriptorLibrary/ContactBook classes were left unstyled. The rules
    // must target the namespaced classes the components render (…-descriptorlib / …-contactbook).
    inject('src/renderer/styles/theme.css');
    const lib = document.createElement('div');
    lib.className = 'ga98-report-descriptorlib';
    const head = document.createElement('div');
    head.className = 'ga98-report-descriptorlib-head';
    lib.appendChild(head);
    document.body.appendChild(lib);
    // Container gets the purple-rail panel background (not left transparent/unstyled).
    expect(getComputedStyle(lib).backgroundColor).toBe('rgb(36, 21, 57)');
    // The head bar gets its flex layout from the class the component actually renders.
    expect(getComputedStyle(head).display).toBe('flex');
  });

  it('.ga98-report-doc-table td restates its background on the CLASS (wins over 98.css element rule)', () => {
    inject('src/renderer/styles/theme.css');
    const table = document.createElement('table');
    table.className = 'ga98-report-doc-table';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    tr.appendChild(td);
    table.appendChild(tr);
    document.body.appendChild(table);
    // The cell background is set explicitly on the class rule (paper white), not left to the UA/98.css
    // default (which jsdom resolves to transparent when no rule matches). A deleted rule → transparent
    // → this assertion fails, which is exactly the regression this guards.
    expect(getComputedStyle(td).backgroundColor).toBe('rgb(255, 255, 255)');
  });
});
