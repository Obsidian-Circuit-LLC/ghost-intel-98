import { describe, it, expect } from 'vitest';
import { parseManifest, ManifestError } from '../src/main/plugins/manifest';

const good = {
  id: 'osint', name: 'OSINT', version: '1.0.0', targetApiVersion: 1,
  modules: [{ key: 'osint:graph', title: 'OSINT', glyph: '🕸' }],
  capabilities: ['egress', 'plugin-storage'], main: 'main.js', renderer: 'renderer.js'
};

describe('parseManifest', () => {
  it('accepts a well-formed manifest', () => {
    const m = parseManifest(good);
    expect(m.id).toBe('osint');
    expect(m.modules[0].key).toBe('osint:graph');
  });
  it('rejects a bad id', () => {
    expect(() => parseManifest({ ...good, id: 'OSINT!' })).toThrow(ManifestError);
  });
  it('rejects an unknown capability', () => {
    expect(() => parseManifest({ ...good, capabilities: ['egress', 'rootkit'] })).toThrow(ManifestError);
  });
  it('rejects a module key not namespaced to the plugin id', () => {
    expect(() => parseManifest({ ...good, modules: [{ key: 'other:graph', title: 'X', glyph: 'x' }] }))
      .toThrow(ManifestError);
  });
  it('rejects a non-object', () => {
    expect(() => parseManifest(null)).toThrow(ManifestError);
    expect(() => parseManifest('{}')).toThrow(ManifestError);
  });
});
