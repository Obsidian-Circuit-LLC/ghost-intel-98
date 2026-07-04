import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-invmanualadd-test') } }));
vi.mock('../src/main/storage/secure-fs', () => { const m = new Map<string, string>(); return {
  async secureWriteFile(p: string, d: string) { m.set(p, d); },
  async secureReadText(p: string) { if (!m.has(p)) { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return m.get(p)!; } }; });

interface FakeEntity { id: string; type: string; value: string; notes: string; aliases: string[]; createdAt: string; updatedAt: string }
let store: FakeEntity[] = [];
let nextId = 1;
vi.mock('../src/main/storage/entities', () => ({
  async listAll() { return store; },
  async create(input: { type: string; value: string }) {
    const rec: FakeEntity = { id: `e${nextId++}`, type: input.type, value: input.value, notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' };
    store.push(rec);
    return rec;
  }
}));

import { addManualNode, addManualEdge, sceneForCase, __resetGraphForTest } from '../src/main/investigation/graph';

beforeEach(() => { store = []; nextId = 1; __resetGraphForTest(); });

describe('manual add-node / draw-edge write path', () => {
  it('addManualNode creates the entity (once) and the scene includes it', async () => {
    await addManualNode('caseA', 'domain' as never, 'evil.tld', 'T');
    const s = await sceneForCase('caseA');
    expect(s.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'domain', value: 'evil.tld' })]));
    expect(store).toHaveLength(1);
  });

  it('addManualNode is idempotent for an existing entity (does not duplicate)', async () => {
    await addManualNode('caseA', 'domain' as never, 'evil.tld', 'T');
    await addManualNode('caseA', 'domain' as never, 'evil.tld', 'T2');
    expect(store).toHaveLength(1);
  });

  it('addManualEdge between two existing nodes yields a relation edge in the scene', async () => {
    await addManualNode('caseA', 'domain' as never, 'evil.tld', 'T');
    await addManualNode('caseA', 'email' as never, 'reg@evil.tld', 'T');
    const [a, b] = store.map((e) => e.id);
    await addManualEdge('caseA', a, b, 'registrant-of', 'T');
    const s = await sceneForCase('caseA');
    expect(s.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: a, target: b, relation: 'registrant-of', kind: 'relation' })
    ]));
  });

  it('addManualEdge throws if either entity does not exist', async () => {
    await addManualNode('caseA', 'domain' as never, 'evil.tld', 'T');
    const [a] = store.map((e) => e.id);
    await expect(addManualEdge('caseA', a, 'nope', 'registrant-of', 'T')).rejects.toThrow();
  });
});
