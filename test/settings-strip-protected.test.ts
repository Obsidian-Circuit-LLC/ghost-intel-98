import { describe, it, expect } from 'vitest';
import { stripProtectedSettings } from '../src/main/security/validate';

describe('stripProtectedSettings (FIX 1 — settings.update can never enable the local shell)', () => {
  it('drops localShellEnabled and localShellProgram from a bulk patch', () => {
    const out = stripProtectedSettings({
      localShellEnabled: true,
      localShellProgram: 'powershell',
      theme: 'dark'
    } as Record<string, unknown>);
    expect('localShellEnabled' in out).toBe(false);
    expect('localShellProgram' in out).toBe(false);
    // Unrelated keys are preserved verbatim.
    expect((out as Record<string, unknown>).theme).toBe('dark');
  });

  it('returns the patch unchanged when it carries no protected keys', () => {
    const patch = { theme: 'light', hasSeenWelcome: true } as Record<string, unknown>;
    expect(stripProtectedSettings(patch)).toEqual(patch);
  });

  it('tolerates a non-object patch', () => {
    expect(stripProtectedSettings(null)).toBeNull();
    expect(stripProtectedSettings(undefined)).toBeUndefined();
  });

  it('does not mutate the caller-supplied object', () => {
    const patch = { localShellEnabled: true, theme: 'dark' } as Record<string, unknown>;
    stripProtectedSettings(patch);
    expect(patch.localShellEnabled).toBe(true); // original untouched
  });
});
