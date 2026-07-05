import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-run-test') } }));
vi.mock('../src/main/storage/secure-fs', () => { const m = new Map<string, string>(); return {
  async secureWriteFile(p: string, d: string) { m.set(p, d); },
  async secureReadText(p: string) { if (!m.has(p)) { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return m.get(p)!; } }; });
const store: { id: string; type: string; value: string }[] = [{ id: 'e1', type: 'domain', value: 'evil.tld' }];
vi.mock('../src/main/storage/entities', () => ({
  async listAll() { return store.map((s) => ({ ...s, notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' })); },
  async create(i: { type: string; value: string }) { const r = { id: `e${store.length + 1}`, ...i }; store.push(r); return { ...r, notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' }; },
}));

import { registerTransform, __clearRegistryForTest } from '../src/main/investigation/registry';
import { startRun, getRunState, __resetRunsForTest } from '../src/main/investigation/run-controller';
import { ScriptedBrain } from '../src/main/investigation/scripted-brain';
import type { RunEvent } from '../src/shared/investigation-agent';
import type { TransformDescriptor } from '../src/shared/investigation-types';

const whois: TransformDescriptor = { id: 'whois', version: '1', title: 'WHOIS', inputTypes: ['domain'], capabilities: [], active: false,
  run: async () => ({ entities: [{ type: 'email', value: 'r@evil.tld' }], edges: [], signals: [], raw: 'x' }) };
const budget = { maxPivots: 3, maxDepth: 3, maxWallClockMs: 99_999, maxTokens: 9999 };
const deps = () => { const events: { id: string; e: RunEvent }[] = []; return { events, d: { emit: (id: string, e: RunEvent) => events.push({ id, e }), now: () => 0, noProgressWindow: 3 } }; };

beforeEach(() => {
  __clearRegistryForTest();
  __resetRunsForTest();
  store.length = 0;
  store.push({ id: 'e1', type: 'domain', value: 'evil.tld' });
});

describe('startRun', () => {
  it('happy path: runs the scripted transforms then done', async () => {
    registerTransform(whois);
    const { events, d } = deps();
    const brain = new ScriptedBrain([{ kind: 'run-transform', transformId: 'whois', entityId: 'e1' }, { kind: 'done', reason: 'finished' }]);
    const runId = await startRun({ caseId: 'cR', seedIds: ['e1'], objective: 'find all', budget, brain, deps: d });
    expect(events.some((x) => x.e.kind === 'observed')).toBe(true);
    expect(events.some((x) => x.e.kind === 'done' && (x.e as { reason: string }).reason === 'finished')).toBe(true);
    expect(getRunState(runId)).toBeUndefined(); // unregistered after finish
  });
  it('budget stop: a brain that keeps pivoting hits maxPivots', async () => {
    registerTransform(whois);
    // distinct domains so each pivot is a genuinely new transform:entity pair — not guard-deduped —
    // so spentPivots actually accrues to the maxPivots(3) budget instead of stalling on dedup.
    store.push({ id: 'e4', type: 'domain', value: 'evil2.tld' }, { id: 'e5', type: 'domain', value: 'evil3.tld' }, { id: 'e6', type: 'domain', value: 'evil4.tld' });
    const { events, d } = deps();
    // 4 distinct pivots but budget is 3 → the guard stops the run
    const brain = new ScriptedBrain([
      { kind: 'run-transform', transformId: 'whois', entityId: 'e1' },
      { kind: 'run-transform', transformId: 'whois', entityId: 'e4' },
      { kind: 'run-transform', transformId: 'whois', entityId: 'e5' },
      { kind: 'run-transform', transformId: 'whois', entityId: 'e6' },
    ]);
    await startRun({ caseId: 'cB', seedIds: ['e1'], objective: 'x', budget, brain, deps: d });
    expect(events.some((x) => x.e.kind === 'stopped' && (x.e as { reason: string }).reason.startsWith('budget'))).toBe(true);
  });
  it('no-progress stop: a brain proposing only duplicates stalls out', async () => {
    registerTransform(whois);
    const { events, d } = deps();
    const brain = new ScriptedBrain(Array.from({ length: 10 }, () => ({ kind: 'run-transform', transformId: 'whois', entityId: 'e1' })) as never);
    await startRun({ caseId: 'cN', seedIds: ['e1'], objective: 'x', budget: { ...budget, maxPivots: 99 }, brain, deps: d });
    expect(events.some((x) => x.e.kind === 'stopped' && (x.e as { reason: string }).reason === 'no-progress')).toBe(true);
  });
});
