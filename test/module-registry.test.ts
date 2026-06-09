import { describe, it, expect, beforeEach } from 'vitest';
import { registerModule, getModule, listModules, _resetRegistryForTest, type ModuleDescriptor } from '../src/renderer/state/registry';

const Dummy = (() => null) as unknown as ModuleDescriptor['component'];

describe('ModuleRegistry', () => {
  beforeEach(() => _resetRegistryForTest());

  it('register / get / list round-trips', () => {
    registerModule({ key: 'cases', title: 'My Cases', glyph: '📁', component: Dummy, builtin: true });
    expect(getModule('cases')?.title).toBe('My Cases');
    expect(listModules().map((m) => m.key)).toContain('cases');
  });

  it('duplicate key throws', () => {
    registerModule({ key: 'cases', title: 'A', glyph: 'a', component: Dummy, builtin: true });
    expect(() => registerModule({ key: 'cases', title: 'B', glyph: 'b', component: Dummy, builtin: false })).toThrow();
  });

  it('unknown key returns undefined', () => {
    expect(getModule('nope')).toBeUndefined();
  });
});
