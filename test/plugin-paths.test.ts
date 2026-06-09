import { describe, it, expect } from 'vitest';
import { resolveInside } from '../src/main/plugins/paths';

describe('resolveInside', () => {
  it('resolves a normal relative path under the base', () => {
    expect(resolveInside('/base/osint', 'data/bgp.bin')).toBe('/base/osint/data/bgp.bin');
  });
  it('rejects parent escapes', () => {
    expect(() => resolveInside('/base/osint', '../evil')).toThrow(/escape/);
    expect(() => resolveInside('/base/osint', 'a/../../evil')).toThrow(/escape/);
  });
  it('rejects absolute paths', () => {
    expect(() => resolveInside('/base/osint', '/etc/passwd')).toThrow(/escape/);
  });
});
