import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/renderer/lib/pdfExtract', () => ({ extractPdfText: async () => 'pdf text' }));
import { extractForLibrary } from '../src/renderer/lib/libraryExtract';
const enc = (s: string) => new TextEncoder().encode(s);
describe('extractForLibrary', () => {
  it('decodes txt/md', async () => {
    expect((await extractForLibrary('a.txt', enc('hello'))).text).toBe('hello');
    expect((await extractForLibrary('a.md', enc('# hi'))).mime).toBe('text/markdown');
  });
  it('routes pdf to extractPdfText', async () => {
    expect((await extractForLibrary('a.pdf', enc('%PDF'))).text).toBe('pdf text');
  });
  it('rejects unsupported', async () => {
    await expect(extractForLibrary('a.exe', enc('MZ'))).rejects.toThrow(/Unsupported/);
  });
});
