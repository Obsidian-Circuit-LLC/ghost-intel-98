// @vitest-environment jsdom
/**
 * Headless computed-style guard for the Task 7 app-shell / dashboard / nav-tree / recent-table
 * styling. Sub-project A turns the Reports module from a bare editor into a Win98 app shell; without
 * this stylesheet the menu bar / toolbar / nav tree / dashboard table render as an unstyled fallback
 * (the same failure class as the v3.47.0 zero-`ga98-report`-CSS regression that `reports-css.test.ts`
 * guards). This resolves the cascade-critical shell rules from the REAL theme.css through jsdom's
 * `getComputedStyle` — the repo's standard CSS-regression technique (see reports-css.test.ts and the
 * 98css-table-white-cascade lesson). Removing a guarded rule fails the test.
 *
 * jsdom has no layout engine and no `var()` resolution, so we assert the declared/resolved values of
 * the cascade-critical rules (literal colours, flex direction) rather than post-layout geometry.
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

function el(cls: string, tag = 'div'): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  document.body.appendChild(e);
  return e;
}

afterEach(() => {
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  document.body.innerHTML = '';
});

describe('ga98-report app-shell / dashboard / nav / recent-table stylesheet (Task 7)', () => {
  it('.ga98-report-appshell lays out as a column (menu / toolbar / body / status rows stack)', () => {
    inject('src/renderer/styles/theme.css');
    const shell = el('ga98-report-appshell');
    expect(getComputedStyle(shell).display).toBe('flex');
    expect(getComputedStyle(shell).flexDirection).toBe('column');
  });

  it('.ga98-report-appbody is the flex-grown body row that holds the nav + center view', () => {
    inject('src/renderer/styles/theme.css');
    const body = el('ga98-report-appbody');
    expect(getComputedStyle(body).display).toBe('flex');
    expect(getComputedStyle(body).flexDirection).toBe('row');
  });

  it('.ga98-report-nav-active has the dark-blue Win98 selection background (not left unstyled)', () => {
    inject('src/renderer/styles/theme.css');
    const active = el('ga98-report-nav-leaf ga98-report-nav-active', 'button');
    // #000080 (the shell's --ga98-blue) restated as a literal so jsdom (no var() resolution) can
    // resolve it deterministically.
    expect(getComputedStyle(active).backgroundColor).toBe('rgb(0, 0, 128)');
    expect(getComputedStyle(active).color).toBe('rgb(255, 255, 255)');
  });

  it('the three status classes resolve to distinct, non-default colours', () => {
    inject('src/renderer/styles/theme.css');
    const draft = getComputedStyle(el('ga98-report-status-draft', 'span')).color;
    const completed = getComputedStyle(el('ga98-report-status-completed', 'span')).color;
    const archived = getComputedStyle(el('ga98-report-status-archived', 'span')).color;
    // Each is explicitly coloured…
    expect(draft).toBe('rgb(200, 192, 0)');
    expect(completed).toBe('rgb(63, 191, 95)');
    expect(archived).toBe('rgb(138, 138, 138)');
    // …and all three differ (a draft-coloured "archived" would be a real bug).
    expect(new Set([draft, completed, archived]).size).toBe(3);
  });

  it('.ga98-report-recent td restates its background on the CLASS (beats the 98.css native-table white)', () => {
    // The 98.css cascade paints every native `<td>` white; the dashboard table lives on the dark
    // workspace, so the dark cell background MUST be restated on the class selector to win on
    // specificity (the 98css-table-white-cascade lesson). A deleted rule → transparent/white → fail.
    inject('src/renderer/styles/theme.css');
    const table = el('ga98-report-recent', 'table');
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    tr.appendChild(td);
    table.appendChild(tr);
    expect(getComputedStyle(td).backgroundColor).toBe('rgb(36, 21, 57)');
    // and it is emphatically not the native-table white the cascade would otherwise apply.
    expect(getComputedStyle(td).backgroundColor).not.toBe('rgb(255, 255, 255)');
  });
});
