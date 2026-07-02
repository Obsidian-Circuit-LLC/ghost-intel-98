import type { CaseSummary, ScrapingCase } from '@shared/types';

export interface CaseOption { value: string; label: string; category: string; }

export interface ScrapingCaseOption { value: string; label: string; }

/**
 * Shape SOCMINT scraping cases (namespace 'socmint') into sidebar options with a
 * deterministic, locale-independent order (name, then id). These are the module's OWN
 * collection-run cases — never the main investigation cases (window.api.cases.*).
 */
export function buildScrapingCaseOptions(
  cases: Pick<ScrapingCase, 'id' | 'name'>[],
): ScrapingCaseOption[] {
  return cases
    .map((c) => ({ value: c.id, label: c.name }))
    .sort((a, b) =>
      a.label < b.label ? -1 : a.label > b.label ? 1
      : a.value < b.value ? -1 : a.value > b.value ? 1 : 0,
    );
}

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
