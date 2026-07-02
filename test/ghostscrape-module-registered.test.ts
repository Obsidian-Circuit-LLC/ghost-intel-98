// Mock heavy DOM-dependent modules that are loaded transitively by the renderer
// components. The test only verifies registry metadata, not rendering, so stubs
// are sufficient. Setup mirrors test/x-module-registered.test.ts exactly.
import { vi } from 'vitest';

// pdfjs-dist uses DOMMatrix (unavailable in node env); stub it out.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
// pdf-worker?worker — vitest transforms this to a WorkerWrapper that calls `new Worker`
// which is undefined in node. Mock via the absolute resolved path with the suffix.
vi.mock('/dcs98/src/renderer/lib/pdf-worker?worker', () => ({ default: class PdfWorkerStub { terminate() {} } }));
// mammoth (used by DocViewerModule) — mock to prevent potential node issues
vi.mock('mammoth', () => ({ default: { convertToHtml: vi.fn() } }));

import { describe, it, expect, beforeAll } from 'vitest';
import { registerBuiltins } from '../src/renderer/modules/register-builtins';
import { getModule } from '../src/renderer/state/registry';

describe('GhostScrape module registration', () => {
  beforeAll(() => { registerBuiltins(); });
  it('registers an openable "ghostscrape" window', () => {
    const m = getModule('ghostscrape');
    expect(m).toBeTruthy();
    expect(m?.title).toBe('GhostScrape');
    expect(typeof m?.component).toBe('function');
  });
});
