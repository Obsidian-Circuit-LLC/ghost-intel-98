/**
 * TG-V wiring — the import + keyword-watch handlers are REAL (not hollow).
 *
 * a00a8e3 flagged import (parseTelegramExport) and keyword-watch (matchKeywords) as built
 * but bound to no channel and no renderer control. This suite pins the freshly-wired main
 * halves: `importTelegramExport` runs the LFI-guarded parser and persists to the encrypt-at-
 * rest imports store; `scanTelegramKeywords` persists literal terms and scans the case's
 * captured messages via `matchKeywords`. Both are driven through injected deps so no dialog
 * opens and no electron/secure-fs is touched — the store is the real `makeTgHunterStore`
 * over an in-memory fs seam, so dedup/persistence are genuinely exercised.
 *
 * The renderer→api seam for these is proven separately in tg-hunter-seam.test.tsx.
 */
import { describe, it, expect } from 'vitest';
import {
  importTelegramExport,
  scanTelegramKeywords,
  type TgImportDeps,
  type TgKeywordScanDeps,
} from '../src/main/socmint/telegram-hunter/ipc';
import { makeTgHunterStore, type TgHunterStore } from '../src/main/socmint/telegram-hunter/store';
import type { HarvestedItem } from '../src/shared/socmint/types';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

/** A real TgHunterStore backed by an in-memory fs (no electron, no disk). */
function memStore(): TgHunterStore {
  const files = new Map<string, string>();
  return makeTgHunterStore({
    readFile: async (p) => {
      const v = files.get(p);
      if (v === undefined) {
        const e = new Error('ENOENT') as NodeJS.ErrnoException;
        e.code = 'ENOENT';
        throw e;
      }
      return Buffer.from(v, 'utf8');
    },
    writeFile: async (p, d) => { files.set(p, d); },
    membersPath: (id) => `mem:${id}:members`,
    keywordWatchPath: (id) => `mem:${id}:keyword`,
    importsPath: (id) => `mem:${id}:imports`,
    dedupPath: (id) => `mem:${id}:dedup`,
  });
}

function item(over: Partial<HarvestedItem>): HarvestedItem {
  return {
    id: over.id ?? 'id',
    platform: 'telegram',
    authorHandle: over.authorHandle ?? '@a',
    authorId: 'aid',
    text: over.text ?? '',
    channelId: 'c',
    channelLabel: over.channelLabel ?? 'Chat',
    messageId: over.messageId ?? 'm',
    publishedAt: '2026-01-01T00:00:00.000Z',
    harvestedAt: '2026-01-01T00:00:00.000Z',
    url: 'https://t.me/x',
    provenance: { collectorVersion: 'test', jobId: 'j', caseId: VALID_UUID },
    ...over,
  };
}

describe('TG-V wiring — importTelegramExport (parseTelegramExport is reachable)', () => {
  const EXPORT = {
    chats: { list: [{ id: 7, name: 'C', messages: [
      { id: 1, text: 'hello wallet' },
      { id: 2, text: 'bye', file: '../../../../etc/passwd' }, // LFI escape → media DROPPED
    ] }] },
  };

  function deps(store: TgHunterStore, file: string | null): TgImportDeps {
    return {
      pickExportFile: async () => file,
      readTextFile: async () => JSON.stringify(EXPORT),
      now: () => '2026-02-02T00:00:00.000Z',
      store: async () => store,
      // The shared-store seams (imported messages reach Harvested Items) are exercised in
      // tg-hunter-import-shared-store.test.ts; here they are inert so these audit-set
      // assertions stay focused on the per-tool import record.
      listTelegramItems: async () => [],
      upsertItems: async () => ({ added: 0, skipped: 0 }),
    };
  }

  it('parses the picked export, DROPS escaping media, and persists an import set', async () => {
    const store = memStore();
    const res = await importTelegramExport({ caseId: VALID_UUID }, deps(store, '/exp/result.json'));
    expect(res.canceled).toBe(false);
    expect(res.name).toBe('result.json');
    expect(res.itemCount).toBe(2);
    expect(res.setCount).toBe(1);

    const sets = await store.imports.read(VALID_UUID);
    expect(sets).toHaveLength(1);
    expect(sets[0].sourceFile).toBe('/exp/result.json');
    // the traversal media was dropped by the LFI-guarded parser (message kept)
    expect(sets[0].items[1].media).toEqual([]);
  });

  it('re-importing the SAME file upserts (deterministic id) — no duplicate set', async () => {
    const store = memStore();
    await importTelegramExport({ caseId: VALID_UUID }, deps(store, '/exp/result.json'));
    const res2 = await importTelegramExport({ caseId: VALID_UUID }, deps(store, '/exp/result.json'));
    expect(res2.setCount).toBe(1);
  });

  it('a dismissed file picker is an honest no-op ({ canceled: true }), not an error', async () => {
    const store = memStore();
    const res = await importTelegramExport({ caseId: VALID_UUID }, deps(store, null));
    expect(res).toEqual({ canceled: true });
    expect(await store.imports.read(VALID_UUID)).toEqual([]);
  });

  it('requires a caseId and UUID-gates it before any store path', async () => {
    const store = memStore();
    await expect(importTelegramExport({}, deps(store, '/exp/result.json'))).rejects.toThrow(/caseId/i);
    await expect(importTelegramExport({ caseId: 'not-a-uuid' }, deps(store, '/exp/result.json'))).rejects.toThrow(/uuid/i);
  });
});

describe('TG-V wiring — scanTelegramKeywords (matchKeywords is reachable)', () => {
  function deps(store: TgHunterStore, items: HarvestedItem[]): TgKeywordScanDeps {
    return {
      now: () => '2026-02-02T00:00:00.000Z',
      listTelegramItems: async () => items,
      store: async () => store,
    };
  }

  it('persists literal terms then scans captured messages, reporting honest counts', async () => {
    const store = memStore();
    const items = [
      item({ id: '1', text: 'buy a wallet drainer here' }),
      item({ id: '2', text: 'nothing relevant' }),
      item({ id: '3', text: 'seed phrase leaked' }),
    ];
    const res = await scanTelegramKeywords(
      { caseId: VALID_UUID, terms: ['wallet', 'seed phrase'] },
      deps(store, items),
    );
    expect(res.rules.map((r) => r.term).sort()).toEqual(['seed phrase', 'wallet']);
    expect(res.scanned).toBe(3);
    expect(res.matched).toBe(2);
    expect(res.matches.map((m) => m.text).sort()).toEqual([
      'buy a wallet drainer here',
      'seed phrase leaked',
    ]);

    // terms are PERSISTED to the encrypt-at-rest keyword store (dedup on re-add)
    const rules = await store.keywordWatch.read(VALID_UUID);
    expect(rules.map((r) => r.term).sort()).toEqual(['seed phrase', 'wallet']);
  });

  it('scans the persisted term set even when this call adds no new terms', async () => {
    const store = memStore();
    await store.keywordWatch.add(VALID_UUID, 'mixer', '2026-01-01T00:00:00.000Z');
    const res = await scanTelegramKeywords(
      { caseId: VALID_UUID },
      deps(store, [item({ id: '1', text: 'use a mixer' })]),
    );
    expect(res.rules.map((r) => r.term)).toEqual(['mixer']);
    expect(res.matched).toBe(1);
  });

  it('requires a caseId and UUID-gates it', async () => {
    const store = memStore();
    await expect(scanTelegramKeywords({}, deps(store, []))).rejects.toThrow(/caseId/i);
    await expect(scanTelegramKeywords({ caseId: 'nope' }, deps(store, []))).rejects.toThrow(/uuid/i);
  });
});
