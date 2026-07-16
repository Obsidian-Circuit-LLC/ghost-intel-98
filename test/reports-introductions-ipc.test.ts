import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// paths.ts → dataRoot() reads electron's app.getPath('userData'); mock it to a temp dir so the
// real store runs against real files without an Electron runtime (same pattern as
// test/reports-store.test.ts).
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-reports-introductions-test' } }));

// imported AFTER the mock (vitest hoists vi.mock above imports)
import { _resetForTest, listIntroductions, saveIntroduction, removeIntroduction } from '../src/main/reports/store';

describe('introductions store', () => {
  beforeEach(async () => { await _resetForTest(); });
  it('round-trips introductions independently of descriptors', async () => {
    await saveIntroduction({ id: 'i1', name: 'Standard', body: 'This report summarizes…' });
    expect(await listIntroductions()).toEqual([{ id: 'i1', name: 'Standard', body: 'This report summarizes…' }]);
    await removeIntroduction('i1');
    expect(await listIntroductions()).toEqual([]);
  });
});
