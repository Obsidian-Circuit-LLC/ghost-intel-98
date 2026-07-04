import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-runner-test') } }));
vi.mock('../src/main/storage/secure-fs', () => {
  const store = new Map<string, string>();
  return {
    async secureWriteFile(p: string, d: string) { store.set(p, d); },
    async secureReadText(p: string) { if (!store.has(p)) { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return store.get(p)!; },
  };
});
const created: { type: string; value: string }[] = [];
vi.mock('../src/main/storage/entities', () => ({
  async listAll() { return created.map((c, i) => ({ id: `ent-${i}`, ...c })); },
  async create(input: { type: string; value: string }) { created.push(input); return { id: `ent-${created.length - 1}`, ...input }; },
}));

import { registerTransform, __clearRegistryForTest } from '../src/main/investigation/registry';
import { runTransform } from '../src/main/investigation/runner';
import type { TransformDescriptor } from '../src/shared/investigation-types';

const NOW = '2026-07-04T00:00:00.000Z';
beforeEach(() => { __clearRegistryForTest(); created.length = 0; });

describe('runTransform (contract end-to-end, stub transform)', () => {
  it('runs a transform, merges produced entities, writes evidence, scores confidence', async () => {
    const stub: TransformDescriptor = {
      id: 'whois', version: '1', title: 'WHOIS', inputTypes: ['domain'], capabilities: ['egress'], active: false,
      run: async () => ({
        entities: [{ type: 'email', value: 'reg@evil.tld' }],
        edges: [{ fromValue: 'evil.tld', fromType: 'domain', toValue: 'reg@evil.tld', toType: 'email', relation: 'registrant-of' }],
        signals: [{ kind: 'authoritative-source', weight: 2 }, { kind: 'corroborating-source', weight: 1 }],
        raw: 'Registrant Email: reg@evil.tld',
      }),
    };
    registerTransform(stub);
    const res = await runTransform('caseA', 'run1', 'whois',
      { entityId: 'ent-seed', entityType: 'domain', value: 'evil.tld' }, NOW);
    expect(res.producedEntityIds).toHaveLength(1);
    expect(created).toContainEqual({ type: 'email', value: 'reg@evil.tld' });
    expect(res.evidence.transformId).toBe('whois');
    expect(res.evidence.producedEdges[0].relation).toBe('registrant-of');
    expect(res.confidence.band).toBe('high');
    expect(res.confidence.attribution).toBe('attributed');
  });
  it('reuses an existing entity id (dedup by type+value) instead of creating a duplicate', async () => {
    created.push({ type: 'email', value: 'reg@evil.tld' }); // pre-existing entity → id ent-0
    const stub: TransformDescriptor = {
      id: 'whois', version: '1', title: 'WHOIS', inputTypes: ['domain'], capabilities: [], active: false,
      run: async () => ({
        entities: [{ type: 'email', value: 'reg@evil.tld' }], // same type+value as the existing entity
        edges: [], signals: [{ kind: 'authoritative-source', weight: 2 }], raw: 'x',
      }),
    };
    registerTransform(stub);
    const res = await runTransform('caseD', 'run1', 'whois',
      { entityId: 'ent-seed', entityType: 'domain', value: 'evil.tld' }, NOW);
    expect(res.producedEntityIds).toEqual(['ent-0']); // reused the existing id
    expect(created).toHaveLength(1); // did NOT create a duplicate
  });
  it('throws on an unknown transform id', async () => {
    await expect(runTransform('caseA', 'run1', 'nope',
      { entityId: 'e', entityType: 'domain', value: 'x' }, NOW)).rejects.toThrow(/unknown transform/i);
  });
});
