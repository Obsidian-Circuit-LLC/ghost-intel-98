import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-turn-test') } }));
vi.mock('../src/main/storage/secure-fs', () => { const m = new Map<string, string>(); return {
  async secureWriteFile(p: string, d: string) { m.set(p, d); },
  async secureReadText(p: string) { if (!m.has(p)) { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return m.get(p)!; } }; });
const store: { id: string; type: string; value: string }[] = [{ id: 'e1', type: 'domain', value: 'evil.tld' }];
vi.mock('../src/main/storage/entities', () => ({
  async listAll() { return store.map((s) => ({ ...s, notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' })); },
  async create(i: { type: string; value: string }) { const r = { id: `e${store.length + 1}`, ...i }; store.push(r); return { ...r, notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' }; },
}));

import { registerTransform, __clearRegistryForTest } from '../src/main/investigation/registry';
import { createGuard, addToScope } from '../src/main/investigation/guard';
import { runOneTurn, newRunState } from '../src/main/investigation/run-controller';
import type { RunEvent } from '../src/shared/investigation-agent';
import type { TransformDescriptor } from '../src/shared/investigation-types';

const passive: TransformDescriptor = { id: 'whois', version: '1', title: 'WHOIS', inputTypes: ['domain'], capabilities: [], active: false,
  run: async () => ({ entities: [{ type: 'email', value: 'r@evil.tld' }], edges: [], signals: [{ kind: 'authoritative-source', weight: 2 }], raw: 'x' }) };
const active: TransformDescriptor = { ...passive, id: 'portscan', active: true };

function rs() { return newRunState('run1', 'caseT', 'find all', ['e1'], createGuard({ maxPivots: 5, maxDepth: 3, maxWallClockMs: 99_999, maxTokens: 9999 }, 0)); }
const sink = (): { events: RunEvent[]; emit: (e: RunEvent) => void } => { const events: RunEvent[] = []; return { events, emit: (e) => events.push(e) }; };

beforeEach(() => { __clearRegistryForTest(); store.length = 0; store.push({ id: 'e1', type: 'domain', value: 'evil.tld' }); });

describe('runOneTurn', () => {
  it('executes a valid passive transform and observes new entities', async () => {
    registerTransform(passive);
    const s = rs(); const { events, emit } = sink();
    const r = await runOneTurn(s, { kind: 'run-transform', transformId: 'whois', entityId: 'e1' }, emit, 0);
    expect(r).toBe('continue');
    expect(s.expanded.has('e1')).toBe(true);
    expect(events.some((e) => e.kind === 'observed')).toBe(true);
    expect(s.lastError).toBeNull();
  });
  it('blocks an unregistered transform (invalid) with lastError', async () => {
    const s = rs(); const { events, emit } = sink();
    await runOneTurn(s, { kind: 'run-transform', transformId: 'nope', entityId: 'e1' }, emit, 0);
    expect(s.lastError).toMatch(/unknown|not registered/i);
    expect(events.some((e) => e.kind === 'blocked')).toBe(true);
  });
  it('blocks an ACTIVE transform on an out-of-scope target; allows after addToScope', async () => {
    registerTransform(active);
    const s = rs(); const { events, emit } = sink();
    await runOneTurn(s, { kind: 'run-transform', transformId: 'portscan', entityId: 'e1' }, emit, 0);
    expect(events.some((e) => e.kind === 'blocked' && e.reason.includes('not-authorized-target'))).toBe(true);
    addToScope(s.guard, 'evil.tld');
    const r2 = await runOneTurn(s, { kind: 'run-transform', transformId: 'portscan', entityId: 'e1' }, emit, 0);
    expect(r2).toBe('continue'); expect(s.lastError).toBeNull();
  });
  it('done ends the turn and sets status', async () => {
    const s = rs(); const { emit } = sink();
    expect(await runOneTurn(s, { kind: 'done', reason: 'finished' }, emit, 0)).toBe('done');
    expect(s.status).toBe('done'); expect(s.stopReason).toBe('finished');
  });
});
