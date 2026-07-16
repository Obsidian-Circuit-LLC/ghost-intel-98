import type { Report } from '@shared/reports-types';

export type NavNode = 'dashboard' | 'all' | 'recent' | 'drafts' | 'archived';

const byUpdatedDesc = (a: Report, b: Report): number => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

export function filterReports(list: Report[], node: NavNode): Report[] {
  switch (node) {
    case 'drafts': return list.filter((r) => r.status === 'draft');
    case 'archived': return list.filter((r) => r.status === 'archived');
    case 'recent': return [...list].sort(byUpdatedDesc);
    case 'all': case 'dashboard': default: return list;
  }
}

export function sortReports(list: Report[], col: 'title' | 'status' | 'updatedAt' | 'author', dir: 'asc' | 'desc'): Report[] {
  const s = [...list].sort((a, b) => {
    const av = String(a[col] ?? ''); const bv = String(b[col] ?? '');
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
  return dir === 'desc' ? s.reverse() : s;
}

export function duplicateReport(r: Report, newId: string, now: string): Report {
  return { ...r, id: newId, title: `${r.title} (copy)`, status: 'draft', createdAt: now, updatedAt: now };
}
