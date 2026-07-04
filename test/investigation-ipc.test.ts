import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path'; import { tmpdir } from 'node:os';

vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-invipc-test') } }));
vi.mock('../src/main/storage/secure-fs', () => { const m = new Map<string, string>(); return {
  async secureWriteFile(p: string, d: string) { m.set(p, d); },
  async secureReadText(p: string) { if (!m.has(p)) { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return m.get(p)!; } }; });
const entities = [{ id: 'e1', type: 'domain', value: 'evil.tld', notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' }];
vi.mock('../src/main/storage/entities', () => ({ async listAll() { return entities; } }));

import { channels } from '../src/shared/ipc-contracts';
import { appendEvidence } from '../src/main/investigation/ledger';
import { __resetGraphForTest } from '../src/main/investigation/graph';
import { registerInvestigationGraphIpc } from '../src/main/investigation/ipc';
import type { InvestigationScene, SceneDelta } from '../src/shared/investigation-graph';

beforeEach(() => __resetGraphForTest());

/** Minimal `safeHandle`-style test double (mirrors register.ts's real calling convention: the
 *  registered fn is called with the bare args, no ipcRenderer event). Registers a handler when
 *  given a function, and invokes the already-registered handler for that channel when given a
 *  plain arg — lets the test both wire `registerInvestigationGraphIpc` and drive it through the
 *  same `handle` reference. */
function makeHandle(): (channel: string, fnOrArg: unknown) => unknown {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  return function handle(channel: string, fnOrArg: unknown): unknown {
    if (typeof fnOrArg === 'function') {
      handlers.set(channel, fnOrArg as (...a: unknown[]) => unknown);
      return undefined;
    }
    const h = handlers.get(channel);
    if (!h) throw new Error(`no handler registered for ${channel}`);
    return h(fnOrArg);
  };
}

describe('registerInvestigationGraphIpc', () => {
  it('investigation:graph resolves the scene for a case', async () => {
    const handle = makeHandle();
    registerInvestigationGraphIpc({ handle, sendToWatchers: () => {} });
    const scene = (await handle(channels.investigation.graph, 'caseA')) as InvestigationScene;
    expect(scene).toHaveProperty('nodes');
    expect(scene).toHaveProperty('edges');
  });

  it('forwards a ledger-driven delta to sendToWatchers for a watched case', async () => {
    const handle = makeHandle();
    const sent: { caseId: string; delta: SceneDelta }[] = [];
    registerInvestigationGraphIpc({ handle, sendToWatchers: (p) => sent.push(p) });
    await handle(channels.investigation.graph, 'caseA'); // first fetch subscribes caseA as a watcher
    await appendEvidence(
      'caseA',
      { runId: 'r', transformId: 't', transformVersion: '1', inputEntityId: 'e1', producedEntityIds: ['e1'], producedEdges: [], signals: [] },
      'raw',
      'T'
    );
    await new Promise((r) => setTimeout(r, 250)); // real debounce timer (150ms) + margin
    expect(sent).toHaveLength(1);
    expect(sent[0].caseId).toBe('caseA');
    expect(sent[0].delta.added.map((n) => n.id)).toContain('e1');
  }, 10000);
});
