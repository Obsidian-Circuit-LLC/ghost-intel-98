import { describe, it, expect, beforeEach, vi } from 'vitest';

let mem: Record<string, Buffer> = {};
vi.mock('@main/storage/secure-fs', () => ({
  secureReadFile: async (p: string) => { if (!mem[p]) throw new Error('enoent'); return mem[p]; },
  secureWriteFile: async (p: string, d: string | Buffer) => { mem[p] = Buffer.from(d as any); },
}));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/userData' } }));

import { loadPinned, setPinned, addPinned, removePinned, loadDismissed, dismissSituation, restoreSituation, _resetForTest } from '@main/services/geoint-monitor';

describe('geoint monitor pinned set', () => {
  beforeEach(() => { mem = {}; _resetForTest(); });

  it('round-trips through secure-fs', async () => {
    await setPinned(['a', 'b']);
    expect((await loadPinned()).sort()).toEqual(['a', 'b']);
  });

  it('add/remove are idempotent and deduped', async () => {
    await addPinned('x'); await addPinned('x'); await removePinned('y');
    expect(await loadPinned()).toEqual(['x']);
  });

  it('sanitises a malformed persisted blob', async () => {
    mem['/tmp/userData/geoint/monitors.json'] = Buffer.from(JSON.stringify(['ok', 5, null, { a: 1 }]));
    _resetForTest();
    expect(await loadPinned()).toEqual(['ok']);
  });
});

/**
 * FIELD BUG (GhostExodus, 2026-08-20): "the (x) in the monitored situations does not function."
 *
 * Rows qualify as monitored by corroboration OR by pinning, and "×" only un-pinned — so for a
 * CORROBORATED row (all of his, each showing "×1") it changed nothing and the row stayed. Removing a
 * situation needs its own persisted set: "stop showing me this", whatever qualified it.
 */
describe('geoint dismissed situations', () => {
  beforeEach(() => { mem = {}; _resetForTest(); });

  it('starts empty', async () => {
    expect(await loadDismissed()).toEqual([]);
  });

  it('persists a dismissal so it survives reopening the module', async () => {
    await dismissSituation('bbc:1');
    _resetForTest(); // drop the in-memory cache — reload from disk
    expect(await loadDismissed()).toEqual(['bbc:1']);
  });

  it('is idempotent and deduped', async () => {
    await dismissSituation('a'); await dismissSituation('a');
    expect(await loadDismissed()).toEqual(['a']);
  });

  it('can be restored, so a dismissal is not permanent', async () => {
    await dismissSituation('a'); await dismissSituation('b');
    expect((await restoreSituation('a')).sort()).toEqual(['b']);
  });

  it('is kept SEPARATE from the pinned set — dismissing never unpins anything else', async () => {
    await addPinned('p1');
    await dismissSituation('d1');
    expect(await loadPinned()).toEqual(['p1']);
    expect(await loadDismissed()).toEqual(['d1']);
  });

  it('sanitises a malformed persisted blob', async () => {
    await dismissSituation('ok');
    const path = Object.keys(mem).find((k) => k.includes('dismissed'))!;
    mem[path] = Buffer.from(JSON.stringify({ nope: true }));
    _resetForTest();
    expect(await loadDismissed()).toEqual([]);
  });
});
