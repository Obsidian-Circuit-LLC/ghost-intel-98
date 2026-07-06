// @vitest-environment jsdom
import { vi } from 'vitest';

// Heavy DOM-dependent modules pulled in transitively by registerBuiltins. This test only
// checks registry metadata + shortcut wiring, so stubs are sufficient (matches the other
// registerBuiltins tests, e.g. test/register-builtins.test.ts).
// pdfjs-dist uses DOMMatrix (unavailable in the test env); stub it out.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('/dcs98/src/renderer/lib/pdf-worker?worker', () => ({ default: class PdfWorkerStub { terminate() {} } }));
vi.mock('mammoth', () => ({ default: { convertToHtml: vi.fn() } }));
// maplibre-gl calls window.URL.createObjectURL at import time (worker bootstrap), unimplemented
// in jsdom; the GeoINT adapter pulls it in transitively. Inert no-op constructors keep collection
// alive (GeoINT is never rendered here). Mirrors test/osint-toolkit-module-registered.test.ts.
vi.mock('maplibre-gl', () => {
  class Noop { constructor(..._a: unknown[]) {} on() { return this; } off() { return this; } addTo() { return this; } remove() {} setLngLat() { return this; } }
  const api = { Map: Noop, Marker: Noop, Popup: Noop, NavigationControl: Noop, LngLatBounds: Noop, LngLat: Noop };
  return { default: api, ...api };
});

import { describe, it, expect, beforeAll } from 'vitest';
import { registerBuiltins } from '../src/renderer/modules/register-builtins';
import { getModule } from '../src/renderer/state/registry';
import { desktopShortcutDefaults } from '../src/renderer/shell/Desktop';
import { defaultShortcuts, REQUIRED_MODULE_SHORTCUTS } from '../src/shared/types';

beforeAll(() => { registerBuiltins(); });

describe('My Documents wiring', () => {
  it('registers the my-documents module', () => {
    expect(getModule('my-documents')?.title).toBe('My Documents');
  });
  it('places My Documents immediately after My Cases on the desktop', () => {
    const keys = desktopShortcutDefaults.map((s) => s.module);
    expect(keys[0]).toBe('cases');
    expect(keys[1]).toBe('my-documents');
  });
  it('removes Calendar, Reminders, and Chat from the desktop', () => {
    const keys = desktopShortcutDefaults.map((s) => s.module);
    expect(keys).not.toContain('calendar');
    expect(keys).not.toContain('reminders');
    expect(keys).not.toContain('chat');
  });
  it('keeps the three moved tools reachable in the Access menu', () => {
    const targets = defaultShortcuts.map((s) => s.target);
    expect(targets).toContain('calendar');
    expect(targets).toContain('reminders');
    expect(targets).toContain('chat');
    // Chat also seeds into existing installs via the reconciler.
    expect(REQUIRED_MODULE_SHORTCUTS.map((s) => s.target)).toContain('chat');
  });
});
