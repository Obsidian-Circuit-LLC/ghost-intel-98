// @vitest-environment jsdom
/**
 * Headless computed-style guard for the Task 7 Template-Preview + metadata-field styling. The
 * Templates sub-project adds a right-rail template preview (white sunken iframe inside a silver
 * MDI panel), a white sunken template list, and a row of compact metadata inputs in the editor
 * header. Without these rules the preview frame paints transparent (bleeding the silver panel
 * through the exported page), the list loses its sunken well, and the metadata fields collapse
 * into a vertical stack. This resolves the cascade-critical rules from the REAL theme.css through
 * jsdom's `getComputedStyle` — the repo's standard CSS-regression technique (see
 * reports-shell-css.test.ts and the 98css-table-white-cascade lesson). Removing a guarded rule
 * fails the test.
 *
 * jsdom has no layout engine and no `var()` resolution, so we assert the declared/resolved values
 * of the cascade-critical rules (literal light-Win98 colours: #c0c0c0 / #fff / #808080, flex
 * direction) rather than post-layout geometry.
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

describe('ga98-report Template Preview + metadata-field stylesheet (Task 7)', () => {
  it('.ga98-report-tpl-preview-frame is a white, sunken, full-width preview surface', () => {
    inject('src/renderer/styles/theme.css');
    const frame = el('ga98-report-tpl-preview-frame', 'iframe');
    const s = getComputedStyle(frame);
    // White paint so the exported page shows through faithfully (not the silver panel behind it).
    expect(s.backgroundColor).toBe('rgb(255, 255, 255)');
    // Sunken Win98 bevel: dark top/left, light bottom/right (#808080 … #fff).
    expect(s.borderTopColor).toBe('rgb(128, 128, 128)');
    expect(s.borderBottomColor).toBe('rgb(255, 255, 255)');
    expect(s.width).toBe('100%');
  });

  it('.ga98-report-tpl-preview is a silver Win98 panel', () => {
    inject('src/renderer/styles/theme.css');
    const panel = el('ga98-report-tpl-preview');
    // #c0c0c0 silver restated on the class so it wins deterministically.
    expect(getComputedStyle(panel).backgroundColor).toBe('rgb(192, 192, 192)');
  });

  it('.ga98-report-tpl-list is a white, sunken list well', () => {
    inject('src/renderer/styles/theme.css');
    const list = el('ga98-report-tpl-list');
    const s = getComputedStyle(list);
    expect(s.backgroundColor).toBe('rgb(255, 255, 255)');
    // Sunken bevel like the recent table (#808080 top/left, #fff bottom/right).
    expect(s.borderTopColor).toBe('rgb(128, 128, 128)');
    expect(s.borderBottomColor).toBe('rgb(255, 255, 255)');
  });

  it('.ga98-report-metafields lays the metadata inputs out in a row (not a collapsed stack)', () => {
    inject('src/renderer/styles/theme.css');
    const fields = el('ga98-report-metafields');
    const s = getComputedStyle(fields);
    expect(s.display).toBe('flex');
    expect(s.flexWrap).toBe('wrap');
  });

  it('.ga98-report-meta-field stacks its label over its compact input', () => {
    inject('src/renderer/styles/theme.css');
    const field = el('ga98-report-meta-field', 'label');
    const s = getComputedStyle(field);
    expect(s.display).toBe('flex');
    expect(s.flexDirection).toBe('column');
  });
});
