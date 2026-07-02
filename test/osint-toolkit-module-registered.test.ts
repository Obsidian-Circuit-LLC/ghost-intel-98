// @vitest-environment jsdom
// Mock heavy DOM-dependent modules that are loaded transitively by the renderer
// components. Two concerns live here: (a) registry metadata (the reachability audit,
// no rendering) and (b) the crash-safety audit that actually mounts the no-stream OSINT
// tools through the real ModuleHost path. The jsdom env + stubs below serve both.
// Setup mirrors test/x-module-registered.test.ts exactly.
import { vi } from 'vitest';

// pdfjs-dist uses DOMMatrix (unavailable in node env); stub it out.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
// pdf-worker?worker — vitest transforms this to a WorkerWrapper that calls `new Worker`
// which is undefined in node. Mock via the absolute resolved path with the suffix.
vi.mock('/dcs98/src/renderer/lib/pdf-worker?worker', () => ({ default: class PdfWorkerStub { terminate() {} } }));
// mammoth (used by DocViewerModule) — mock to prevent potential node issues
vi.mock('mammoth', () => ({ default: { convertToHtml: vi.fn() } }));
// maplibre-gl calls window.URL.createObjectURL at import time (worker bootstrap), which jsdom
// does not implement — importing register-builtins (which pulls in the GeoINT adapter) would
// otherwise crash the whole suite at collection. Replace it with inert no-op constructors;
// GeoINT is never rendered here, only host-info/news-view/camera-view. Mirrors the maplibre-gl
// stub used by test/geoint-cctv-wiring.test.ts.
vi.mock('maplibre-gl', () => {
  class Noop { constructor(..._a: unknown[]) {} on() { return this; } off() { return this; } addTo() { return this; } remove() {} setLngLat() { return this; } }
  const api = { Map: Noop, Marker: Noop, Popup: Noop, NavigationControl: Noop, LngLatBounds: Noop, LngLat: Noop };
  return { default: api, ...api };
});

import { describe, it, expect, beforeAll } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { registerBuiltins } from '../src/renderer/modules/register-builtins';
import { getModule, listModules } from '../src/renderer/state/registry';
import { buildOsintDirectory } from '../src/renderer/modules/osint-toolkit/directory';
import { ModuleHost } from '../src/renderer/shell/ModuleHost';
import type { WindowSpec } from '../src/renderer/state/store';

describe('OSINT Toolkit module registration', () => {
  beforeAll(() => { registerBuiltins(); });

  it('registers an openable "osint-toolkit" window', () => {
    const m = getModule('osint-toolkit');
    expect(m).toBeTruthy();
    expect(m?.title).toBe('OSINT Toolkit');
    expect(typeof m?.component).toBe('function');
  });

  it('groups the real registry with a Social Media group containing x, ghostscrape, socmint, and never lists itself', () => {
    const groups = buildOsintDirectory(listModules());
    const socialMedia = groups.find((g) => g.subcategory === 'Social Media');
    expect(socialMedia).toBeTruthy();
    const keys = socialMedia?.tools.map((t) => t.key) ?? [];
    expect(keys).toEqual(expect.arrayContaining(['x', 'ghostscrape', 'socmint']));

    const allKeys = groups.flatMap((g) => g.tools.map((t) => t.key));
    expect(allKeys).not.toContain('osint-toolkit');
  });

  it('every expected OSINT tool is tagged and reachable via the toolkit (none hidden)', () => {
    const reachable = new Set(
      buildOsintDirectory(listModules()).flatMap((g) => g.tools.map((t) => t.key))
    );
    // The full OSINT surface the toolkit must expose — a tool that exists but is untagged would
    // be unreachable from the launcher (the exact "hidden feature" class the pre-ship QA targets).
    for (const key of [
      'x', 'ghostscrape', 'socmint',        // Social Media
      'geoint', 'eyespy', 'camera-view',    // Geospatial
      'searchlight',                        // Identity
      'host-info', 'net-explorer', 'news-view' // Network / Recon
    ]) {
      expect(reachable.has(key), `OSINT tool "${key}" is not reachable via the toolkit`).toBe(true);
    }
  });

  // Reachability is necessary but not sufficient: three of the tagged tools (Hosts, News, Camera)
  // are ALSO per-stream drill-downs that used to assume a `stream` prop. Launched standalone from
  // the Toolkit there is no stream — so opening them via the real ModuleHost path must not crash
  // into the ModuleErrorBoundary. Mounting through ModuleHost (not the raw component) exercises the
  // exact launch path the Toolkit uses; a throw would surface as the boundary's role="alert" panel.
  describe('open safely WITHOUT a stream (via ModuleHost)', () => {
    for (const key of ['host-info', 'news-view', 'camera-view']) {
      it(`opens "${key}" with no stream prop and stays out of the error boundary`, () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        // Standalone paths render an entry form / network-gated placeholder; no window.api and no
        // egress. Silence the expected React act/console noise without masking a real crash (a crash
        // shows up as the boundary's alert panel, asserted below).
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const spec: WindowSpec = { id: `audit-${key}`, module: key, title: key };
        try {
          expect(() => {
            act(() => { root.render(createElement(ModuleHost, { spec })); });
          }).not.toThrow();
          // The module rendered its real content, NOT the ModuleErrorBoundary fallback.
          expect(container.querySelector('[role="alert"]'), `"${key}" crashed into the module error boundary`).toBeNull();
        } finally {
          act(() => { root.unmount(); });
          container.remove();
          warnSpy.mockRestore();
          errorSpy.mockRestore();
        }
      });
    }
  });
});
