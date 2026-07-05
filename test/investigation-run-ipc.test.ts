import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path'; import { tmpdir } from 'node:os';

vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-runipc-test') } }));
vi.mock('../src/main/storage/secure-fs', () => { const m = new Map<string, string>(); return {
  async secureWriteFile(p: string, d: string) { m.set(p, d); },
  async secureReadText(p: string) { if (!m.has(p)) { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return m.get(p)!; } }; });
const store: { id: string; type: string; value: string }[] = [{ id: 'e1', type: 'domain', value: 'evil.tld' }];
vi.mock('../src/main/storage/entities', () => ({
  async listAll() { return store.map((s) => ({ ...s, notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' })); },
  async create(i: { type: string; value: string }) { const r = { id: `e${store.length + 1}`, ...i }; store.push(r); return { ...r, notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' }; },
}));

import { channels } from '../src/shared/ipc-contracts';
import { registerTransform, __clearRegistryForTest } from '../src/main/investigation/registry';
import { __resetRunsForTest } from '../src/main/investigation/run-controller';
import { registerInvestigationRunIpc } from '../src/main/investigation/ipc';
import { ScriptedBrain } from '../src/main/investigation/scripted-brain';
import { ensureUuid } from '../src/main/security/validate';
import type { RunEvent } from '../src/shared/investigation-agent';
import type { TransformDescriptor } from '../src/shared/investigation-types';

const whois: TransformDescriptor = { id: 'whois', version: '1', title: 'WHOIS', inputTypes: ['domain'], capabilities: [], active: false,
  run: async () => ({ entities: [{ type: 'email', value: 'r@evil.tld' }], edges: [], signals: [], raw: 'x' }) };
const budget = { maxPivots: 3, maxDepth: 3, maxWallClockMs: 99_999, maxTokens: 9999 };

beforeEach(() => {
  __clearRegistryForTest();
  __resetRunsForTest();
  store.length = 0;
  store.push({ id: 'e1', type: 'domain', value: 'evil.tld' });
});

/** Minimal `safeHandle`-style test double (mirrors register.ts's real calling convention — see
 *  investigation-ipc.test.ts's makeHandle, same pattern reused here for the run IPC seam). */
function makeHandle(): (channel: string, fnOrArg: unknown, ...rest: unknown[]) => unknown {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  return function handle(channel: string, fnOrArg: unknown, ...rest: unknown[]): unknown {
    if (typeof fnOrArg === 'function') {
      handlers.set(channel, fnOrArg as (...a: unknown[]) => unknown);
      return undefined;
    }
    const h = handlers.get(channel);
    if (!h) throw new Error(`no handler registered for ${channel}`);
    return h(fnOrArg, ...rest);
  };
}

const CASE_UUID = '11111111-1111-4111-8111-111111111111';

describe('registerInvestigationRunIpc', () => {
  it('run:start rejects a non-UUID caseId (validateCaseId is enforced)', () => {
    const handle = makeHandle();
    registerInvestigationRunIpc({
      handle, sendEvent: () => {}, validateCaseId: (id) => ensureUuid(id, 'caseId'),
      now: () => 0, getBrain: () => new ScriptedBrain([{ kind: 'done', reason: 'finished' }])
    });
    expect(() => handle(channels.investigation.run.start, '../../../etc/passwd', ['e1'], 'x', budget)).toThrow(/UUID/i);
  });

  it('run:start returns a runId and forwards run events to sendEvent as { runId, event }', async () => {
    registerTransform(whois);
    const handle = makeHandle();
    const sent: { runId: string; event: RunEvent }[] = [];
    registerInvestigationRunIpc({
      handle, sendEvent: (p) => sent.push(p), validateCaseId: (id) => ensureUuid(id, 'caseId'),
      now: () => 0,
      getBrain: () => new ScriptedBrain([{ kind: 'run-transform', transformId: 'whois', entityId: 'e1' }, { kind: 'done', reason: 'finished' }])
    });
    const runId = handle(channels.investigation.run.start, CASE_UUID, ['e1'], 'find all', budget) as string;
    expect(typeof runId).toBe('string'); // returned IMMEDIATELY (the run loop is detached, not awaited)
    // the run streams events as it progresses — wait for its terminal 'done'
    await vi.waitFor(() => { if (!sent.some((s) => s.event.kind === 'done')) throw new Error('run not finished'); });
    expect(sent.every((s) => s.runId === runId)).toBe(true);
    expect(sent.some((s) => s.event.kind === 'observed')).toBe(true);
  });

  it('run:start throws a guarded error when no brain is available (plugin not installed)', () => {
    const handle = makeHandle();
    registerInvestigationRunIpc({
      handle, sendEvent: () => {}, validateCaseId: (id) => ensureUuid(id, 'caseId'),
      now: () => 0, getBrain: () => null
    });
    expect(() => handle(channels.investigation.run.start, CASE_UUID, ['e1'], 'x', budget)).toThrow(/not installed/i);
  });

  it('control channels (pause/stop/answer/scope/focus/ignore) are wired and no-op for an unknown run', () => {
    const handle = makeHandle();
    registerInvestigationRunIpc({
      handle, sendEvent: () => {}, validateCaseId: (id) => ensureUuid(id, 'caseId'),
      now: () => 0, getBrain: () => new ScriptedBrain([{ kind: 'done', reason: 'finished' }])
    });
    expect(() => handle(channels.investigation.run.pause, 'run-unknown')).not.toThrow();
    expect(() => handle(channels.investigation.run.resume, 'run-unknown')).not.toThrow();
    expect(() => handle(channels.investigation.run.stop, 'run-unknown', 'because')).not.toThrow();
    expect(() => handle(channels.investigation.run.addScope, 'run-unknown', 'evil.tld')).not.toThrow();
    expect(() => handle(channels.investigation.run.removeScope, 'run-unknown', 'evil.tld')).not.toThrow();
    expect(() => handle(channels.investigation.run.focus, 'run-unknown', 'e1')).not.toThrow();
    expect(() => handle(channels.investigation.run.ignore, 'run-unknown', 'e1')).not.toThrow();
    expect(() => handle(channels.investigation.run.answer, 'run-unknown', 'the domain')).not.toThrow();
  });
});
