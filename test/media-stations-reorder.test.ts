import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// dataRoot() resolves from app.getPath('userData'); point it at a temp dir.
const DATA = mkdtempSync(join(tmpdir(), 'ga98-media-reorder-'));
vi.mock('electron', () => ({ app: { getPath: () => DATA } }));

import * as lib from '../src/main/media/library';

describe('reorderStations', () => {
  beforeEach(async () => { await lib._resetForTest(); });
  it('reorders to match the given id order; appends any not listed; ignores unknown ids', async () => {
    const a = await lib.upsertStation({ label: 'A', url: 'https://a/' });
    const b = await lib.upsertStation({ label: 'B', url: 'https://b/' });
    const c = await lib.upsertStation({ label: 'C', url: 'https://c/' });
    const snap = await lib.reorderStations([c.id, a.id, 'ghost']); // b omitted, ghost unknown
    expect(snap.stations.map((s) => s.label)).toEqual(['C', 'A', 'B']);
  });
});
