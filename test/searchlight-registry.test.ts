// Mock heavy DOM-dependent modules loaded transitively by the renderer components.
// Mirrors the mock set in register-builtins.test.ts — registerBuiltins pulls in the
// full module tree, which drags in pdfjs-dist and mammoth.
import { vi } from 'vitest';

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('/dcs98/src/renderer/lib/pdf-worker?worker', () => ({ default: class PdfWorkerStub { terminate() {} } }));
vi.mock('mammoth', () => ({ default: { convertToHtml: vi.fn() } }));

import { describe, it, expect, beforeAll } from 'vitest';
import { _resetRegistryForTest, getModule } from '../src/renderer/state/registry';
import { registerBuiltins } from '../src/renderer/modules/register-builtins';

describe('searchlight registration', () => {
  beforeAll(() => {
    _resetRegistryForTest();
    registerBuiltins();
  });

  it('searchlight resolves to a builtin descriptor with title + glyph', () => {
    const d = getModule('searchlight');
    expect(d).toBeTruthy();
    expect(d?.title).toBe('Searchlight');
    expect(d?.glyph).toBe('🔎');
    expect(d?.builtin).toBe(true);
  });
});
