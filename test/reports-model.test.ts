import { describe, it, expect, beforeEach } from 'vitest';
import { ensureReport, ensureIntroduction } from '../src/main/security/validate';

describe('report model additions', () => {
  it('keeps a valid table block (rectangular string cells)', () => {
    const r = ensureReport({ id: 'r1', to: '', blocks: [
      { id: 'b1', kind: 'table', cells: [['a', 'b'], ['c', 'd']] }
    ] });
    expect(r.blocks[0]).toEqual({ id: 'b1', kind: 'table', cells: [['a', 'b'], ['c', 'd']] });
  });

  it('drops a table block whose cells are not a rectangular string grid', () => {
    const r = ensureReport({ id: 'r1', to: '', blocks: [
      { id: 'b1', kind: 'table', cells: [['a', 'b'], ['c']] },          // ragged
      { id: 'b2', kind: 'table', cells: [[1, 2]] },                     // non-string
      { id: 'b3', kind: 'table', cells: 'nope' }                        // not a grid
    ] });
    expect(r.blocks).toHaveLength(0);
  });

  it('clamps an oversize table to the row/col caps instead of dropping the whole block', () => {
    // 60 rows × 15 cols — both over the caps (50 × 12). Previously the entire block (and every cell)
    // was silently dropped; now it is truncated to 50 × 12, preserving the in-bounds content.
    const cells = Array.from({ length: 60 }, (_, r) => Array.from({ length: 15 }, (_, c) => `r${r}c${c}`));
    const r = ensureReport({ id: 'r1', to: '', blocks: [{ id: 'b1', kind: 'table', cells }] });
    expect(r.blocks).toHaveLength(1);
    const out = r.blocks[0] as { kind: 'table'; cells: string[][] };
    expect(out.cells).toHaveLength(50);
    expect(out.cells[0]).toHaveLength(12);
    // Content within the caps survives verbatim (top-left corner preserved).
    expect(out.cells[0][0]).toBe('r0c0');
    expect(out.cells[49][11]).toBe('r49c11');
  });

  it('preserves reportDate and image align, clamps unknown align to undefined', () => {
    const r = ensureReport({ id: 'r1', to: '', reportDate: '2026-07-16', blocks: [
      { id: 'b1', kind: 'image', assetRef: 'x.png', widthPct: 50, caption: 'c', align: 'center' },
      { id: 'b2', kind: 'image', assetRef: 'y.png', widthPct: 50, caption: 'c', align: 'diagonal' }
    ] });
    expect(r.reportDate).toBe('2026-07-16');
    expect((r.blocks[0] as any).align).toBe('center');
    expect((r.blocks[1] as any).align).toBeUndefined();
  });

  it('ensureIntroduction bounds name and body like a descriptor', () => {
    const d = ensureIntroduction({ id: 'i1', name: 'Intro', body: 'hello' });
    expect(d).toEqual({ id: 'i1', name: 'Intro', body: 'hello' });
    expect(() => ensureIntroduction({ name: 'x' })).toThrow(/id/);
  });
});
