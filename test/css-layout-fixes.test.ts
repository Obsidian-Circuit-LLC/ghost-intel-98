// @vitest-environment jsdom
/**
 * Headless computed-style guards for two GhostExodus-reported CSS bugs, verified the way the repo's
 * other CSS regressions are (jsdom resolves a class rule from an injected <style> — see the
 * 98css-table-white-cascade lesson). These load the REAL stylesheet files, so removing the rule
 * fails the test.
 *
 *  - Bug B: the AI toolbar (`.ga98-toolbar`) overlapped its buttons' labels onto the Voice controls
 *    when the Memory sidebar stole ~260px, because the row could not wrap. Fix: flex-wrap: wrap.
 *  - Bug D: the GhostScrape Account `<select class="gs-input">` rendered a glitched tiled run of
 *    dropdown chevrons (wide native select + dark custom background on Chromium/Windows). Fix:
 *    appearance:none so the native indicator is replaced by a single drawn arrow.
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

describe('Bug B — AI toolbar wraps instead of overlapping', () => {
  it('.ga98-toolbar computes flex-wrap: wrap', () => {
    inject('src/renderer/styles/theme.css');
    const el = document.createElement('div');
    el.className = 'ga98-toolbar';
    document.body.appendChild(el);
    expect(getComputedStyle(el).flexWrap).toBe('wrap');
  });
});

describe('Bug D — GhostScrape Account select strips the glitched native control', () => {
  it('select.gs-input computes appearance: none', () => {
    inject('src/renderer/modules/ghostscrape/ghostscrape.css');
    const sel = document.createElement('select');
    sel.className = 'gs-input';
    document.body.appendChild(sel);
    const cs = getComputedStyle(sel) as CSSStyleDeclaration & { webkitAppearance?: string };
    expect(cs.appearance === 'none' || cs.webkitAppearance === 'none').toBe(true);
  });
});

describe('GeoINT Live News — the fieldset border spans the rail panel', () => {
  // Regression (v3.42.0): .ga98-livenews had NO rule, so the <fieldset> used the UA default
  // min-inline-size: min-content and shrank once eefc518 removed the wide inline add-form that used
  // to force its width — the near-transparent border no longer reached the panel's right edge. A
  // full-width, border-box rule makes it span the rail regardless of inner content width.
  it('.ga98-livenews computes box-sizing: border-box and zero left margin', () => {
    inject('src/renderer/styles/theme.css');
    const fs = document.createElement('fieldset');
    fs.className = 'ga98-livenews';
    document.body.appendChild(fs);
    const cs = getComputedStyle(fs);
    expect(cs.boxSizing).toBe('border-box');
    expect(cs.marginLeft).toBe('0px');
  });
});

describe('Number Muncher — the calc info-grid is shared, not Info-panel-only', () => {
  // v3.41.0 dropped Number Muncher's Info side panel, but StatisticsKeypad reuses .ga98-calc-info-grid
  // for its results readout. This locks the rule so deleting the (now defunct) Info panel again can't
  // silently strip the Statistics grid layout.
  it('.ga98-calc-info-grid computes display: grid', () => {
    inject('src/renderer/styles/theme.css');
    const el = document.createElement('dl');
    el.className = 'ga98-calc-info-grid';
    document.body.appendChild(el);
    expect(getComputedStyle(el).display).toBe('grid');
  });
});
