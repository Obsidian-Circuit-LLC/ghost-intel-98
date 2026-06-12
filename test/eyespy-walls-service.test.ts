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
  it('remove deletes by id', async () => {
    const s = await walls.save({ name: 'x', slots: Array(9).fill(null) });
    await walls.remove(s.id);
    expect(await walls.list()).toEqual([]);
  });
});
