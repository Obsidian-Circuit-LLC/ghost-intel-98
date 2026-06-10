import { describe, it, expect } from 'vitest';
import { CAPABILITIES, type Capability, type PluginManifest } from '../src/shared/plugin-types';

describe('plugin-types', () => {
  it('exposes the closed capability set', () => {
    expect([...CAPABILITIES].sort()).toEqual(
      ['authorized-target-egress', 'case-storage', 'egress', 'entity-registry', 'plugin-storage', 'secrets', 'timeline']
    );
  });

  it('a well-formed manifest object is assignable to PluginManifest', () => {
    const m: PluginManifest = {
      id: 'osint', name: 'OSINT', version: '1.0.0', targetApiVersion: 1,
      modules: [{ key: 'osint:graph', title: 'OSINT', glyph: '🕸' }],
      capabilities: ['egress'] as Capability[], main: 'main.js', renderer: 'renderer.js'
    };
    expect(m.id).toBe('osint');
  });
});
