/**
 * Pure renderer helpers for the assistant's Memory panel (transparency + governance UI, Task 10).
 * No IPC, no DOM, no React — kept pure/deterministic so it can be node-tested. Grouping/labelling
 * and provenance formatting only; the `.tsx` panel calls these and renders the plain-string output
 * as React text children (never inserted as HTML) since case titles/handles/learned text are
 * untrusted. Types come from the shared package (not `src/main`) so this stays inside the
 * renderer's own tsconfig project, matching how the preload/renderer already consume
 * `MemoryItem`/`RecallHitShape` (see `src/shared/ipc-contracts.ts`).
 */
import type { MemoryItem, RecallHitShape } from '../../../shared/ipc-contracts';

export interface ScopeGroup { scope: string; label: string; items: MemoryItem[] }

const MEMORY_TEXT_MAX = 80;

/** Human label for a scope: 'global'→'General', `case:${id}`→`Case ${id}`, `subject:${h}`→`@${h}`;
 *  anything else falls back to the raw scope string so new scope kinds never throw. */
export function labelForScope(scope: string): string {
  if (scope === 'global') return 'General';
  if (scope.startsWith('case:')) return `Case ${scope.slice('case:'.length)}`;
  if (scope.startsWith('subject:')) return `@${scope.slice('subject:'.length)}`;
  return scope;
}

function compareItems(a: MemoryItem, b: MemoryItem): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Group items by scope for the Memory panel's "Learned" browser. Groups are sorted with 'global'
 * ("General") first, then the rest alphabetically by label; items within a group are sorted
 * pinned-first, then confidence desc, then `id` asc (deterministic tiebreak). Returns `[]` for no
 * items.
 */
export function groupItemsByScope(items: MemoryItem[]): ScopeGroup[] {
  if (items.length === 0) return [];

  const byScope = new Map<string, MemoryItem[]>();
  for (const item of items) {
    const bucket = byScope.get(item.scope);
    if (bucket) bucket.push(item);
    else byScope.set(item.scope, [item]);
  }

  const groups: ScopeGroup[] = Array.from(byScope.entries()).map(([scope, groupItems]) => ({
    scope,
    label: labelForScope(scope),
    items: [...groupItems].sort(compareItems)
  }));

  groups.sort((a, b) => {
    if (a.scope === 'global') return -1;
    if (b.scope === 'global') return 1;
    return a.label.localeCompare(b.label);
  });

  return groups;
}

function truncateMemoryText(text: string, max: number = MEMORY_TEXT_MAX): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Human-readable labels describing what was recalled for the last answer — one line per rag hit
 * ('Case "<title>" › <kind>:<ref>'), then one line per profile item ('Memory: <truncated text>'),
 * then a single trailing line for the injected rolling summary ('Summary: <truncated>') when one
 * was folded into the profile block. Disclosing the summary here is what keeps the injected,
 * durable prior-conversation prose from being silent. Returns `[]` when nothing was recalled.
 */
export function formatRecallProvenance(rag: RecallHitShape[], profile: MemoryItem[], summary = ''): string[] {
  const ragLabels = rag.map((h) => `Case “${h.caseTitle}” › ${h.kind}:${h.ref}`);
  const profileLabels = profile.map((item) => `Memory: ${truncateMemoryText(item.text)}`);
  const summaryLabel = summary.trim() ? [`Summary: ${truncateMemoryText(summary)}`] : [];
  return [...ragLabels, ...profileLabels, ...summaryLabel];
}
