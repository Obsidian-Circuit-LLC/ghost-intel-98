// @vitest-environment jsdom
/**
 * SP-4 Task 8: Playwright-style render guard for the Investigation Graph — mirrors
 * test/minds-eye-render.pw.test.ts. Same "no in-repo headless Playwright browser" convention:
 * drive React 18's `createRoot` inside `act()` against a jsdom container and read the DOM/
 * computed style the way a real headless-browser harness would. Asserts the shared GraphCanvas
 * core (Task 1/6) renders the investigation scene as plain SVG — never `<canvas>` — and that the
 * empty-state message replaces a blank/black scene, matching the invariant Mind's Eye already
 * guards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { InvestigationGraphModule } from '../src/renderer/modules/investigation-graph/InvestigationGraphModule';
import type { InvestigationScene, SceneDelta } from '../src/shared/investigation-graph';

const CASE_ID = 'caseA';

const populatedScene: InvestigationScene = {
  nodes: [
    { id: 'e1', type: 'domain', value: 'evil.tld', cluster: 0, score: 1, x: 10, y: 10 },
    { id: 'e2', type: 'email', value: 'reg@evil.tld', cluster: 0, score: 0.6, x: 90, y: 40 },
    { id: 'e3', type: 'ip', value: '1.2.3.4', cluster: 1, score: 0.3, x: 200, y: 120 }
  ],
  edges: [{ source: 'e1', target: 'e2', relation: 'registrant-of', kind: 'relation' }]
};

const emptyScene: InvestigationScene = { nodes: [], edges: [] };

const BLACK = new Set(['rgb(0, 0, 0)', '#000', '#000000', 'black', '']);

let container: HTMLDivElement;
let root: Root;

function stubApi(scene: InvestigationScene): void {
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    investigation: {
      graph: vi.fn().mockResolvedValue(scene),
      onGraphDelta: vi.fn((_caseId: string, _cb: (d: SceneDelta) => void) => () => {}),
      addNode: vi.fn().mockResolvedValue(undefined),
      addEdge: vi.fn().mockResolvedValue(undefined)
    }
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('Investigation Graph — renders via the shared SVG canvas (Task 8 render guard)', () => {
  it('populated scene: svg exists with >=3 node circles and >=1 edge line, no canvas anywhere', async () => {
    stubApi(populatedScene);
    await act(async () => {
      root.render(createElement(InvestigationGraphModule, { caseId: CASE_ID }));
    });
    await flush();

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();

    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThanOrEqual(3);
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const svgBg = getComputedStyle(svg as unknown as Element).backgroundColor;
    expect(BLACK.has(svgBg)).toBe(false);
  });

  it('cluster + type classes are present on rendered nodes', async () => {
    stubApi(populatedScene);
    await act(async () => {
      root.render(createElement(InvestigationGraphModule, { caseId: CASE_ID }));
    });
    await flush();

    const circles = Array.from(container.querySelectorAll('circle'));
    expect(circles.length).toBeGreaterThanOrEqual(3);
    for (const c of circles) {
      const cls = c.getAttribute('class') ?? '';
      expect(cls).toMatch(/\binv-node\b/);
      expect(cls).toMatch(/cluster-\d+/);
      expect(cls).toMatch(/type-\w+/);
    }
  });

  it('clicking a node opens the provenance inspector showing the entity value', async () => {
    stubApi(populatedScene);
    await act(async () => {
      root.render(createElement(InvestigationGraphModule, { caseId: CASE_ID }));
    });
    await flush();

    const circle = container.querySelector('circle');
    expect(circle).not.toBeNull();
    await act(async () => {
      circle!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      circle!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await flush();

    expect(container.textContent ?? '').toMatch(/evil\.tld/);
    const closeBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Close');
    expect(closeBtn).not.toBeUndefined();
  });

  it('empty scene: no black/blank canvas — the "No entities yet" message is shown instead', async () => {
    stubApi(emptyScene);
    await act(async () => {
      root.render(createElement(InvestigationGraphModule, { caseId: CASE_ID }));
    });
    await flush();

    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('circle')).toBeNull();
    expect(container.textContent ?? '').toMatch(/no entities yet/i);
  });
});
