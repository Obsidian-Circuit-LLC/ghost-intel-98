/**
 * Tests for src/main/socmint/labels.ts — in-memory fs injection seam; no electron/vault needed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeLabelStore, type LabelStoreDeps } from '../src/main/socmint/labels';
import type { ItemLabel } from '../src/main/socmint/labels';

// ---- in-memory fs adapter -------------------------------------------

function memDeps(): LabelStoreDeps {
  const store = new Map<string, string>();
  const enoent = (p: string): Error => {
    const e = new Error(`ENOENT: ${p}`);
    (e as NodeJS.ErrnoException).code = 'ENOENT';
    return e;
  };
  return {
    readFile: async (p) => {
      if (!store.has(p)) throw enoent(p);
      return Buffer.from(store.get(p)!, 'utf8');
    },
    writeFile: async (p, d) => { store.set(p, d); },
    labelsPath: (caseId) => `cases/${caseId}/socmint-labels.json`,
  };
}

// ---- fixtures -------------------------------------------------------

const mkLabel = (itemId: string, decision: 'accept' | 'reject' = 'accept'): ItemLabel => ({
  itemId,
  decision,
  labeledAt: '2026-06-26T10:00:00.000Z',
});

const mkLabelWithCorrections = (itemId: string): ItemLabel => ({
  itemId,
  decision: 'accept',
  entityCorrections: [
    { kind: 'person', value: 'Alice Smith' },
    { kind: 'location', value: 'Berlin' },
  ],
  labeledAt: '2026-06-26T10:01:00.000Z',
});

// ---- tests ----------------------------------------------------------

describe('makeLabelStore: recordLabel / listLabels', () => {
  let ls: ReturnType<typeof makeLabelStore>;

  beforeEach(() => {
    ls = makeLabelStore(memDeps());
  });

  it('round-trips a single label', async () => {
    await ls.recordLabel('case-a', mkLabel('item-1'));
    const labels = await ls.listLabels('case-a');
    expect(labels).toHaveLength(1);
    expect(labels[0].itemId).toBe('item-1');
    expect(labels[0].decision).toBe('accept');
  });

  it('preserves multiple labels in append order', async () => {
    await ls.recordLabel('case-a', mkLabel('item-1', 'accept'));
    await ls.recordLabel('case-a', mkLabel('item-2', 'reject'));
    await ls.recordLabel('case-a', mkLabel('item-3', 'accept'));
    const labels = await ls.listLabels('case-a');
    expect(labels).toHaveLength(3);
    expect(labels.map((l) => l.itemId)).toEqual(['item-1', 'item-2', 'item-3']);
    expect(labels[1].decision).toBe('reject');
  });

  it('listLabels returns empty array when no labels have been recorded', async () => {
    expect(await ls.listLabels('case-empty')).toEqual([]);
  });

  it('preserves entityCorrections faithfully', async () => {
    const label = mkLabelWithCorrections('item-x');
    await ls.recordLabel('case-a', label);
    const [saved] = await ls.listLabels('case-a');
    expect(saved).toEqual(label);
  });

  it('labels are case-scoped: different cases are independent', async () => {
    await ls.recordLabel('case-a', mkLabel('item-1'));
    await ls.recordLabel('case-b', mkLabel('item-2'));
    await ls.recordLabel('case-b', mkLabel('item-3'));

    expect(await ls.listLabels('case-a')).toHaveLength(1);
    expect(await ls.listLabels('case-b')).toHaveLength(2);
  });

  it('allows multiple labels for the same itemId (v1 — no dedup on labels)', async () => {
    // v1 only captures; analyst may revise; both entries are kept
    await ls.recordLabel('case-a', mkLabel('item-1', 'accept'));
    await ls.recordLabel('case-a', mkLabel('item-1', 'reject'));
    const labels = await ls.listLabels('case-a');
    expect(labels).toHaveLength(2);
  });

  it('label fields (labeledAt, decision) are preserved faithfully', async () => {
    const label: ItemLabel = {
      itemId: 'item-99',
      decision: 'reject',
      labeledAt: '2026-06-26T12:34:56.789Z',
    };
    await ls.recordLabel('case-a', label);
    const [saved] = await ls.listLabels('case-a');
    expect(saved).toEqual(label);
  });
});
