import { describe, it, expect, beforeEach, vi } from 'vitest';

// paths.ts → dataRoot() reads electron's app.getPath('userData'); mock it to a temp dir so the
// real store runs against real files without an Electron runtime (same pattern as
// test/reports-store.test.ts).
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-reports-templates-store-test' } }));

// imported AFTER the mock (vitest hoists vi.mock above imports)
import { _resetForTest, listTemplates, saveTemplate, removeTemplate, putAsset, copyAsset, getAsset } from '../src/main/reports/store';
import { ensureReport, ensureReportTemplate } from '../src/main/security/validate';

describe('templates store + validators', () => {
  beforeEach(async () => { await _resetForTest(); });

  it('round-trips a template', async () => {
    const t = await saveTemplate({ id: 't1', name: 'Chain of Custody', createdAt: 'a', updatedAt: 'b', to: 'PO', blocks: [] } as any);
    expect((await listTemplates()).map((x) => x.id)).toEqual(['t1']);
    await removeTemplate('t1');
    expect(await listTemplates()).toEqual([]);
    expect(t.name).toBe('Chain of Custody');
  });

  it('copyAsset makes an independent copy', async () => {
    const ref = await putAsset(Buffer.from([1, 2, 3]), 'image/png');
    const copy = await copyAsset(ref);
    expect(copy).toBeTruthy();
    expect(copy).not.toBe(ref);
    const a = await getAsset(copy!);
    expect(a?.bytes.length).toBe(3);
  });

  it('ensureReport bounds metadata; ensureReportTemplate requires id+name', () => {
    const r = ensureReport({ id: 'r', to: '', blocks: [], caseNumber: 'CASE-1', classification: 'Confidential' });
    expect(r.caseNumber).toBe('CASE-1');
    expect(r.classification).toBe('Confidential');
    expect(() => ensureReportTemplate({ name: 'x' })).toThrow(/id/);
    const t = ensureReportTemplate({ id: 't', name: 'T', to: '', blocks: [] });
    expect(t.name).toBe('T');
  });
});
