import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ensureShellProgram, ensureSessionId } from '../src/main/security/validate';

describe('ensureShellProgram', () => {
  it('accepts cmd', () => expect(ensureShellProgram('cmd')).toBe('cmd'));
  it('accepts powershell', () => expect(ensureShellProgram('powershell')).toBe('powershell'));
  it('falls back to cmd for undefined', () => expect(ensureShellProgram(undefined)).toBe('cmd'));
  it('falls back to cmd for an arbitrary string (no path injection)', () => {
    expect(ensureShellProgram('C:\\\\Windows\\\\System32\\\\evil.exe')).toBe('cmd');
    expect(ensureShellProgram('/bin/sh; rm -rf /')).toBe('cmd');
  });
});

describe('ensureSessionId', () => {
  const uuid = randomUUID();
  it('accepts the shell sh- prefix (FIX 3 — was rejected, breaking write/resize/disconnect)', () => {
    expect(ensureSessionId(`sh-${uuid}`)).toBe(`sh-${uuid}`);
  });
  it('still accepts ssh (s-), dialterm (t-), and ftp (f-) prefixes', () => {
    expect(ensureSessionId(`s-${uuid}`)).toBe(`s-${uuid}`);
    expect(ensureSessionId(`t-${uuid}`)).toBe(`t-${uuid}`);
    expect(ensureSessionId(`f-${uuid}`)).toBe(`f-${uuid}`);
  });
  it('rejects junk and unknown prefixes', () => {
    expect(() => ensureSessionId('nope')).toThrow();
    expect(() => ensureSessionId(`x-${uuid}`)).toThrow();
    expect(() => ensureSessionId(`shh-${uuid}`)).toThrow();
    expect(() => ensureSessionId(42)).toThrow();
  });
});
