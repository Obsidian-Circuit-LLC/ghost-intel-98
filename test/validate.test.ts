import { describe, it, expect } from 'vitest';
import { ensureFileName, isLoopbackOrPrivate, validateBookmarkUrl, validateByteRange, MAX_ATTACHMENT_READ_BYTES } from '../src/main/security/validate';

describe('ensureFileName', () => {
  it('accepts a plain filename', () => {
    expect(ensureFileName('report.pdf', 'fileName')).toBe('report.pdf');
  });
  it('rejects path separators and traversal', () => {
    expect(() => ensureFileName('../etc/passwd', 'fileName')).toThrow();
    expect(() => ensureFileName('a/b.txt', 'fileName')).toThrow();
    expect(() => ensureFileName('a\\b.txt', 'fileName')).toThrow();
    expect(() => ensureFileName('..', 'fileName')).toThrow();
  });
  it('rejects empty and over-long names', () => {
    expect(() => ensureFileName('', 'fileName')).toThrow();
    expect(() => ensureFileName('x'.repeat(201), 'fileName')).toThrow();
  });
});

describe('isLoopbackOrPrivate', () => {
  it('flags loopback and private hosts', () => {
    expect(isLoopbackOrPrivate('localhost')).toBe(true);
    expect(isLoopbackOrPrivate('127.0.0.1')).toBe(true);
    expect(isLoopbackOrPrivate('10.0.0.5')).toBe(true);
    expect(isLoopbackOrPrivate('192.168.1.1')).toBe(true);
  });
  it('does not flag public hosts', () => {
    expect(isLoopbackOrPrivate('example.com')).toBe(false);
    expect(isLoopbackOrPrivate('8.8.8.8')).toBe(false);
  });
});

describe('validateBookmarkUrl', () => {
  it('accepts https public URLs', () => {
    expect(validateBookmarkUrl('https://example.com/')).toBe('https://example.com/');
  });
  it('rejects non-http(s) and private targets', () => {
    expect(() => validateBookmarkUrl('file:///etc/passwd')).toThrow();
    expect(() => validateBookmarkUrl('http://127.0.0.1/')).toThrow();
  });
});

describe('validateByteRange', () => {
  it('clamps length to the hard ceiling and floors it to >=1', () => {
    expect(validateByteRange(0, 100)).toEqual({ offset: 0, length: 100 });
    expect(validateByteRange(10, 1e12).length).toBe(MAX_ATTACHMENT_READ_BYTES);
    expect(validateByteRange(0, 0).length).toBe(1);
    expect(validateByteRange(5, 3.9).length).toBe(3);
  });
  it('rejects negative / non-integer offsets and non-numeric length', () => {
    expect(() => validateByteRange(-1, 10)).toThrow();
    expect(() => validateByteRange(1.5, 10)).toThrow();
    expect(() => validateByteRange(0, NaN)).toThrow();
    expect(() => validateByteRange('0', 10)).toThrow();
  });
});
