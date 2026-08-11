// @vitest-environment jsdom
/**
 * X Listening Station — module registry entry + renderer SHELL (Task 13 rebuild).
 *
 * Two concerns, one file:
 *  1. registerBuiltins() seeds the module under key `x-listening-station`, titled
 *     "X Listening Station", filed in the OSINT Toolkit under Social Media.
 *  2. The shell renders (createRoot + act, no @testing-library — Global Constraint: no new
 *     dependency), driven by a stubbed window.api.xListening Phase-1 surface
 *     (campaigns list/create/switch, openSession, sessionStatus) — NOT the retiring X1-X8
 *     clearnet-only channels (connect/status/capture/…), which this shell no longer calls.
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

vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: vi.fn(),
  promptDialog: vi.fn(),
}));

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { registerBuiltins } from '../src/renderer/modules/register-builtins';
import { getModule } from '../src/renderer/state/registry';
import { XListeningModule } from '../src/renderer/modules/x-listening/XListeningModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';

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
  let campaignsList: ReturnType<typeof vi.fn>;
  let sessionStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    campaignsList = vi.fn(async () => []);
    sessionStatus = vi.fn(async () => ({ connected: false, windowOpen: false }));
    (globalThis as any).window.api = {
      xListening: {
        campaignsList,
        campaignsCreate: vi.fn(async (name: string) => ({ id: 'camp-1', name, createdAt: 1, updatedAt: 1 })),
        campaignsSwitch: vi.fn(async (id: string) => ({ id, name: 'x', createdAt: 1, updatedAt: 1 })),
        sessionStatus,
        openSession: vi.fn(async () => ({ blocked: false })),
        closeSession: vi.fn(async () => ({ cleared: true })),
        // Task 14 — insight loaders fired for any active campaign on mount; stubbed so this
        // registration/shell suite stays focused on what it tests.
        postsList: vi.fn(async () => []),
        analysis: vi.fn(async () => ({})),
        health: vi.fn(async () => []),
        entities: vi.fn(async () => []),
      },
    };
    useSettings.setState({ settings: defaultSettings });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as any).window.api;
    useSettings.setState({ settings: null });
  });

  it('renders the campaign dock, session box and network posture control with no campaigns', async () => {
    await act(async () => { root.render(<XListeningModule />); });
    await act(async () => { await Promise.resolve(); });

    expect(campaignsList).toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Active campaign"]')).toBeTruthy();
    expect((container.textContent || '')).toMatch(/X SESSION OFFLINE/);
    expect((container.textContent || '')).toMatch(/TOR/);

    const openBtn = Array.from(container.querySelectorAll('button')).find((b) => /open session/i.test(b.textContent || ''));
    expect(openBtn).toBeTruthy();
    // No active campaign yet → disabled, never a hollow no-op click.
    expect((openBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('auto-selects the first campaign returned by campaignsList and loads its session status', async () => {
    campaignsList.mockResolvedValue([
      { id: 'camp-a', name: 'Alpha', createdAt: 1, updatedAt: 1 },
      { id: 'camp-b', name: 'Beta', createdAt: 2, updatedAt: 2 },
    ]);
    sessionStatus.mockResolvedValue({ connected: true, windowOpen: true });

    await act(async () => { root.render(<XListeningModule />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(sessionStatus).toHaveBeenCalledWith('camp-a');
    const select = container.querySelector('[aria-label="Active campaign"]') as HTMLSelectElement;
    expect(select.value).toBe('camp-a');
    expect((container.textContent || '')).toMatch(/X SESSION ONLINE/);
  });
});
