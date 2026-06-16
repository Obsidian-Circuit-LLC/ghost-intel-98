import { describe, it, expect, vi, beforeEach } from 'vitest';

let disk: Record<string, string> = {};
vi.mock('../src/main/storage/secure-fs', () => ({
  secureReadText: vi.fn(async (p: string) => { if (!(p in disk)) { const e: NodeJS.ErrnoException = new Error('no'); e.code = 'ENOENT'; throw e; } return disk[p]; }),
  secureWriteFile: vi.fn(async (p: string, c: string) => { disk[p] = c; })
}));
vi.mock('../src/main/storage/paths', () => ({ dataRoot: () => '/data' }));

import * as walls from '../src/main/services/walls';

beforeEach(() => { disk = {}; });

describe('walls service', () => {
  it('list is empty before any save (ENOENT → [])', async () => {
    expect(await walls.list()).toEqual([]);
  });
  it('save inserts (assigns id if absent) then updates by id; get/list reflect it', async () => {
    const saved = await walls.save({ name: 'London ops', slots: Array(9).fill(null) });
    expect(saved.id).toBeTruthy();
    expect((await walls.list()).length).toBe(1);
    const upd = await walls.save({ ...saved, name: 'Renamed' });
    expect(upd.id).toBe(saved.id);
    expect((await walls.list()).length).toBe(1);
    expect((await walls.get(saved.id))?.name).toBe('Renamed');
  });
  it('persists slots at their actual length (unlimited cameras — not truncated to 9)', async () => {
    // FIX 4: an 11-slot wall must round-trip with all 11 slots. The old code clamped to 9,
    // silently dropping cameras 10+ on the variable-length scrollable grid.
    const eleven = Array.from({ length: 11 }, (_, i) => `cam-${i}`);
    const saved = await walls.save({ name: 'Big wall', slots: eleven });
    expect(saved.slots.length).toBe(11);
    expect(saved.slots).toEqual(eleven);
    expect((await walls.get(saved.id))?.slots).toEqual(eleven);
  });
  it('clamps to a sane maximum slot count', async () => {
    const huge = Array.from({ length: 500 }, () => null);
    const saved = await walls.save({ name: 'Huge', slots: huge });
    expect(saved.slots.length).toBe(200);
  });
  it('remove deletes by id', async () => {
    const s = await walls.save({ name: 'x', slots: Array(9).fill(null) });
    await walls.remove(s.id);
    expect(await walls.list()).toEqual([]);
  });
});
