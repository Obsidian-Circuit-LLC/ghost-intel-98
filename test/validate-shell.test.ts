import { describe, it, expect } from 'vitest';
import { ensureShellProgram } from '../src/main/security/validate';

describe('ensureShellProgram', () => {
  it('accepts cmd', () => expect(ensureShellProgram('cmd')).toBe('cmd'));
  it('accepts powershell', () => expect(ensureShellProgram('powershell')).toBe('powershell'));
  it('falls back to cmd for undefined', () => expect(ensureShellProgram(undefined)).toBe('cmd'));
  it('falls back to cmd for an arbitrary string (no path injection)', () => {
    expect(ensureShellProgram('C:\\\\Windows\\\\System32\\\\evil.exe')).toBe('cmd');
    expect(ensureShellProgram('/bin/sh; rm -rf /')).toBe('cmd');
  });
});
