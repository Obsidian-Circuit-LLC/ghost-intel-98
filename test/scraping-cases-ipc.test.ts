/**
 * T3: scrapingCases IPC handler tests.
 *
 * The scrapingCases namespace fronts TWO isolated per-namespace stores ('socmint' | 'x').
 * Every handler receives a renderer-supplied `store` discriminator that MUST be validated
 * main-side against the allowlist — an unknown value throws (never silently defaults to a
 * namespace, never reaches path construction). A valid value routes to the matching store.
 *
 * The store seam is injected (getStore) so these tests never touch Electron / the FS.
 */

import { describe, it, expect, vi } from 'vitest';
import { channels } from '../src/shared/ipc-contracts';
import {
  createScrapingCasesHandlers,
  assertScrapingStore,
  type ScrapingCasesIpcDeps,
} from '../src/main/scraping-cases/ipc';
import type { ScrapingCaseStore } from '../src/main/storage/scraping-cases';
import type { ScrapingCaseNs } from '../src/main/storage/paths';
import type { ScrapingCase } from '../src/shared/types';

const VALID_ID = '22222222-2222-4222-8222-222222222222';
const VALID_ID_2 = '33333333-3333-4333-8333-333333333333';

function makeMockStore(ns: ScrapingCaseNs): ScrapingCaseStore & { ns: ScrapingCaseNs } {
  const rec: ScrapingCase = { id: 'c1', name: 'n', createdAt: 1, updatedAt: 1 };
  return {
    ns,
    list: vi.fn(async () => [{ ...rec, name: `${ns}-case` }]),
    create: vi.fn(async (name: string) => ({ ...rec, name })),
    read: vi.fn(async () => rec),
    rename: vi.fn(async (id: string, name: string) => ({ ...rec, id, name, updatedAt: 2 })),
    remove: vi.fn(async () => {}),
  };
}

function makeHarness() {
  const stores: Record<ScrapingCaseNs, ScrapingCaseStore & { ns: ScrapingCaseNs }> = {
    socmint: makeMockStore('socmint'),
    x: makeMockStore('x'),
  };
  const importToCase = vi.fn(async () => ({ imported: 3 }));
  const saveArtifact = vi.fn(async (_ns, _id, name: string) => name);
  const deps: ScrapingCasesIpcDeps = {
    getStore: (ns) => stores[ns],
    importToCase,
    saveArtifact,
  };
  return { stores, importToCase, saveArtifact, handlers: createScrapingCasesHandlers(deps) };
}

// The values a hostile renderer might send instead of a valid namespace.
const BOGUS_STORES: unknown[] = [
  'socmints', 'X', 'SOCMINT', '', 'cases', '__proto__', '../socmint',
  null, undefined, 0, 1, {}, [], true,
];

describe('T3: channels.scrapingCases structure', () => {
  it('is a top-level channel group with exactly the expected keys', () => {
    expect((channels as Record<string, unknown>).scrapingCases).toBeTruthy();
    expect(Object.keys(channels.scrapingCases).sort()).toEqual(
      ['create', 'importToCase', 'list', 'remove', 'rename', 'saveArtifact'].sort(),
    );
  });

  it('channel string values are namespaced under scrapingCases:', () => {
    for (const v of Object.values(channels.scrapingCases)) {
      expect(typeof v).toBe('string');
      expect(v.startsWith('scrapingCases:')).toBe(true);
    }
  });
});

describe('T3: assertScrapingStore', () => {
  it('returns the namespace for allowlisted values', () => {
    expect(assertScrapingStore('socmint')).toBe('socmint');
    expect(assertScrapingStore('x')).toBe('x');
  });

  it('throws for every non-allowlisted value', () => {
    for (const v of BOGUS_STORES) {
      expect(() => assertScrapingStore(v)).toThrow();
    }
  });
});

describe('T3: scrapingCases handlers reject an unknown store', () => {
  it('every handler rejects a bogus store before touching a store', async () => {
    const { handlers, stores, importToCase, saveArtifact } = makeHarness();
    for (const v of BOGUS_STORES) {
      await expect(handlers.list(v)).rejects.toThrow();
      await expect(handlers.create(v, 'name')).rejects.toThrow();
      await expect(handlers.rename(v, VALID_ID, 'name')).rejects.toThrow();
      await expect(handlers.remove(v, VALID_ID)).rejects.toThrow();
      await expect(handlers.importToCase(v, VALID_ID, VALID_ID_2)).rejects.toThrow();
      await expect(handlers.saveArtifact(v, VALID_ID, 'a.json', '{}')).rejects.toThrow();
    }
    // No store method — and no import/artifact write — was ever reached for a bad discriminator.
    for (const ns of ['socmint', 'x'] as const) {
      expect(stores[ns].list).not.toHaveBeenCalled();
      expect(stores[ns].create).not.toHaveBeenCalled();
      expect(stores[ns].rename).not.toHaveBeenCalled();
      expect(stores[ns].remove).not.toHaveBeenCalled();
    }
    expect(importToCase).not.toHaveBeenCalled();
    expect(saveArtifact).not.toHaveBeenCalled();
  });
});

describe('T3: a valid store routes to the matching namespace store', () => {
  it('routes list/create/rename/remove to socmint, never to x', async () => {
    const { handlers, stores } = makeHarness();

    expect(await handlers.list('socmint')).toEqual([{ id: 'c1', name: 'socmint-case', createdAt: 1, updatedAt: 1 }]);
    await handlers.create('socmint', 'Alpha');
    await handlers.rename('socmint', VALID_ID, 'Beta');
    await handlers.remove('socmint', VALID_ID);

    expect(stores.socmint.list).toHaveBeenCalledOnce();
    expect(stores.socmint.create).toHaveBeenCalledWith('Alpha');
    expect(stores.socmint.rename).toHaveBeenCalledWith(VALID_ID, 'Beta');
    expect(stores.socmint.remove).toHaveBeenCalledWith(VALID_ID);

    expect(stores.x.list).not.toHaveBeenCalled();
    expect(stores.x.create).not.toHaveBeenCalled();
    expect(stores.x.rename).not.toHaveBeenCalled();
    expect(stores.x.remove).not.toHaveBeenCalled();
  });

  it('routes to x, never to socmint', async () => {
    const { handlers, stores } = makeHarness();
    await handlers.create('x', 'x-thing');
    expect(stores.x.create).toHaveBeenCalledWith('x-thing');
    expect(stores.socmint.create).not.toHaveBeenCalled();
  });

  it('importToCase forwards the validated namespace + ids to deps.importToCase', async () => {
    const { handlers, importToCase } = makeHarness();
    await handlers.importToCase('x', VALID_ID, VALID_ID_2);
    expect(importToCase).toHaveBeenCalledWith('x', VALID_ID, VALID_ID_2);
  });
});

describe('T3: handlers validate ids to block path traversal', () => {
  it('rename/remove/importToCase reject a non-UUID id even for a valid store', async () => {
    const { handlers, stores } = makeHarness();
    await expect(handlers.rename('socmint', '../../etc', 'x')).rejects.toThrow();
    await expect(handlers.remove('socmint', 'not-a-uuid')).rejects.toThrow();
    await expect(handlers.importToCase('socmint', 'bad', VALID_ID)).rejects.toThrow();
    await expect(handlers.importToCase('socmint', VALID_ID, 'bad')).rejects.toThrow();
    expect(stores.socmint.rename).not.toHaveBeenCalled();
    expect(stores.socmint.remove).not.toHaveBeenCalled();
  });
});
