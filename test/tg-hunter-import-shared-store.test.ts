/**
 * TG5 — Telegram Desktop import must REACH the shared socmint case store.
 *
 * Before this fix `importTelegramExport` wrote parsed messages ONLY to the per-tool
 * `tg-imports.json` audit set (`store.imports.add`), which nothing reads — so imported
 * messages never appeared in Harvested Items / exports / keyword scans, and the
 * content-based dedup surface (`dedupKeyForItem` / `dedupItems` / `store.dedup`) was dead.
 *
 * These tests pin the corrected behavior against injected in-memory deps (no electron,
 * no disk, no dialog):
 *   1. imported messages are normalized into `HarvestedItem`s and upserted into the SHARED
 *      case store (the same store live capture writes) — `listItems` now contains them,
 *      honesty-stamped (platform telegram, verified:false, visible-capture);
 *   2. re-importing the same export dedups (no duplicate rows);
 *   3. an imported message whose CONTENT matches an already-captured message collapses to
 *      ONE record (cross-source dedup via the shared content key) — the collector comment
 *      is now true.
 */
import { describe, it, expect } from 'vitest';
import { importTelegramExport, type TgImportDeps } from '../src/main/socmint/telegram-hunter/ipc';
import { makeTgHunterStore, type TgHunterStore } from '../src/main/socmint/telegram-hunter/store';
import { makeSocmintStore } from '../src/main/socmint/store';
import type { HarvestedItem } from '@shared/socmint/types';

const CASE_ID = '11111111-1111-4111-8111-111111111111';

const EXPORT = {
  chats: {
    list: [
      {
        id: 1,
        name: 'Ops',
        messages: [
          { id: 10, from: 'Jane', from_id: 'user1', date: '2026-01-01', text: 'hello world' },
          { id: 11, from: 'Bob', from_id: 'user2', date: '2026-01-02', text: 'second msg' },
        ],
      },
    ],
  },
};

/** An in-memory fs seam shared by both stores (ENOENT before first write). */
function memFs() {
  const files = new Map<string, string>();
  return {
    readFile: async (p: string): Promise<Buffer> => {
      if (!files.has(p)) {
        const e = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
        e.code = 'ENOENT';
        throw e;
      }
      return Buffer.from(files.get(p) as string, 'utf8');
    },
    writeFile: async (p: string, d: string): Promise<void> => {
      files.set(p, d);
    },
  };
}

interface Harness {
  deps: TgImportDeps;
  tgStore: TgHunterStore;
  listTelegram: (caseId: string) => Promise<HarvestedItem[]>;
  seedCaptured: (caseId: string, items: HarvestedItem[]) => Promise<void>;
}

function harness(): Harness {
  const fs = memFs();
  const tgStore = makeTgHunterStore({
    ...fs,
    membersPath: (id) => `m:${id}`,
    profilesPath: (id) => `p:${id}`,
    keywordWatchPath: (id) => `kw:${id}`,
    importsPath: (id) => `imp:${id}`,
    dedupPath: (id) => `dedup:${id}`,
  });
  const socmintStore = makeSocmintStore({
    ...fs,
    itemsPath: (id) => `items:${id}`,
    jobsPath: (id) => `jobs:${id}`,
  });
  const listTelegram = async (caseId: string) =>
    (await socmintStore.listItems(caseId)).filter((it) => it.platform === 'telegram');
  const deps: TgImportDeps = {
    pickExportFile: async () => '/exports/result.json',
    readTextFile: async () => JSON.stringify(EXPORT),
    now: () => '2026-08-07T00:00:00.000Z',
    store: async () => tgStore,
    listTelegramItems: listTelegram,
    upsertItems: (caseId, items) => socmintStore.upsertItems(caseId, items),
  };
  return {
    deps,
    tgStore,
    listTelegram,
    seedCaptured: async (caseId, items) => {
      await socmintStore.upsertItems(caseId, items);
    },
  };
}

describe('importTelegramExport → shared socmint case store', () => {
  it('normalizes imported messages into the SHARED store (honesty-stamped)', async () => {
    const h = harness();
    const res = await importTelegramExport(CASE_ID_REQ(), h.deps);
    expect(res.canceled).toBe(false);
    expect(res.itemCount).toBe(2);

    const items = await h.listTelegram(CASE_ID);
    expect(items.map((i) => i.text).sort()).toEqual(['hello world', 'second msg']);
    for (const it of items) {
      expect(it.platform).toBe('telegram');
      // visible-capture provenance markers travel on the normalized record
      expect((it as { verified?: boolean }).verified).toBe(false);
      expect((it as { captureProvenance?: string }).captureProvenance).toBe('visible-capture');
    }
  });

  it('re-importing the same export dedups (no duplicate rows)', async () => {
    const h = harness();
    await importTelegramExport(CASE_ID_REQ(), h.deps);
    await importTelegramExport(CASE_ID_REQ(), h.deps);
    const items = await h.listTelegram(CASE_ID);
    expect(items.length).toBe(2);
    expect(items.map((i) => i.text).sort()).toEqual(['hello world', 'second msg']);
  });

  it('collapses an imported message onto an already-CAPTURED one with the same content', async () => {
    const h = harness();
    // A live-captured message whose content key matches imported "hello world":
    //   dedupKeyForItem = channelId | authorHandle | publishedAt | text  (lower-cased).
    // Imported items carry channelId `json-<id>` (here 'json-1'), no @handle, and the raw
    // export date as publishedAt — so this captured row shares the imported one's key.
    const captured: HarvestedItem = {
      id: 'cap-1',
      platform: 'telegram',
      authorHandle: '',
      authorId: '',
      text: 'hello world',
      channelId: 'json-1',
      channelLabel: 'Ops',
      messageId: 'cap-msg',
      publishedAt: '2026-01-01',
      harvestedAt: '2026-08-06T00:00:00.000Z',
      url: '',
      provenance: { collectorVersion: 'telegram-hunter/1.0.0', jobId: 'live', caseId: CASE_ID },
    };
    await h.seedCaptured(CASE_ID, [captured]);

    await importTelegramExport(CASE_ID_REQ(), h.deps);

    const items = await h.listTelegram(CASE_ID);
    // 1 captured + only the NEW imported 'second msg' = 2 (the imported 'hello world' collapsed).
    expect(items.length).toBe(2);
    const helloRows = items.filter((i) => i.text === 'hello world');
    expect(helloRows.length).toBe(1);
    expect(helloRows[0].id).toBe('cap-1'); // the original captured record survived
  });
});

/** The import request object (fresh each call so nothing is shared between imports). */
function CASE_ID_REQ(): { caseId: string } {
  return { caseId: CASE_ID };
}
