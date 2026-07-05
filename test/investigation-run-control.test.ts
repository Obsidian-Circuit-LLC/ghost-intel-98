import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
import { vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-run-control-test') } }));
vi.mock('../src/main/storage/secure-fs', () => { const m = new Map<string, string>(); return {
  async secureWriteFile(p: string, d: string) { m.set(p, d); },
  async secureReadText(p: string) { if (!m.has(p)) { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return m.get(p)!; } }; });
const store: { id: string; type: string; value: string }[] = [{ id: 'e1', type: 'domain', value: 'evil.tld' }];
vi.mock('../src/main/storage/entities', () => ({
  async listAll() { return store.map((s) => ({ ...s, notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' })); },
  async create(i: { type: string; value: string }) { const r = { id: `e${store.length + 1}`, ...i }; store.push(r); return { ...r, notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' }; },
}));

import { registerTransform, __clearRegistryForTest } from '../src/main/investigation/registry';
import { startRun, getRunState, __resetRunsForTest, answerRun, stopRun, addScope } from '../src/main/investigation/run-controller';
import { ScriptedBrain } from '../src/main/investigation/scripted-brain';
import { isAuthorized } from '../src/main/investigation/guard';
import { getRun } from '../src/main/investigation/ledger';
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

describe('run control', () => {
  it('ask pauses the run; answerRun resumes it with the human text', async () => {
    registerTransform(whois);
    const { events, d } = deps();
    const brain = new ScriptedBrain([{ kind: 'ask', question: 'which target?' }, { kind: 'done', reason: 'finished' }] as never);
    const p = startRun({ caseId: 'cA', seedIds: ['e1'], objective: 'x', budget, brain, deps: d });
    await new Promise((r) => setImmediate(r));                // let the loop reach the ask + block
    expect(events.some((x) => x.e.kind === 'ask')).toBe(true);
    const runId = events.find((x) => x.e.kind === 'ask')!.id; // find the live run
    answerRun(runId, 'the domain');
    await p;                                                  // run finishes after the answer
    expect(events.some((x) => x.e.kind === 'done')).toBe(true);
  });

  it('addScope authorizes an active target on the live run', async () => {
    registerTransform(whois);
    const { events, d } = deps();
    const brain = new ScriptedBrain([{ kind: 'ask', question: 'which target?' }, { kind: 'done', reason: 'finished' }] as never);
    const p = startRun({ caseId: 'cS', seedIds: ['e1'], objective: 'x', budget, brain, deps: d });
    await new Promise((r) => setImmediate(r));                // let the loop reach the ask + block
    const runId = events.find((x) => x.e.kind === 'ask')!.id; // find the live run
    const before = getRunState(runId);
    expect(before).toBeDefined();
    expect(isAuthorized(before!.guard.scope, 'evil.tld')).toBe(false);
    addScope(runId, 'evil.tld');
    const after = getRunState(runId);
    expect(after).toBeDefined();
    expect(isAuthorized(after!.guard.scope, 'evil.tld')).toBe(true);
    answerRun(runId, 'the domain');
    await p;                                                  // run finishes after the answer
    expect(events.some((x) => x.e.kind === 'done')).toBe(true);
  });

  it('stopRun ends a run blocked on ask', async () => {
    registerTransform(whois);
    const { events, d } = deps();
    // brain asks and never gets a scripted answer; stopRun unblocks + finishes as stopped
    const brain = new ScriptedBrain([{ kind: 'ask', question: 'which target?' }, { kind: 'done', reason: 'finished' }] as never);
    const p = startRun({ caseId: 'cT', seedIds: ['e1'], objective: 'x', budget, brain, deps: d });
    await new Promise((r) => setImmediate(r));                // let the loop reach the ask + block
    const runId = events.find((x) => x.e.kind === 'ask')!.id; // find the live run
    stopRun(runId, 'operator halt');
    await p;                                                  // stopRun unblocks the pending ask
    // cut short before the scripted `done` — the persisted run reflects the forced stop, not 'finished'
    expect(events.some((x) => x.e.kind === 'done' && (x.e as { reason: string }).reason === 'finished')).toBe(false);
    const rec = await getRun('cT', runId);
    expect(rec?.status).toBe('stopped');
    expect(rec?.stopReason).toBe('operator halt');
    expect(getRunState(runId)).toBeUndefined();               // unregistered after finish
  });
});
