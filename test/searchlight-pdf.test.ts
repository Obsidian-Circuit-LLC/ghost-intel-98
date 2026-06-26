/**
 * Unit tests for sanitizePdfFilename (pure, no Electron dep).
 * exportSweepPdf is Electron-dependent (BrowserWindow, dialog) and is smoke-tested manually.
 */

import { describe, it, expect } from 'vitest';
import { sanitizePdfFilename } from '../src/main/searchlight/export-pdf';

describe('sanitizePdfFilename', () => {
  it('strips path separators and illegal filename chars, keeps .pdf suffix', () => {
    const result = sanitizePdfFilename('a/b\\c:*?.pdf');
    expect(result).not.toMatch(/[/\\:*?"<>|]/);
    expect(result.endsWith('.pdf')).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('always ends in .pdf when input has a different extension', () => {
    const result = sanitizePdfFilename('report.txt');
    expect(result.endsWith('.pdf')).toBe(true);
  });

  it('always ends in .pdf when input has no extension', () => {
    const result = sanitizePdfFilename('my-report');
    expect(result.endsWith('.pdf')).toBe(true);
  });

  it('is non-empty and ends in .pdf even for an empty string', () => {
    const result = sanitizePdfFilename('');
    expect(result.length).toBeGreaterThan(0);
    expect(result.endsWith('.pdf')).toBe(true);
  });

  it('does not produce double .pdf suffix', () => {
    const result = sanitizePdfFilename('searchlight-report.pdf');
    expect(result).toBe('searchlight-report.pdf');
  });

  it('strips control characters', () => {
    const result = sanitizePdfFilename('re\x00port\x1f.pdf');
    expect(result).not.toMatch(/[\x00-\x1f\x7f]/);
    expect(result.endsWith('.pdf')).toBe(true);
  });
});
