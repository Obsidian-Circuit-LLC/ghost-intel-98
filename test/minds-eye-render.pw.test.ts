// @vitest-environment jsdom
/**
 * T15: Mind's Eye renders non-black on a mobile viewport — guard against the v1 canvas-black
 * regression (see the header comment in MindsEyeModule.tsx, which cites this file).
 *
 * There is no in-repo headless Playwright browser (mirrors the documented convention in
 * test/searchlight-sweep-badge.test.ts) — this drives React 18's `createRoot` inside `act()`
 * against a jsdom container sized to a mobile viewport (390x844) and reads `getComputedStyle`
 * the same way a real headless-browser computed-style harness would, without needing
 * @testing-library/react (not a dependency; mirrors test/hostinfo-standalone.test.tsx).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MindsEyeModule } from '../src/renderer/modules/minds-eye/MindsEyeModule';
import type { MemoryGraphShape } from '../src/shared/ipc-contracts';

const MOBILE = { width: 390, height: 844 };

const populatedGraph: MemoryGraphShape = {
  nodes: [
    {
      id: 'fact:1',
      kind: 'fact',
      label: 'Op-sec reminder',
      strength: 0.8,
      pinned: false,
      conflict: false,
      vector: [0.1, 0.2],
      x: 10,
      y: 10,
      cluster: 0
    },
    {
      id: 'doc:1',
      kind: 'doc',
      label: 'Uploaded brief',
      strength: 0.5,
      pinned: false,
      conflict: false,
      vector: [0.3, 0.1],
      x: 90,
      y: 40,
      cluster: 0
    }
  ],
  edges: []
};

const emptyGraph: MemoryGraphShape = { nodes: [], edges: [] };

const BLACK = new Set(['rgb(0, 0, 0)', '#000', '#000000', 'black', '']);

let container: HTMLDivElement;
let root: Root;

function setMobileViewport(): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: MOBILE.width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: MOBILE.height });
}

function stubGraph(graph: MemoryGraphShape): void {
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    memory: { graph: vi.fn().mockResolvedValue(graph) }
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  setMobileViewport();
  container = document.createElement('div');
  container.style.width = `${MOBILE.width}px`;
  container.style.height = `${MOBILE.height}px`;
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("Mind's Eye — renders non-black at a mobile viewport (390x844)", () => {
  it('populated graph: svg exists, background is not black, at least one circle renders', async () => {
    stubGraph(populatedGraph);
    await act(async () => {
      root.render(createElement(MindsEyeModule));
    });
    await flush();

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();

    const outer = container.firstElementChild as HTMLElement;
    const outerBg = getComputedStyle(outer).backgroundColor;
    const svgBg = getComputedStyle(svg as unknown as Element).backgroundColor;
    expect(BLACK.has(outerBg)).toBe(false);
    expect(BLACK.has(svgBg)).toBe(false);

    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThan(0);
  });

  it('empty graph: no black canvas — empty-state text is shown instead of a blank scene', async () => {
    stubGraph(emptyGraph);
    await act(async () => {
      root.render(createElement(MindsEyeModule));
    });
    await flush();

    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('circle')).toBeNull();
    expect(container.textContent ?? '').toMatch(/nothing remembered yet/i);
  });
});
