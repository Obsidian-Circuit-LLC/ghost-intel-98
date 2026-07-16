import { describe, it, expect } from 'vitest';
import { filterReports, sortReports, duplicateReport } from '../src/renderer/modules/reports/reports-filters';
import type { Report } from '../src/shared/reports-types';

const mk = (id: string, title: string, status: Report['status'], updatedAt: string): Report =>
  ({ id, title, createdAt: '2026-01-01', updatedAt, to: '', status, author: 'X', blocks: [] });
const list: Report[] = [
  mk('a', 'Alpha', 'draft', '2026-07-10'),
  mk('b', 'Bravo', 'completed', '2026-07-14'),
  mk('c', 'Charlie', 'archived', '2026-07-12')
];

describe('reports filters/sort/duplicate', () => {
  it('filters by nav node', () => {
    expect(filterReports(list, 'drafts').map((r) => r.id)).toEqual(['a']);
    expect(filterReports(list, 'archived').map((r) => r.id)).toEqual(['c']);
    expect(filterReports(list, 'all').length).toBe(3);
    // recent = newest-first by updatedAt
    expect(filterReports(list, 'recent').map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
  it('sorts by a column both directions', () => {
    expect(sortReports(list, 'title', 'asc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortReports(list, 'updatedAt', 'desc').map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
  it('duplicates with a fresh id, copy title, and draft status', () => {
    const d = duplicateReport(list[1], 'newid', '2026-07-16');
    expect(d.id).toBe('newid');
    expect(d.title).toBe('Bravo (copy)');
    expect(d.status).toBe('draft');
    expect(d.updatedAt).toBe('2026-07-16');
  });
});
