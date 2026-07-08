import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// paths.ts → dataRoot() reads electron's app.getPath('userData'); mock it to a temp dir so the
// real store runs against real files without an Electron runtime (same pattern as
// test/case-category.test.ts).
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-invoice-store-test' } }));

// imported AFTER the mock (vitest hoists vi.mock above imports)
import * as store from '../src/main/invoices/store';

const mkInv = (id: string, number: string) => ({
  id, number, issueDate: '2026-07-08', currency: 'USD', rate: 20,
  sender: { name: 'Me', company: 'GI' }, client: { name: 'C', company: 'Co' },
  lines: [], createdAt: 'x', updatedAt: 'x',
});

describe('invoice store', () => {
  beforeEach(async () => { await store._resetForTest(); });
  it('save/list/remove round-trip', async () => {
    await store.saveInvoice(mkInv('i1', '0001'));
    expect((await store.listInvoices()).map((i) => i.id)).toEqual(['i1']);
    await store.removeInvoice('i1');
    expect(await store.listInvoices()).toEqual([]);
  });
  it('nextInvoiceNumber increments + zero-pads', async () => {
    expect(await store.nextInvoiceNumber()).toBe('0001');
    expect(await store.nextInvoiceNumber()).toBe('0002');
  });
  it('duplicate produces a new id + fresh number, copying content', async () => {
    await store.saveInvoice(mkInv('i1', '0001'));
    const dup = await store.duplicateInvoice('i1');
    expect(dup.id).not.toBe('i1');
    expect(dup.number).not.toBe('0001');
    expect(dup.sender.company).toBe('GI');
  });
  it('putAsset/getAsset round-trips a png as a data URL', async () => {
    const ref = await store.putAsset(Buffer.from([1, 2, 3]), 'image/png');
    expect(ref).toMatch(/\.png$/);
    const a = await store.getAsset(ref);
    expect(a?.mime).toBe('image/png');
    expect(a?.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });
  it('getAsset rejects a path-traversal / non-filename ref (no arbitrary-file read)', async () => {
    // A hostile renderer must not be able to escape invoice-assets/ and read the vault or host
    // files. ensureFileName rejects separators, traversal, and NUL before any secureReadFile.
    for (const ref of ['../invoices.json', '../../../../etc/passwd', 'sub/dir.png', '..', '.', 'a\0b.png', '']) {
      await expect(store.getAsset(ref)).rejects.toThrow();
    }
    // A legitimate `<uuid>.<ext>` ref still resolves normally.
    const ok = await store.putAsset(Buffer.from([9]), 'image/png');
    expect((await store.getAsset(ok))?.mime).toBe('image/png');
  });
});
