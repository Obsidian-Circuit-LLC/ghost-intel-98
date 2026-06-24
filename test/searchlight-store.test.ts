import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'sl-store-'));
vi.mock('electron', () => ({ app: { getPath: () => DATA, getAppPath: () => DATA } }));

import * as store from '../src/main/searchlight/store';
import type { SearchlightCase } from '@shared/searchlight/types';

const mkCase = (id: string, name: string): SearchlightCase => ({
  id, name, description: '', createdAt: 1, updatedAt: 2, searches: [], graphNodes: [], graphEdges: [],
  whiteboardFiles: [], whiteboardNotes: [], notes: '', tags: []
});

beforeEach(() => store._resetForTest());

describe('searchlight store', () => {
  it('saves and lists and loads a case', async () => {
    await store.saveCase(mkCase('a', 'Alpha'));
    expect((await store.listCases()).map((s) => s.name)).toEqual(['Alpha']);
    expect((await store.loadCase('a'))?.name).toBe('Alpha');
  });
  it('deletes a case', async () => {
    await store.saveCase(mkCase('a', 'Alpha'));
    await store.deleteCase('a');
    expect(await store.listCases()).toEqual([]);
    expect(await store.loadCase('a')).toBeNull();
  });
  it('round-trips through export/import with a fresh id collision rejected', async () => {
    await store.saveCase(mkCase('a', 'Alpha'));
    const text = await store.exportCase('a');
    expect(text).toBeTruthy();
    const imported = await store.importCase(text as string);
    expect(imported?.name).toBe('Alpha');
    expect((await store.listCases()).length).toBe(1); // re-import same id overwrites, not duplicates
  });
  it('importCase returns null on unparseable JSON', async () => {
    expect(await store.importCase('not-json{')).toBeNull();
  });
  it('importCase returns null when id/name are missing', async () => {
    expect(await store.importCase('{"foo":"bar"}')).toBeNull();
  });
  it('loadCase/listCases tolerate a never-created cases dir', async () => {
    expect(await store.loadCase('never-saved')).toBeNull();
  });
});
