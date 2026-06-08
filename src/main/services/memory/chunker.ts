/**
 * Deterministic text chunker for the vector memory. Splits a source's text into fixed-size,
 * overlapping windows on stable boundaries (no time, no RNG) so the same input always produces the
 * same chunks — a requirement of the determinism floor for retrieval.
 */
import { createHash } from 'node:crypto';

export type ChunkKind = 'desc' | 'note' | 'file' | 'entity' | 'chat';

export interface SourceChunk {
  kind: ChunkKind;
  ref: string; // human-facing source label (note name, file name, entity value, conversation title)
  text: string;
  start: number;
  end: number;
}

export const CHUNK_SIZE = 800;
export const CHUNK_OVERLAP = 150;

/** sha256 of a source's full text — used to skip re-embedding unchanged sources. */
export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Split `text` into overlapping windows. Whitespace-only windows are dropped. Deterministic. */
export function chunkText(kind: ChunkKind, ref: string, text: string): SourceChunk[] {
  const out: SourceChunk[] = [];
  const clean = text.replace(/\r\n/g, '\n');
  if (!clean.trim()) return out;
  const step = Math.max(1, CHUNK_SIZE - CHUNK_OVERLAP);
  for (let start = 0; start < clean.length; start += step) {
    const end = Math.min(clean.length, start + CHUNK_SIZE);
    const slice = clean.slice(start, end);
    if (slice.trim()) out.push({ kind, ref, text: slice, start, end });
    if (end >= clean.length) break;
  }
  return out;
}

/** A short, single-line preview for display/provenance. */
export function snippetOf(text: string, max = 160): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
