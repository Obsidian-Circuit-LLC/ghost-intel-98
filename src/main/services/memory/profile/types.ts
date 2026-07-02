/**
 * Adaptive-memory profile item model. A `MemoryItem` is one durable, inspectable fact the
 * assistant has learned (or the user has authored/pinned) about a scope — the global vault,
 * a specific case, or a specific subject/handle. Distinct from the vector-RAG shards in
 * `../store.ts`: this is a small, deterministic, user-governable long-term profile, not an
 * embedding index. Everything here is persisted through secure-fs (encrypted at rest) and is
 * always inspectable/editable/erasable by the user — never silent.
 */

/** 'global' | `case:${caseId}` | `subject:${handle}` — a plain string so new scope kinds don't
 *  require a schema migration; producers/consumers agree on the prefix convention by contract. */
export type MemoryScope = string;

export interface MemoryItem {
  id: string;
  scope: MemoryScope;
  text: string;
  /** `normalizeItemText(text)` — used for dedupe/match, never shown to the user. */
  normalized: string;
  /** Free-form provenance labels (note names, conversation ids, etc.) this item was derived from. */
  provenance: string[];
  /** 0..1 confidence the item is still true/relevant. */
  confidence: number;
  createdAt: number;
  lastSeenAt: number;
  /** Pinned items are user-authoritative: exempt from decay/expiry, confidence held at 1. */
  pinned: boolean;
  source: 'extractor' | 'user';
}

/** Lowercased, whitespace-collapsed, trimmed — the canonical form used to match a candidate
 *  against an existing item within the same scope (see reconcile.ts). */
export function normalizeItemText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}
