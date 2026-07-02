/**
 * T8 seam pin: the PRODUCTION import writer and the PRODUCTION item reader must resolve the
 * SAME on-disk path, or imported items are written where no reader ever looks (the
 * writer/reader seam bug — cf. the socmint-collect-path-wiring failure mode). The sibling
 * unit test (scraping-import-to-case.test.ts) injects arbitrary paths for both stores, so it
 * cannot catch a divergence between prodImportScrapingCaseToMainCase's write target and the
 * store.ts prod listItems/listXItems read target. This test exercises the real wiring:
 *
 *   electron is stubbed so the real paths arithmetic runs; secure-fs is mocked with an
 *   in-memory map. We seed a SOURCE scraping case via the prod store, run the prod import into
 *   a MAIN case id, then read that main case back through window.api's reader (store.ts prod
 *   listItems / listXItems). If the writer and reader paths agree the items round-trip; if they
 *   diverge (the pre-fix caseDir sidecar target) the read returns [] and this test fails.
 *
 * Both namespaces are pinned: socmint (window.api.socmint.listItems) and x
 * (window.api.x.listItems) must each land in the store their own reader consults.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HarvestedItem } from '../src/shared/socmint/types';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => `/mock/${name}`,
    getAppPath: () => '/mock/appPath',
  },
}));

// In-memory secure-fs: records every path + round-trips bytes so upsert/list works, and proves
// the at-rest choke-point (never the plain fs bypass) is used on both sides of the import.
const files = new Map<string, Buffer>();
vi.mock('../src/main/storage/secure-fs', () => ({
  secureReadFile: vi.fn(async (p: string): Promise<Buffer> => {
    if (!files.has(p)) {
      const e = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
      e.code = 'ENOENT';
      throw e;
    }
    return files.get(p)!;
  }),
  secureReadText: vi.fn(async (p: string): Promise<string> => {
    if (!files.has(p)) {
      const e = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
      e.code = 'ENOENT';
      throw e;
    }
    return files.get(p)!.toString('utf8');
  }),
  secureWriteFile: vi.fn(async (p: string, d: Buffer | string): Promise<void> => {
    files.set(p, typeof d === 'string' ? Buffer.from(d, 'utf8') : d);
  }),
}));

const SRC_ID = '22222222-2222-4222-8222-222222222222';
const MAIN_ID = '33333333-3333-4333-8333-333333333333';

function item(id: string, over: Partial<HarvestedItem> = {}): HarvestedItem {
  return {
    id,
    platform: 'telegram',
    authorHandle: 'h',
    authorId: 'a',
    text: `t-${id}`,
    channelId: 'c',
    channelLabel: 'C',
    messageId: id,
    publishedAt: '2026-01-01T00:00:00.000Z',
    harvestedAt: '2026-01-02T00:00:00.000Z',
    url: 'https://t.me/c/1',
    provenance: { collectorVersion: 'v', jobId: 'j', caseId: SRC_ID },
    ...over,
  };
}

describe('T8 seam: prod import writer path == prod reader path', () => {
  beforeEach(() => {
    files.clear();
    vi.clearAllMocks();
  });

  it('socmint import lands where window.api.socmint.listItems(mainId) reads it', async () => {
    const store = await import('../src/main/socmint/store');
    const { prodImportScrapingCaseToMainCase } = await import(
      '../src/main/scraping-cases/import-to-case'
    );
    const { scrapingCaseItemsFile, caseDir } = await import('../src/main/storage/paths');

    // Seed the SOURCE scraping case through the real socmint prod store.
    const seeded = [item('a'), item('b'), item('c')];
    await store.upsertItems(SRC_ID, seeded);

    const res = await prodImportScrapingCaseToMainCase('socmint', SRC_ID, MAIN_ID);
    expect(res.imported).toBe(3);

    // The reader the main-case SOCMINT view uses (store.ts prod listItems, behind
    // window.api.socmint.listItems) must see exactly the imported items.
    const readBack = await store.listItems(MAIN_ID);
    expect(readBack).toEqual(seeded);

    // Concretely: the bytes were written at the reader's path, and NOT at the orphaned
    // pre-fix caseDir sidecar that no post-W4 reader opens.
    expect([...files.keys()]).toContain(scrapingCaseItemsFile('socmint', MAIN_ID));
    const orphan = `${caseDir(MAIN_ID)}/socmint-items.json`;
    expect([...files.keys()]).not.toContain(orphan);
  });

  it('x import lands where window.api.x.listItems(mainId) reads it (not the socmint store)', async () => {
    const store = await import('../src/main/socmint/store');
    const { prodImportScrapingCaseToMainCase } = await import(
      '../src/main/scraping-cases/import-to-case'
    );
    const { scrapingCaseItemsFile } = await import('../src/main/storage/paths');

    const seeded = [item('x1', { platform: 'x' }), item('x2', { platform: 'x' })];
    await store.upsertXItems(SRC_ID, seeded);

    const res = await prodImportScrapingCaseToMainCase('x', SRC_ID, MAIN_ID);
    expect(res.imported).toBe(2);

    // The x reader sees the items; the socmint reader (different namespace store) does not.
    expect(await store.listXItems(MAIN_ID)).toEqual(seeded);
    expect(await store.listItems(MAIN_ID)).toEqual([]);

    expect([...files.keys()]).toContain(scrapingCaseItemsFile('x', MAIN_ID));
    expect([...files.keys()]).not.toContain(scrapingCaseItemsFile('socmint', MAIN_ID));
  });
});
