import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-invemit-test') } }));
vi.mock('../src/main/storage/secure-fs', () => { const m = new Map<string, string>(); return {
  async secureWriteFile(p: string, d: string) { m.set(p, d); },
  async secureReadText(p: string) { if (!m.has(p)) { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return m.get(p)!; } }; });
const entities = [{ id: 'e1', type: 'domain', value: 'evil.tld', notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' }];
vi.mock('../src/main/storage/entities', () => ({ async listAll() { return entities; } }));

import { appendEvidence } from '../src/main/investigation/ledger';
import { startGraphEmitter, onSceneDelta, __resetGraphForTest } from '../src/main/investigation/graph';

beforeEach(() => __resetGraphForTest());

describe('graph emitter', () => {
  it('debounces ledger appends into one delta with the new node', async () => {
    let fire: (() => void) | null = null;
    startGraphEmitter({ setTimeoutFn: ((cb: () => void) => { fire = cb; return 1 as never; }) as never, clearTimeoutFn: (() => {}) as never });
    const deltas: unknown[] = [];
    onSceneDelta('caseA', (d) => deltas.push(d));
    await appendEvidence('caseA', { runId: 'r', transformId: 't', transformVersion: '1', inputEntityId: 'e1', producedEntityIds: ['e1'], producedEdges: [], signals: [] }, 'raw', 'T');
    await appendEvidence('caseA', { runId: 'r', transformId: 't', transformVersion: '1', inputEntityId: 'e1', producedEntityIds: ['e1'], producedEdges: [], signals: [] }, 'raw2', 'T');
    expect(deltas).toHaveLength(0);   // still debounced
    fire!();                           // fire the debounce timer
    await new Promise((r) => setImmediate(r));
    expect(deltas).toHaveLength(1);   // ONE coalesced delta
    expect((deltas[0] as { added: { id: string }[] }).added.map((n) => n.id)).toContain('e1');
  });
});
