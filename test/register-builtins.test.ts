// Mock heavy DOM-dependent modules that are loaded transitively by the renderer
// components. The test only verifies registry key/title/glyph/builtin metadata,
// not rendering, so stubs are sufficient.
import { vi } from 'vitest';

// pdfjs-dist uses DOMMatrix (unavailable in node env); stub it out.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
// pdf-worker?worker — vitest transforms this to a WorkerWrapper that calls `new Worker`
// which is undefined in node. Mock via the absolute resolved path with the suffix.
vi.mock('/dcs98/src/renderer/lib/pdf-worker?worker', () => ({ default: class PdfWorkerStub { terminate() {} } }));
// mammoth (used by DocViewerModule) — mock to prevent potential node issues
vi.mock('mammoth', () => ({ default: { convertToHtml: vi.fn() } }));

import { describe, it, expect, beforeEach } from 'vitest';
import { _resetRegistryForTest, listModules } from '../src/renderer/state/registry';
import { registerBuiltins } from '../src/renderer/modules/register-builtins';

describe('registerBuiltins', () => {
  beforeEach(() => _resetRegistryForTest());

  it('registers every built-in ModuleKey exactly once', () => {
    registerBuiltins();
    const keys = listModules().map((m) => m.key).sort();
    // EXPECTED equals the ModuleKey union from store.ts, sorted.
    const EXPECTED = [
      'ai-assistant', 'alarm', 'bookmarks', 'briefcase', 'calendar', 'camera-view', 'cases', 'chat', 'chess',
      'dialterm', 'doc-viewer', 'eyespy', 'geoint', 'help', 'host-info', 'journal', 'mail', 'markets', 'media-player',
      'minesweeper', 'net-explorer', 'news-view', 'notepad', 'pinball', 'reminders', 'search', 'searchlight', 'settings',
      'shred', 'solitaire', 'whiteboard'
    ].sort();
    expect(keys).toEqual(EXPECTED);
    expect(listModules().every((m) => m.builtin)).toBe(true);
  });

  it('a second call throws on duplicate', () => {
    registerBuiltins();
    expect(() => registerBuiltins()).toThrow();
  });
});
