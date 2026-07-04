/**
 * Curation — merge duplicate profile facts and detect obvious contradictions. Pure logic only
 * (no I/O, no randomness): `register.ts`'s `memory:mergeItems` handler loads the profile, calls
 * `mergeItems`, and persists the result via the profile store's `put`/`remove`; `graph/build.ts`
 * calls `detectConflicts` over the full profile to flag `conflict: true` on the involved fact
 * nodes so the Mind's Eye "one thing to fix" tray can surface one contradiction at a time.
 */
import type { MemoryItem } from '../profile/types';

/**
 * v1 conflict heuristic — deliberately conservative: false negatives (missing a real
 * contradiction) are acceptable, false positives (flagging unrelated facts as conflicting) are
 * not. Split each item's already-normalized text on its LAST space into a "subject prefix" (every
 * token but the last) and a "trailing value" (the last token alone) — e.g.
 * "operator's favourite colour is blue" → prefix "operator's favourite colour is", value "blue".
 * Items with no internal space (nothing to split) never participate.
 */
function splitSubjectValue(normalized: string): { prefix: string; value: string } | null {
  const idx = normalized.lastIndexOf(' ');
  if (idx <= 0) return null;
  return { prefix: normalized.slice(0, idx), value: normalized.slice(idx + 1) };
}

/** Pairs of item ids whose normalized text shares the same subject prefix but a different
 *  trailing value — an obvious, narrow contradiction. Unrelated items (different prefixes, or no
 *  separable prefix at all) are ignored. Deterministic: same input order in, same pairs out. */
export function detectConflicts(items: MemoryItem[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < items.length; i++) {
    const a = splitSubjectValue(items[i].normalized);
    if (!a) continue;
    for (let j = i + 1; j < items.length; j++) {
      const b = splitSubjectValue(items[j].normalized);
      if (!b) continue;
      if (a.prefix === b.prefix && a.value !== b.value) {
        pairs.push([items[i].id, items[j].id]);
      }
    }
  }
  return pairs;
}

/**
 * Merge `dropId` into `keepId`: the result keeps `keepId`'s identity (scope/text/etc.), unions
 * both items' provenance (deduped), and takes the HIGHER of the two confidences (not necessarily
 * `keepId`'s own — the surviving record should reflect the strongest evidence seen for either
 * duplicate). `lastSeenAt` is checkpointed to `now`, mirroring the reconcile checkpoint pattern
 * used elsewhere in the profile facade. Returns the full item set with `dropId` removed and
 * `keepId` replaced by the merged item. If either id isn't found, returns `items` unchanged.
 */
export function mergeItems(items: MemoryItem[], keepId: string, dropId: string, now: number): MemoryItem[] {
  const keep = items.find((it) => it.id === keepId);
  const drop = items.find((it) => it.id === dropId);
  if (!keep || !drop) return items;

  const merged: MemoryItem = {
    ...keep,
    provenance: Array.from(new Set([...keep.provenance, ...drop.provenance])),
    confidence: Math.max(keep.confidence, drop.confidence),
    lastSeenAt: now
  };

  return items.filter((it) => it.id !== dropId).map((it) => (it.id === keepId ? merged : it));
}
