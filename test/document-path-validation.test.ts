import { describe, it, expect } from 'vitest';
import { ensureDocName, ensureDocRelPath, ensureNoteBody } from '../src/main/security/validate';

describe('ensureDocName', () => {
  it('accepts a normal file/folder name', () => {
    expect(ensureDocName('report.pdf')).toBe('report.pdf');
    expect(ensureDocName('Case Notes')).toBe('Case Notes');
  });
  it('rejects separators, traversal, control chars, illegal chars, over-length', () => {
    for (const bad of ['..', '.', 'a/b', 'a\\b', 'a\0b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', '', 'x'.repeat(256)]) {
      expect(() => ensureDocName(bad)).toThrow();
    }
    expect(() => ensureDocName(123 as unknown)).toThrow();
  });
  it('rejects reserved Win32 device names, case-insensitively, with or without extension', () => {
    for (const bad of ['CON', 'con', 'PRN', 'aux', 'NUL', 'COM1', 'lpt9', 'CON.txt', 'nul.log']) {
      expect(() => ensureDocName(bad)).toThrow();
    }
  });
});

describe('ensureDocRelPath', () => {
  it('accepts the root and nested valid paths', () => {
    expect(ensureDocRelPath('')).toBe('');
    expect(ensureDocRelPath('a')).toBe('a');
    expect(ensureDocRelPath('a/b/c')).toBe('a/b/c');
  });
  it('normalizes redundant slashes but keeps it relative', () => {
    expect(ensureDocRelPath('a//b/')).toBe('a/b');
  });
  it('rejects absolute paths, traversal, backslashes, and any illegal segment', () => {
    for (const bad of ['/etc/passwd', 'C:\\x', '../x', 'a/../b', 'a/..', 'a\\b', 'a/CON', 'a/b\0c']) {
      expect(() => ensureDocRelPath(bad)).toThrow();
    }
    expect(() => ensureDocRelPath(5 as unknown)).toThrow();
  });
});

describe('ensureNoteBody', () => {
  const MAX = 1024 * 1024; // 1 MiB chars
  it('accepts an ordinary body unchanged', () => {
    expect(ensureNoteBody('hello world')).toBe('hello world');
    expect(ensureNoteBody('')).toBe('');
  });
  it('accepts a body exactly at the 1 MiB cap unchanged', () => {
    const atCap = 'a'.repeat(MAX);
    expect(ensureNoteBody(atCap)).toBe(atCap);
    expect(ensureNoteBody(atCap).length).toBe(MAX);
  });
  it('rejects (does NOT silently truncate) an oversize body', () => {
    const tooBig = 'a'.repeat(MAX + 1);
    // Must throw, not return a truncated string — silent truncation would be data loss
    // reported to the user as a successful save.
    expect(() => ensureNoteBody(tooBig)).toThrow(/too large|1 MiB/i);
  });
  it('rejects a non-string', () => {
    expect(() => ensureNoteBody(123 as unknown)).toThrow();
    expect(() => ensureNoteBody(null)).toThrow();
  });
});
