/**
 * T8: import a scraping case's results into a main investigation case.
 *
 * `importScrapingCaseToMainCase` reads a scraping case's harvested items + saved artifacts
 * and writes them into the target MAIN case through the EXISTING writers (the SOCMINT
 * upsert-items writer bound to the main caseDir, and the note writer). The scraping case is
 * a SOURCE only — it is never mutated or removed by the import, so the same run can be
 * imported into more than one main case and the scraping store stays intact.
 *
 * The writers are injected so this test exercises the real makeSocmintStore dedup logic for
 * both the source (scraping) and destination (main) sides over an in-memory fs — no Electron.
 */

import { describe, it, expect, vi } from 'vitest';
import { makeSocmintStore } from '../src/main/socmint/store';
import { importScrapingCaseToMainCase } from '../src/main/scraping-cases/import-to-case';
import type { HarvestedItem } from '../src/shared/socmint/types';

const SCRAPING_ID = '22222222-2222-4222-8222-222222222222';
const MAIN_ID = '33333333-3333-4333-8333-333333333333';
const MAIN_ID_2 = '44444444-4444-4444-8444-444444444444';

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
    provenance: { collectorVersion: 'v', jobId: 'j', caseId: SCRAPING_ID },
    ...over,
  };
}

/** An in-memory fs seam usable by makeSocmintStore (readFile must throw ENOENT when absent). */
function memFs() {
  const files = new Map<string, string>();
  return {
    files,
    readFile: vi.fn(async (p: string) => {
      const v = files.get(p);
      if (v === undefined) {
        const e = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
        e.code = 'ENOENT';
        throw e;
      }
      return Buffer.from(v, 'utf8');
    }),
    writeFile: vi.fn(async (p: string, d: string) => {
      files.set(p, d);
    }),
  };
}

/** Build a source (scraping) store + destination (main) store over one in-memory fs,
 *  plus the injected importer deps that wrap them (the "existing writers"). */
function harness() {
  const fs = memFs();
  const srcStore = makeSocmintStore({
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    itemsPath: (id) => `scraping/socmint/${id}/socmint-items.json`,
    jobsPath: (id) => `scraping/socmint/${id}/socmint-jobs.json`,
  });
  const mainStore = makeSocmintStore({
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    // The historical main-case sidecar (pre-migration) — the EXISTING writer target.
    itemsPath: (id) => `cases/${id}/socmint-items.json`,
    jobsPath: (id) => `cases/${id}/socmint-jobs.json`,
  });
  const writeMainNote = vi.fn(async () => {});
  const deps = {
    readItems: (_ns: 'socmint' | 'x', id: string) => srcStore.listItems(id),
    upsertMainItems: (mainCaseId: string, items: HarvestedItem[]) =>
      mainStore.upsertItems(mainCaseId, items),
    readArtifacts: vi.fn(async () => [] as { name: string; content: string }[]),
    writeMainNote,
  };
  return { fs, srcStore, mainStore, writeMainNote, deps };
}

describe('T8: importScrapingCaseToMainCase', () => {
  it('writes the scraping case items into the target main case via the existing writer', async () => {
    const { srcStore, mainStore, deps } = harness();
    const seeded = [item('a'), item('b'), item('c')];
    await srcStore.upsertItems(SCRAPING_ID, seeded);

    const res = await importScrapingCaseToMainCase(deps, 'socmint', SCRAPING_ID, MAIN_ID);

    expect(res.imported).toBe(3);
    // Items landed in the MAIN case store (existing socmint writer, main caseDir).
    expect(await mainStore.listItems(MAIN_ID)).toEqual(seeded);
  });

  it('leaves the scraping case intact (source is read-only; re-importable elsewhere)', async () => {
    const { srcStore, mainStore, deps } = harness();
    const seeded = [item('a'), item('b')];
    await srcStore.upsertItems(SCRAPING_ID, seeded);

    await importScrapingCaseToMainCase(deps, 'socmint', SCRAPING_ID, MAIN_ID);
    // Same scraping case imported into a SECOND main case.
    await importScrapingCaseToMainCase(deps, 'socmint', SCRAPING_ID, MAIN_ID_2);

    // The scraping case still holds exactly its original items — untouched by either import.
    expect(await srcStore.listItems(SCRAPING_ID)).toEqual(seeded);
    expect(await mainStore.listItems(MAIN_ID)).toEqual(seeded);
    expect(await mainStore.listItems(MAIN_ID_2)).toEqual(seeded);
  });

  it('dedups on re-import into the same main case (idempotent via upsert)', async () => {
    const { srcStore, mainStore, deps } = harness();
    await srcStore.upsertItems(SCRAPING_ID, [item('a'), item('b')]);

    const first = await importScrapingCaseToMainCase(deps, 'socmint', SCRAPING_ID, MAIN_ID);
    const second = await importScrapingCaseToMainCase(deps, 'socmint', SCRAPING_ID, MAIN_ID);

    expect(first.imported).toBe(2);
    expect(second.imported).toBe(0); // already present — nothing new written
    expect((await mainStore.listItems(MAIN_ID)).length).toBe(2);
  });

  it('writes each saved artifact into the main case via the note writer', async () => {
    const { srcStore, writeMainNote, deps } = harness();
    await srcStore.upsertItems(SCRAPING_ID, [item('a')]);
    deps.readArtifacts.mockResolvedValueOnce([
      { name: 'export-1.json', content: '{"k":1}' },
      { name: 'export-2.json', content: '{"k":2}' },
    ]);

    await importScrapingCaseToMainCase(deps, 'socmint', SCRAPING_ID, MAIN_ID);

    expect(writeMainNote).toHaveBeenCalledTimes(2);
    expect(writeMainNote).toHaveBeenCalledWith(MAIN_ID, expect.stringContaining('export-1.json'), '{"k":1}');
    expect(writeMainNote).toHaveBeenCalledWith(MAIN_ID, expect.stringContaining('export-2.json'), '{"k":2}');
  });
});
