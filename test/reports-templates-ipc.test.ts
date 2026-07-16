import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// paths.ts → dataRoot() reads electron's app.getPath('userData'); mock it to a temp dir so the
// real store runs against real files without an Electron runtime (same pattern as
// test/reports-introductions-ipc.test.ts).
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-reports-templates-ipc-test' } }));

// imported AFTER the mock (vitest hoists vi.mock above imports)
import { _resetForTest, listTemplates, saveTemplate, removeTemplate } from '../src/main/reports/store';

describe('templates store (IPC round-trip guard)', () => {
  beforeEach(async () => { await _resetForTest(); });
  it('round-trips templates independently of descriptors', async () => {
    await saveTemplate({ id: 't1', name: 'Chain of Custody', createdAt: 'a', updatedAt: 'b', to: 'PO', blocks: [] });
    expect((await listTemplates()).map((x) => x.id)).toEqual(['t1']);
    await removeTemplate('t1');
    expect(await listTemplates()).toEqual([]);
  });
});
