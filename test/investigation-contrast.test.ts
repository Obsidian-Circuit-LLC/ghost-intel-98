/**
 * Investigation-window readability guard (GhostExodus field feedback): the cockpit's side panel
 * and run-panel classes (`.investigation-side-panel`, `.run-panel`, `.run-panel__title`,
 * `.investigation-side-panel__tab`) had no stylesheet at all — they rendered with the browser's
 * default black-on-transparent text over whatever sat behind them, unreadable in the dark cockpit.
 * This is a plain text/AST check (node, no DOM) — a Playwright computed-style check is optional
 * polish, not required per the plan.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const cssPath = join(
  process.cwd(),
  'src/renderer/modules/investigation-graph/investigation.css',
);
const modulePath = join(
  process.cwd(),
  'src/renderer/modules/investigation-graph/InvestigationGraphModule.tsx',
);

describe('investigation.css exists and styles the previously-unstyled cockpit classes', () => {
  const css = readFileSync(cssPath, 'utf8');

  it('defines rules for the side panel, run panel, title, and tab classes', () => {
    expect(css).toMatch(/\.investigation-side-panel\b/);
    expect(css).toMatch(/\.run-panel\b/);
    expect(css).toMatch(/\.run-panel__title\b/);
    expect(css).toMatch(/\.investigation-side-panel__tab\b/);
  });

  it('gives the side panel and run panel a legible grey surface (not black-on-black)', () => {
    const sidePanelBlock = css.match(/\.investigation-side-panel\s*\{[^}]*\}/);
    const runPanelBlock = css.match(/\.run-panel\s*\{[^}]*\}/);
    expect(sidePanelBlock).not.toBeNull();
    expect(runPanelBlock).not.toBeNull();

    expect(sidePanelBlock![0]).toMatch(/background:\s*var\(--ga98-grey\)/);
    expect(runPanelBlock![0]).toMatch(/background:\s*var\(--ga98-grey\)/);

    // Neither block may set an unreadable black-on-black pairing.
    expect(sidePanelBlock![0]).not.toMatch(/color:\s*#000000;?\s*background:\s*#000000/);
    expect(runPanelBlock![0]).not.toMatch(/color:\s*#000000;?\s*background:\s*#000000/);
  });

  it('scopes every selector under the investigation/run-panel/toolbar classnames (no bare element selectors)', () => {
    const selectorLines = css
      .split('\n')
      .filter((l) => l.includes('{'))
      .map((l) => l.split('{')[0].trim())
      .filter((l) => l.length > 0 && !l.startsWith('/*') && !l.startsWith('*') && !l.startsWith('@'));
    for (const selector of selectorLines) {
      const parts = selector.split(',').map((p) => p.trim());
      for (const part of parts) {
        expect(part).toMatch(/^\.(investigation-side-panel|run-panel|graph-pane-toolbar)/);
      }
    }
  });
});

describe('InvestigationGraphModule imports the stylesheet', () => {
  it('imports ./investigation.css', () => {
    const src = readFileSync(modulePath, 'utf8');
    expect(src).toMatch(/import\s+['"]\.\/investigation\.css['"];?/);
  });
});
