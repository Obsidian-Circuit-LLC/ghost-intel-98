import { describe, it, expect } from 'vitest';
import { addRow, addCol, removeRow, removeCol } from '../src/renderer/modules/reports/blocks/TableBlock';

describe('table ops keep the grid rectangular', () => {
  const g = [['a', 'b'], ['c', 'd']];
  it('addRow appends an empty row of the right width', () => {
    expect(addRow(g)).toEqual([['a', 'b'], ['c', 'd'], ['', '']]);
  });
  it('addCol appends an empty cell to every row', () => {
    expect(addCol(g)).toEqual([['a', 'b', ''], ['c', 'd', '']]);
  });
  it('removeRow never drops the last row', () => {
    expect(removeRow([['x']], 0)).toEqual([['x']]);
    expect(removeRow(g, 0)).toEqual([['c', 'd']]);
  });
  it('removeCol never drops the last column', () => {
    expect(removeCol([['x'], ['y']], 0)).toEqual([['x'], ['y']]);
    expect(removeCol(g, 0)).toEqual([['b'], ['d']]);
  });
});
