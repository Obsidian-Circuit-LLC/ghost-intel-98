import { describe, it, expect, vi } from 'vitest';
vi.mock('../src/main/investigation/graph', () => ({
  async sceneForCase() {
    return { nodes: [
      { id: 'e1', type: 'domain', value: 'evil.tld', cluster: 0, score: 1, x: 0, y: 0 },
      { id: 'e2', type: 'email', value: 'r@evil.tld', cluster: 0, score: 0.6, x: 0, y: 0 },
      { id: 'e3', type: 'ip', value: '1.2.3.4', cluster: 0, score: 0.3, x: 0, y: 0 },
    ], edges: [] };
  },
}));
vi.mock('../src/main/investigation/ledger', () => ({ async listFindings() { return [{ id: 'f', runId: 'r', claim: 'evil is bad', evidenceIds: [], confidence: { band: 'high', attribution: 'attributed', score: 4 }, createdAt: 'T' }]; } }));
vi.mock('../src/main/investigation/registry', () => ({ listTransforms() { return [{ id: 'whois', version: '1', title: 'WHOIS', inputTypes: ['domain'], capabilities: [], active: false, run: async () => ({ entities: [], edges: [], signals: [], raw: '' }) }]; } }));

import { assembleContext } from '../src/main/investigation/perceive';
import { createGuard } from '../src/main/investigation/guard';

const base = () => ({
  caseId: 'c', objective: 'find all', guard: createGuard({ maxPivots: 5, maxDepth: 3, maxWallClockMs: 10_000, maxTokens: 1000 }, 0),
  now: 2_000, seedIds: ['e1'], depth: new Map([['e1', 0], ['e2', 1]]), expanded: new Set(['e1']),
  focus: new Set<string>(), ignore: new Set<string>(), humanInput: null, lastError: null,
});

describe('assembleContext', () => {
  it('builds a bounded context: seeds, key entities by score, frontier = not-yet-expanded', async () => {
    const ctx = await assembleContext(base());
    expect(ctx.objective).toBe('find all');
    expect(ctx.seeds.map((s) => s.entityId)).toEqual(['e1']);
    expect(ctx.keyEntities.map((n) => n.entityId)).toEqual(['e1', 'e2', 'e3']); // score desc
    expect(ctx.frontier.map((n) => n.entityId)).toEqual(['e2', 'e3']);          // e1 already expanded, excluded
    expect(ctx.keyEntities.find((n) => n.entityId === 'e2')!.depth).toBe(1);     // from the depth map
    expect(ctx.recentFindings).toEqual(['evil is bad']);
    expect(ctx.transforms).toEqual([{ id: 'whois', title: 'WHOIS', inputTypes: ['domain'], active: false }]);
  });
  it('reflects the guard budget and passes through humanInput/lastError', async () => {
    const ctx = await assembleContext({ ...base(), humanInput: 'focus on the IP', lastError: 'bad transform' });
    expect(ctx.budget.pivotsLeft).toBe(5);            // nothing spent yet
    expect(ctx.budget.wallClockMsLeft).toBe(8_000);   // 10000 - (now 2000 - startedAt 0)
    expect(ctx.humanInput).toBe('focus on the IP');
    expect(ctx.lastError).toBe('bad transform');
  });
  it('honors ignore (excluded) and focus (ranked first)', async () => {
    const ctx = await assembleContext({ ...base(), ignore: new Set(['e2']), focus: new Set(['e3']) });
    expect(ctx.keyEntities.map((n) => n.entityId)).toEqual(['e3', 'e1']); // e3 focused first, e2 ignored out
  });
});
