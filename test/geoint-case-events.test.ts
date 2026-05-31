import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA = mkdtempSync(join(tmpdir(), 'ga98-geoce-'));
vi.mock('electron', () => ({ app: { getPath: () => DATA } }));

import * as ce from '../src/main/geoint/case-events';

const item = { id: 'e1', sourceId: 's1', title: 'Quake', lat: 1, lon: 2, located: 'geo' as const };

describe('case-events store', () => {
  it('returns [] for a case with no sidecar (ENOENT-safe)', async () => {
    expect(await ce.listCaseEvents('11111111-1111-4111-8111-111111111111')).toEqual([]);
  });
  it('adds (re-ids + stamps savedAt) + lists + removes', async () => {
    const C = '22222222-2222-4222-8222-222222222222';
    const saved = await ce.addCaseEvent(C, item);
    expect(saved.savedAt).toBeTruthy();
    expect(saved.id).not.toBe('e1'); // re-ided
    expect(saved.title).toBe('Quake');
    expect(await ce.listCaseEvents(C)).toHaveLength(1);
    await ce.removeCaseEvent(C, saved.id);
    expect(await ce.listCaseEvents(C)).toHaveLength(0);
  });
});
