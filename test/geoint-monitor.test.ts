import { describe, it, expect, beforeEach, vi } from 'vitest';

let mem: Record<string, Buffer> = {};
vi.mock('@main/storage/secure-fs', () => ({
  secureReadFile: async (p: string) => { if (!mem[p]) throw new Error('enoent'); return mem[p]; },
  secureWriteFile: async (p: string, d: string | Buffer) => { mem[p] = Buffer.from(d as any); },
}));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/userData' } }));

import { loadPinned, setPinned, addPinned, removePinned, _resetForTest } from '@main/services/geoint-monitor';

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
