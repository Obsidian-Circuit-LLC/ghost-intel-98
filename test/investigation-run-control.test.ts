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
import { startRun, getRunState, __resetRunsForTest, answerRun, stopRun, addScope, pauseRun, resumeRun } from '../src/main/investigation/run-controller';
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
    const { runId, completed } = startRun({ caseId: 'cA', seedIds: ['e1'], objective: 'x', budget, brain, deps: d });
    await new Promise((r) => setImmediate(r));                // let the loop reach the ask + block
    expect(events.some((x) => x.e.kind === 'ask')).toBe(true);
    answerRun(runId, 'the domain');                          // runId is returned immediately now
    await completed;
    expect(events.some((x) => x.e.kind === 'done')).toBe(true);
  });

  it('addScope authorizes an active target on the live run', async () => {
    registerTransform(whois);
    const { events, d } = deps();
    const brain = new ScriptedBrain([{ kind: 'ask', question: 'which target?' }, { kind: 'done', reason: 'finished' }] as never);
    const { runId, completed } = startRun({ caseId: 'cS', seedIds: ['e1'], objective: 'x', budget, brain, deps: d });
    await new Promise((r) => setImmediate(r));
    expect(isAuthorized(getRunState(runId)!.guard.scope, 'evil.tld')).toBe(false);
    addScope(runId, 'evil.tld');
    expect(isAuthorized(getRunState(runId)!.guard.scope, 'evil.tld')).toBe(true);
    answerRun(runId, 'the domain');
    await completed;
    expect(events.some((x) => x.e.kind === 'done')).toBe(true);
  });

  it('stopRun ends a run blocked on ask', async () => {
    registerTransform(whois);
    const { events, d } = deps();
    const brain = new ScriptedBrain([{ kind: 'ask', question: 'which target?' }, { kind: 'done', reason: 'finished' }] as never);
    const { runId, completed } = startRun({ caseId: 'cT', seedIds: ['e1'], objective: 'x', budget, brain, deps: d });
    await new Promise((r) => setImmediate(r));
    stopRun(runId, 'operator halt');
    await completed;                                          // stopRun unblocks the pending ask
    expect(events.some((x) => x.e.kind === 'done' && (x.e as { reason: string }).reason === 'finished')).toBe(false);
    const rec = await getRun('cT', runId);
    expect(rec?.status).toBe('stopped');
    expect(rec?.stopReason).toBe('operator halt');
    expect(getRunState(runId)).toBeUndefined();
  });

  it('pauseRun truly parks the loop (no new decide, no no-progress auto-stop); resumeRun un-parks — with events', async () => {
    registerTransform(whois);
    const { events, d } = deps();
    // Gated brain: each decide() blocks until the test releases it, so turn boundaries are deterministic.
    let release: (() => void) | null = null;
    let decides = 0;
    const brain = { async decide() { decides++; await new Promise<void>((r) => { release = r; }); return { kind: 'run-transform' as const, transformId: 'whois', entityId: 'e1' }; } };
    const { runId, completed } = startRun({ caseId: 'cP', seedIds: ['e1'], objective: 'x', budget: { ...budget, maxPivots: 99 }, brain: brain as never, deps: d });
    await new Promise((r) => setImmediate(r));               // loop reaches decide #1, blocks on the gate
    expect(decides).toBe(1);
    pauseRun(runId);
    expect(events.some((x) => x.e.kind === 'paused')).toBe(true);
    release!();                                              // finish turn 1 → loop should PARK (paused), not decide again
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(decides).toBe(1);                                 // parked: no new decide while paused
    expect(getRunState(runId)!.status).toBe('running');      // still live, NOT no-progress-stopped
    resumeRun(runId);
    expect(events.some((x) => x.e.kind === 'resumed')).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(decides).toBe(2);                                 // resumed: decide called again
    stopRun(runId, 'done'); release?.(); await completed;    // clean up
  });
});
