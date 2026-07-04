import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-ledger-test') } }));
// Use a tmpdir-backed secure-fs passthrough if secure-fs requires a key in tests; else mock it:
vi.mock('../src/main/storage/secure-fs', () => {
  const store = new Map<string, string>();
  return {
    async secureWriteFile(p: string, d: string) { store.set(p, d); },
    async secureReadText(p: string) { if (!store.has(p)) { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return store.get(p)!; },
    __store: store,
  };
});

import { appendEvidence, appendFinding, upsertRun, getRun, listEvidence } from '../src/main/investigation/ledger';

const NOW = '2026-07-04T00:00:00.000Z';
beforeEach(() => { /* fresh module state via vi.resetModules not needed; store persists per-file, use unique caseIds */ });

describe('provenance ledger (append-only, encrypted-at-rest)', () => {
  it('appends evidence with a generated id + raw blob ref, and lists it back', async () => {
    const ev = await appendEvidence('caseA', {
      runId: 'run1', transformId: 'stub', transformVersion: '1', inputEntityId: 'ent-x',
      producedEntityIds: ['ent-y'], producedEdges: [], signals: [{ kind: 'authoritative-source', weight: 2 }],
    }, 'RAW OUTPUT', NOW);
    expect(ev.id).toMatch(/^ev-/);
    expect(ev.rawRef).toContain('caseA');
    expect(ev.createdAt).toBe(NOW);
    const list = await listEvidence('caseA', 'run1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(ev.id);
  });

  it('upserts and reads back a run with its action log', async () => {
    await upsertRun('caseB', {
      id: 'run1', caseId: 'caseB', seedEntityIds: ['ent-x'], objective: 'find all',
      budget: { maxPivots: 10, maxDepth: 3, maxWallClockMs: 60000, maxTokens: 100000 },
      status: 'running', actionLog: [{ seq: 1, kind: 'transform', transformId: 'stub', inputEntityId: 'ent-x', at: NOW }],
      createdAt: NOW, updatedAt: NOW,
    });
    const r = await getRun('caseB', 'run1');
    expect(r?.status).toBe('running');
    expect(r?.actionLog[0].transformId).toBe('stub');
  });

  it('is append-only: a second evidence append does not drop the first', async () => {
    await appendEvidence('caseC', { runId: 'r', transformId: 't', transformVersion: '1', inputEntityId: 'e', producedEntityIds: [], producedEdges: [], signals: [] }, 'a', NOW);
    await appendEvidence('caseC', { runId: 'r', transformId: 't', transformVersion: '1', inputEntityId: 'e', producedEntityIds: [], producedEdges: [], signals: [] }, 'b', NOW);
    expect(await listEvidence('caseC')).toHaveLength(2);
  });
});
