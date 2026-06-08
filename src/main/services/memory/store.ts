/**
 * Vector memory store — pure cosine math + per-shard persistence through secure-fs (so the index is
 * encrypted at rest with the rest of the vault, never plaintext). A "shard" is one JSON file holding
 * the embedded chunks for one source set (a case, or the conversation log). Brute-force cosine over a
 * single user's corpus is plenty fast; no native dependency, no SQLite.
 */
import { join } from 'node:path';
import { caseDir, dataRoot } from '../../storage/paths';
import { secureReadText, secureWriteFile } from '../../storage/secure-fs';
import type { ChunkKind } from './chunker';

export const SHARD_VERSION = 1;

export interface StoredChunk {
  id: string;        // stable: `${sourceKey}#${index}`
  sourceKey: string; // which source produced this chunk (for incremental skip-unchanged)
  kind: ChunkKind;
  ref: string;
  text: string;      // full chunk text (used as RAG context; snippet derived for display)
  vector: number[];
}

export interface MemoryShard {
  version: number;
  model: string;
  caseId: string;    // owning case id, or '__conversations__'
  title: string;     // case title, or 'Conversations'
  sources: Record<string, string>; // sourceKey → contentHash (skip-unchanged manifest)
  chunks: StoredChunk[];
}

export function caseShardPath(caseId: string): string {
  return join(caseDir(caseId), 'memory', 'index.json');
}
export function conversationShardPath(): string {
  return join(dataRoot(), 'memory', 'conversations.json');
}

export function emptyShard(caseId: string, title: string, model: string): MemoryShard {
  return { version: SHARD_VERSION, model, caseId, title, sources: {}, chunks: [] };
}

export async function loadShard(path: string): Promise<MemoryShard | null> {
  try {
    const parsed = JSON.parse(await secureReadText(path)) as MemoryShard;
    if (!parsed || parsed.version !== SHARD_VERSION || !Array.isArray(parsed.chunks)) return null;
    return parsed;
  } catch {
    return null; // missing / unreadable / stale-version → treat as no shard
  }
}

export async function saveShard(path: string, shard: MemoryShard): Promise<void> {
  await secureWriteFile(path, JSON.stringify(shard));
}

/** Cosine similarity of two equal-length vectors. Returns 0 for a zero vector (avoids NaN). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export interface Scored { chunk: StoredChunk; score: number }

/**
 * Top-k chunks by cosine to the query vector. Stable, deterministic ordering: score descending,
 * ties broken by chunk id ascending — so identical inputs always return identical evidence.
 */
export function topKChunks(chunks: StoredChunk[], query: number[], k: number): Scored[] {
  return chunks
    .map((chunk) => ({ chunk, score: cosine(chunk.vector, query) }))
    .sort((a, b) => (b.score - a.score) || a.chunk.id.localeCompare(b.chunk.id))
    .slice(0, Math.max(0, k));
}
