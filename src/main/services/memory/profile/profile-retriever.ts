/**
 * Deterministic profile selection + formatting — NO embedding, NO LLM. Given the full set of
 * `MemoryItem`s already reconciled/persisted, pick the ones relevant to the requested scopes and
 * render them (plus the rolling summary) into a system-context block the model can cite. Ordering
 * and selection are pure functions of their inputs so they are fully unit-tested and reproducible.
 */
import type { MemoryItem } from './types';

const DEFAULT_LIMIT = 8;

/**
 * In-scope items ordered pinned-first, then confidence desc, then most-recently-seen first, then
 * `id` asc as a final deterministic tiebreaker — and capped to `limit` (default 8).
 */
export function selectProfileItems(items: MemoryItem[], scopes: string[], limit: number = DEFAULT_LIMIT): MemoryItem[] {
  const scopeSet = new Set(scopes);
  const inScope = items.filter((item) => scopeSet.has(item.scope));

  inScope.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    if (a.lastSeenAt !== b.lastSeenAt) return b.lastSeenAt - a.lastSeenAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return inScope.slice(0, limit);
}

/**
 * Render the selected items + rolling summary into a provenance-labelled system-context block.
 * Returns '' when there is nothing to show (no items and no summary) so the caller never injects
 * an empty/noise message.
 */
export function formatProfileBlock(items: MemoryItem[], summary: string): string {
  const summaryText = summary.trim();
  if (items.length === 0 && !summaryText) return '';

  const parts: string[] = [];

  if (items.length > 0) {
    const lines = items.map((item) => `- ${item.text} [${item.provenance.join(', ') || 'learned'}]`);
    parts.push(
      'Long-term profile learned about this user (local-only, encrypted at rest, user-editable — ' +
        'cite the source labels when you use it):\n' +
        lines.join('\n')
    );
  }

  if (summaryText) {
    parts.push(`Summary of prior conversations:\n${summaryText}`);
  }

  return parts.join('\n\n');
}
