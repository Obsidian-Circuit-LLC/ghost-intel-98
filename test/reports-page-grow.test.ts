// @vitest-environment jsdom
/**
 * Headless computed-style guard for Task 4: the document page must grow with content instead of
 * clipping/stretching to one viewport height. `.ga98-report-pagescroll` is a flex container around
 * `.ga98-report-page` (`min-height:1056px`); without an explicit `align-items:flex-start` the flex
 * default (`stretch`) forces the page to the scroll area's height, clipping content that grows past
 * one viewport instead of letting the page grow and the container scroll. Resolves the rule from the
 * REAL theme.css through jsdom's `getComputedStyle` — the repo's standard CSS-regression technique
 * (see reports-css.test.ts / reports-shell-css.test.ts and the 98css-table-white-cascade lesson).
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

describe('ga98-report page auto-height (Task 4)', () => {
  it('.ga98-report-pagescroll does not stretch the page to viewport height (align-items:flex-start)', () => {
    inject('src/renderer/styles/theme.css');
    const scroll = document.createElement('div');
    scroll.className = 'ga98-report-pagescroll';
    const page = document.createElement('div');
    page.className = 'ga98-report-page';
    scroll.appendChild(page);
    document.body.appendChild(scroll);
    // A deleted/regressed rule leaves the flex default (`stretch`), which would clip the page's
    // grown content to the scroll area's box instead of letting it grow past one viewport.
    expect(getComputedStyle(scroll).alignItems).toBe('flex-start');
  });

  it('.ga98-report-pagescroll still centers the page horizontally and remains scrollable', () => {
    inject('src/renderer/styles/theme.css');
    const scroll = document.createElement('div');
    scroll.className = 'ga98-report-pagescroll';
    document.body.appendChild(scroll);
    expect(getComputedStyle(scroll).justifyContent).toBe('center');
    expect(getComputedStyle(scroll).overflow).toBe('auto');
  });
});
