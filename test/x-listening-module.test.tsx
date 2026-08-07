// @vitest-environment jsdom
/**
 * Task X1: X Listening Station — module registry entry + renderer shell.
 *
 * Two concerns, one file:
 *  1. registerBuiltins() seeds the module under key `x-listening-station`, titled
 *     "X Listening Station", filed in the OSINT Toolkit under Social Media.
 *  2. The shell renders a connect affordance (createRoot + act, no @testing-library —
 *     Global Constraint: no new dependency), driven by a stubbed window.api.xListening.
 *
 * The registry half mirrors test/x-module-registered.test.ts's heavy-module stubs so
 * importing register-builtins (which pulls in every built-in) doesn't touch pdfjs/mammoth.
 */
import { vi } from 'vitest';

// pdfjs-dist uses DOMMatrix (unavailable in the test env); stub it out.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
// pdf-worker?worker — vitest transforms this to a WorkerWrapper calling `new Worker`,
// which is undefined here. Mock via the absolute resolved path with the suffix.
vi.mock('/dcs98/src/renderer/lib/pdf-worker?worker', () => ({ default: class PdfWorkerStub { terminate() {} } }));
// mammoth (used by DocViewerModule) — mock to prevent node issues.
vi.mock('mammoth', () => ({ default: { convertToHtml: vi.fn() } }));
// maplibre-gl calls window.URL.createObjectURL at import time (worker bootstrap), which jsdom
// does not implement — importing register-builtins (which pulls in the GeoINT adapter) would
// otherwise crash the whole suite at collection. Replace it with inert no-op constructors;
// GeoINT is never rendered here. Mirrors test/osint-toolkit-module-registered.test.ts.
vi.mock('maplibre-gl', () => {
  class Noop { constructor(..._a: unknown[]) {} on() { return this; } off() { return this; } addTo() { return this; } remove() {} setLngLat() { return this; } }
  const api = { Map: Noop, Marker: Noop, Popup: Noop, NavigationControl: Noop, LngLatBounds: Noop, LngLat: Noop };
  return { default: api, ...api };
});

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { registerBuiltins } from '../src/renderer/modules/register-builtins';
import { getModule } from '../src/renderer/state/registry';
import { XListeningModule } from '../src/renderer/modules/x-listening/XListeningModule';

describe('X Listening Station — module registration', () => {
  beforeAll(() => { registerBuiltins(); });

  it('registers the x-listening-station module in the OSINT / Social Media group', () => {
    const m = getModule('x-listening-station');
    expect(m).toBeTruthy();
    expect(m?.title).toBe('X Listening Station');
    expect(m?.category).toBe('osint');
    expect(m?.subcategory).toBe('Social Media');
    expect(typeof m?.component).toBe('function');
  });
});

describe('X Listening Station — shell', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).window.api = {
      xListening: {
        connect: vi.fn(async () => ({ opened: true })),
        status: vi.fn(async () => ({ connected: false })),
      },
      // The full module reads collect/archive settings on mount; stub the surface it touches.
      settings: {
        read: vi.fn(async () => ({ xListening: { collect: { replies: false, reposts: false, comments: false }, archiveCycles: false } })),
        update: vi.fn(async () => undefined),
      },
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as any).window.api;
  });

  it('shows a connect affordance wired to window.api.xListening.connect', async () => {
    await act(async () => { root.render(<XListeningModule />); });

    const connectBtn = Array.from(container.querySelectorAll('button'))
      .find((b) => /connect/i.test(b.textContent || ''));
    expect(connectBtn).toBeTruthy();

    await act(async () => { (connectBtn as HTMLButtonElement).click(); });
    expect((globalThis as any).window.api.xListening.connect).toHaveBeenCalled();
  });
});
