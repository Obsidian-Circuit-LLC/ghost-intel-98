import { describe, it, expect } from 'vitest';
import { mapPluginUrl } from '../src/main/plugins/protocol';

describe('mapPluginUrl', () => {
  const verifiedIds = new Set(['osint']);
  it('maps dcs98-plugin://osint/renderer.js to the plugin dir', () => {
    expect(mapPluginUrl('dcs98-plugin://osint/renderer.js', '/u/plugins', verifiedIds)).toBe('/u/plugins/osint/renderer.js');
  });
  it('returns null for an unverified id', () => {
    expect(mapPluginUrl('dcs98-plugin://evil/x.js', '/u/plugins', verifiedIds)).toBeNull();
  });
  it('returns null on path escape', () => {
    expect(mapPluginUrl('dcs98-plugin://osint/../../etc/passwd', '/u/plugins', verifiedIds)).toBeNull();
  });
});
