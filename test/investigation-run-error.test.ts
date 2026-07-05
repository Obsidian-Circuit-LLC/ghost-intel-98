import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path'; import { tmpdir } from 'node:os';

vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-run-err-test') } }));
vi.mock('../src/main/storage/secure-fs', () => ({
  async secureWriteFile() {},
  async secureReadText() { const e: NodeJS.ErrnoException = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
}));
// The perceive step throws (simulating a storage/graph failure). Before the fix this escaped the loop
// and left the run stuck 'running' + leaked in the registry map forever (adversarial CRITICAL).
vi.mock('../src/main/investigation/perceive', () => ({ async assembleContext() { throw new Error('perceive failed'); } }));

import { startRun, getRunState, __resetRunsForTest } from '../src/main/investigation/run-controller';
import { ScriptedBrain } from '../src/main/investigation/scripted-brain';
import type { RunEvent } from '../src/shared/investigation-agent';

beforeEach(() => __resetRunsForTest());

describe('run finalizes on a perceive/storage error (no stuck-running leak)', () => {
  it('an assembleContext throw finalizes the run as stopped and unregisters it', async () => {
    const events: { id: string; e: RunEvent }[] = [];
    const brain = new ScriptedBrain([{ kind: 'done', reason: 'x' }]);
    const { runId, completed } = startRun({
      caseId: 'cErr', seedIds: ['e1'], objective: 'x',
      budget: { maxPivots: 5, maxDepth: 3, maxWallClockMs: 9999, maxTokens: 999 },
      brain, deps: { emit: (id, e) => events.push({ id, e }), now: () => 0 },
    });
    await completed; // must resolve (not hang) even though the loop hit an uncaught error
    expect(getRunState(runId)).toBeUndefined(); // unregistered — no leak
    expect(events.some((x) => x.e.kind === 'stopped' && (x.e as { reason: string }).reason.startsWith('error:'))).toBe(true);
  });
});
