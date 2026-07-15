import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// paths.ts → dataRoot() reads electron's app.getPath('userData'); mock it to a temp dir so the
// real store runs against real files without an Electron runtime (same pattern as
// test/invoice-store.test.ts).
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-reports-store-test' } }));

// imported AFTER the mock (vitest hoists vi.mock above imports)
import * as store from '../src/main/reports/store';
import { ensureReport, ensureContact, ensureDescriptor } from '../src/main/security/validate';

const mkReport = (id: string, title = 'Report') => ({
  id, title, createdAt: 'x', updatedAt: 'x', to: 'Someone', blocks: [] as unknown[],
});

describe('reports store', () => {
  beforeEach(async () => { await store._resetForTest(); });

  it('save/list/remove a report round-trips', async () => {
    await store.saveReport(mkReport('r1') as never);
    expect((await store.listReports()).map((r) => r.id)).toEqual(['r1']);
    await store.removeReport('r1');
    expect(await store.listReports()).toEqual([]);
  });

  it('save/list/remove a contact round-trips', async () => {
    await store.saveContact({ id: 'c1', name: 'Jane Doe' });
    expect((await store.listContacts()).map((c) => c.id)).toEqual(['c1']);
    await store.removeContact('c1');
    expect(await store.listContacts()).toEqual([]);
  });

  it('save/list/remove a descriptor round-trips', async () => {
    await store.saveDescriptor({ id: 'd1', name: 'OSINT.Industries', body: 'A tool that finds public links.' });
    expect((await store.listDescriptors()).map((d) => d.id)).toEqual(['d1']);
    await store.removeDescriptor('d1');
    expect(await store.listDescriptors()).toEqual([]);
  });

  it('putAsset/getAsset round-trips a png as raw bytes + mime', async () => {
    const ref = await store.putAsset(Buffer.from([1, 2, 3]), 'image/png');
    expect(ref).toMatch(/\.png$/);
    const a = await store.getAsset(ref);
    expect(a?.mime).toBe('image/png');
    expect(a?.bytes.equals(Buffer.from([1, 2, 3]))).toBe(true);
  });

  it('getAsset rejects a path-traversal / non-filename ref (no arbitrary-file read)', async () => {
    for (const ref of ['../reports.json', '../../../../etc/passwd', 'sub/dir.png', '..', '.', 'a\0b.png', '']) {
      await expect(store.getAsset(ref)).rejects.toThrow();
    }
    const ok = await store.putAsset(Buffer.from([9]), 'image/png');
    expect((await store.getAsset(ok))?.mime).toBe('image/png');
  });
});

describe('report/contact/descriptor validators', () => {
  it('ensureReport clamps widthPct into [10,100]', () => {
    const over = ensureReport({
      id: 'r1', title: 't', createdAt: 'x', updatedAt: 'x', to: 'x',
      blocks: [{ id: 'b1', kind: 'image', assetRef: 'a.png', widthPct: 500, caption: 'c' }]
    });
    expect(over.blocks[0]).toMatchObject({ widthPct: 100 });

    const under = ensureReport({
      id: 'r2', title: 't', createdAt: 'x', updatedAt: 'x', to: 'x',
      blocks: [{ id: 'b2', kind: 'image', assetRef: 'a.png', widthPct: -5, caption: 'c' }]
    });
    expect(under.blocks[0]).toMatchObject({ widthPct: 10 });
  });

  it('ensureReport caps an overlong title at 200 chars', () => {
    const r = ensureReport({ id: 'r1', title: 'x'.repeat(1000), createdAt: 'x', updatedAt: 'x', to: '', blocks: [] });
    expect(r.title.length).toBe(200);
  });

  it('ensureReport drops a block of an unknown kind', () => {
    const r = ensureReport({
      id: 'r1', title: 't', createdAt: 'x', updatedAt: 'x', to: 'x',
      blocks: [
        { id: 'b1', kind: 'text', html: '<b>ok</b>' },
        { id: 'b2', kind: 'nefarious', html: '<script>bad()</script>' }
      ]
    });
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]).toMatchObject({ kind: 'text' });
  });

  it('ensureReport caps blocks at 400 and bounds block html/caption length', () => {
    const manyBlocks = Array.from({ length: 500 }, (_, i) => ({ id: `b${i}`, kind: 'text', html: 'x' }));
    const r = ensureReport({ id: 'r1', title: 't', createdAt: 'x', updatedAt: 'x', to: 'x', blocks: manyBlocks });
    expect(r.blocks.length).toBe(400);

    const r2 = ensureReport({
      id: 'r2', title: 't', createdAt: 'x', updatedAt: 'x', to: 'x',
      blocks: [{ id: 'b1', kind: 'text', html: 'y'.repeat(100_000) }]
    });
    expect((r2.blocks[0] as { html: string }).html.length).toBe(50_000);
  });

  it('ensureReport rejects a path-traversal bannerRef by dropping it', () => {
    const r = ensureReport({ id: 'r1', title: 't', createdAt: 'x', updatedAt: 'x', to: 'x', blocks: [], bannerRef: '../../../etc/passwd' });
    expect(r.bannerRef).toBeUndefined();
  });

  it('ensureContact caps overlong fields at 400 chars', () => {
    const c = ensureContact({ id: 'c1', name: 'y'.repeat(1000), org: 'z'.repeat(1000) });
    expect(c.name.length).toBe(400);
    expect(c.org?.length).toBe(400);
  });

  it('ensureDescriptor caps overlong body at 10,000 chars', () => {
    const d = ensureDescriptor({ id: 'd1', name: 'n', body: 'z'.repeat(20_000) });
    expect(d.body.length).toBe(10_000);
  });
});
