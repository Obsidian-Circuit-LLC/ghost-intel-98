import type { CaseSummary } from '@shared/types';

export interface CaseOption { value: string; label: string; category: string; }

/** Shape real cases into picker options with a deterministic, locale-independent order. */
export function buildCaseOptions(
  cases: Pick<CaseSummary, 'id' | 'title' | 'reference' | 'category'>[],
): CaseOption[] {
  return cases
    .map((c) => ({
      value: c.id,
      label: c.reference ? `${c.title} — ${c.reference}` : c.title,
      category: c.category && c.category.trim() ? c.category : 'Uncategorized',
    }))
    .sort((a, b) =>
      a.category < b.category ? -1 : a.category > b.category ? 1
      : a.label < b.label ? -1 : a.label > b.label ? 1
      : a.value < b.value ? -1 : a.value > b.value ? 1 : 0,
    );
}
