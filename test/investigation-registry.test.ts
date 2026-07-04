import { describe, it, expect, beforeEach } from 'vitest';
import { registerTransform, getTransform, listTransforms, transformsForType, __clearRegistryForTest } from '../src/main/investigation/registry';
import type { TransformDescriptor } from '../src/shared/investigation-types';
import { ENTITY_TYPES } from '../src/shared/types';

const stub = (id: string, inputTypes: TransformDescriptor['inputTypes']): TransformDescriptor => ({
  id, version: '1', title: id, inputTypes, capabilities: [], active: false,
  run: async () => ({ entities: [], edges: [], signals: [], raw: '' }),
});

beforeEach(() => __clearRegistryForTest());

describe('transform registry', () => {
  it('registers and looks up a transform', () => {
    registerTransform(stub('whois', ['domain']));
    expect(getTransform('whois')?.id).toBe('whois');
    expect(listTransforms()).toHaveLength(1);
  });
  it('rejects a duplicate id', () => {
    registerTransform(stub('whois', ['domain']));
    expect(() => registerTransform(stub('whois', ['domain']))).toThrow(/already registered/i);
  });
  it('filters transforms by accepted input type', () => {
    registerTransform(stub('whois', ['domain']));
    registerTransform(stub('sherlock', ['username']));
    expect(transformsForType('username').map((t) => t.id)).toEqual(['sherlock']);
  });
  it('EntityType is extended with the OSINT types additively', () => {
    for (const t of ['url', 'hostname', 'asn', 'certificate', 'username', 'file-hash']) {
      expect(ENTITY_TYPES).toContain(t);
    }
    expect(ENTITY_TYPES).toContain('person'); // existing preserved
  });
});
