/**
 * Indexer — builds/refreshes the vector shards from the case corpus and the conversation log.
 * Incremental: each source carries a contentHash, so unchanged notes/files/entities are NOT
 * re-embedded on a reindex (cheap to run on app start / after a save). Deterministic chunking.
 */
import { readdir } from 'node:fs/promises';
import { casesDir } from '../../storage/paths';
import { caseStore, noteStore, fileStore } from '../../storage/json-fs';
import * as conversations from '../../storage/ai-conversations';
import { chunkText, contentHash, type ChunkKind } from './chunker';
import { embed, EMBED_MODEL } from './embeddings';
import {
  caseShardPath, conversationShardPath, emptyShard, loadShard, saveShard, type StoredChunk
} from './store';

interface Source { key: string; kind: ChunkKind; ref: string; text: string }
export interface ReindexResult { embedded: number; skipped: number; chunks: number }
export interface ReindexProgress { done: number; total: number; label: string }

async function caseSources(caseId: string): Promise<{ title: string; sources: Source[] }> {
  const rec = await caseStore.read(caseId);
  const sources: Source[] = [];
  if (rec.description?.trim()) sources.push({ key: 'desc', kind: 'desc', ref: 'description', text: rec.description });
  const entText = rec.entities
    .map((e) => `${e.entity.value} ${e.entity.notes} ${e.entity.aliases.join(' ')}`.trim())
    .filter(Boolean).join('\n');
  if (entText.trim()) sources.push({ key: 'entities', kind: 'entity', ref: 'entities', text: entText });
  for (const n of rec.notes) {
    try { const body = await noteStore.read(caseId, n.name); if (body.trim()) sources.push({ key: `note:${n.name}`, kind: 'note', ref: n.name, text: body }); } catch { /* skip */ }
  }
  for (const a of rec.attachments) {
    try { const r = await fileStore.readAttachmentText(caseId, a.fileName); if (r.text?.trim()) sources.push({ key: `file:${a.fileName}`, kind: 'file', ref: a.originalName, text: r.text }); } catch { /* skip */ }
  }
  return { title: rec.title, sources };
}

/** Reindex one shard from a source set, re-embedding only changed/new sources. */
async function reindexShard(path: string, caseId: string, title: string, sources: Source[]): Promise<ReindexResult> {
  const prev = await loadShard(path);
  const base = prev && prev.model === EMBED_MODEL ? prev : emptyShard(caseId, title, EMBED_MODEL);
  const next = emptyShard(caseId, title, EMBED_MODEL);
  let embedded = 0, skipped = 0;
  const newTexts: string[] = [];
  const newChunks: Omit<StoredChunk, 'vector'>[] = [];

  for (const src of sources) {
    const h = contentHash(src.text);
    next.sources[src.key] = h;
    if (base.sources[src.key] === h) {
      const kept = base.chunks.filter((c) => c.sourceKey === src.key);
      if (kept.length) { next.chunks.push(...kept); skipped += 1; continue; }
    }
    chunkText(src.kind, src.ref, src.text).forEach((ch, i) => {
      newChunks.push({ id: `${src.key}#${i}`, sourceKey: src.key, kind: ch.kind, ref: ch.ref, text: ch.text });
      newTexts.push(ch.text);
    });
    embedded += 1;
  }
  if (newTexts.length) {
    const vecs = await embed(newTexts);
    newChunks.forEach((c, i) => next.chunks.push({ ...c, vector: vecs[i] }));
  }
  await saveShard(path, next);
  return { embedded, skipped, chunks: next.chunks.length };
}

export async function reindexCase(caseId: string): Promise<ReindexResult> {
  const { title, sources } = await caseSources(caseId);
  return reindexShard(caseShardPath(caseId), caseId, title, sources);
}

export async function reindexConversations(): Promise<ReindexResult> {
  const summaries = await conversations.list();
  const sources: Source[] = [];
  for (const s of summaries) {
    const convo = await conversations.get(s.id);
    if (!convo) continue;
    const text = convo.messages.map((m) => `${m.role}: ${m.content}`).join('\n').trim();
    if (text) sources.push({ key: `convo:${convo.id}`, kind: 'chat', ref: convo.title || 'conversation', text });
  }
  return reindexShard(conversationShardPath(), '__conversations__', 'Conversations', sources);
}

/** Reindex everything: every case + the conversation log. Reports coarse progress. */
export async function reindexAll(onProgress?: (p: ReindexProgress) => void): Promise<{ cases: number; chunks: number }> {
  let ids: string[] = [];
  try { ids = await readdir(casesDir()); } catch { ids = []; }
  const total = ids.length + 1;
  let done = 0, cases = 0, chunks = 0;
  for (const id of ids) {
    try { const r = await reindexCase(id); chunks += r.chunks; cases += 1; } catch { /* not a case dir / unreadable */ }
    onProgress?.({ done: (done += 1), total, label: id });
  }
  try { const r = await reindexConversations(); chunks += r.chunks; } catch { /* no conversations */ }
  onProgress?.({ done: (done += 1), total, label: 'conversations' });
  return { cases, chunks };
}
