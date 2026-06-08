import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

// memory store / indexer reach electron-bound paths; point userData at a temp dir.
const ROOT = join(tmpdir(), 'dcs98-memory-test');
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));

import { cosine, topKChunks, type StoredChunk } from '../src/main/services/memory/store';
import { chunkText, contentHash, CHUNK_SIZE } from '../src/main/services/memory/chunker';
import { setEmbedderForTest } from '../src/main/services/memory/embeddings';
import { reindexConversations } from '../src/main/services/memory/indexer';
import { recall } from '../src/main/services/memory/retriever';
import * as conversations from '../src/main/storage/ai-conversations';

// Deterministic fake embedder: a bag-of-vocab vector so similarity is predictable in tests.
const VOCAB = ['alpha', 'beta', 'gamma', 'delta'];
const vec = (t: string): number[] => VOCAB.map((w) => (t.toLowerCase().match(new RegExp(w, 'g')) ?? []).length);
let embedCalls = 0;
setEmbedderForTest(async (texts) => { embedCalls += texts.length; return texts.map(vec); });

const chunk = (id: string, text: string): StoredChunk => ({ id, sourceKey: 's', kind: 'note', ref: 'r', text, vector: vec(text) });

describe('vector store math', () => {
  it('cosine: identical→1, orthogonal→0, opposite→-1, zero→0', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it('topKChunks is ordered by score then id (deterministic)', () => {
    const chunks = [chunk('b', 'beta'), chunk('a', 'alpha alpha'), chunk('c', 'alpha')];
    const top = topKChunks(chunks, vec('alpha'), 2);
    expect(top.map((t) => t.chunk.id)).toEqual(['a', 'c']); // 'a' (2×alpha) and 'c' (1×alpha) beat 'b'
    // a deterministic tie: two equal-score chunks resolve by id ascending
    const tie = topKChunks([chunk('z', 'alpha'), chunk('a', 'alpha')], vec('alpha'), 2);
    expect(tie.map((t) => t.chunk.id)).toEqual(['a', 'z']);
  });
});

describe('chunker', () => {
  it('is deterministic and overlaps', () => {
    const text = 'x'.repeat(CHUNK_SIZE * 2);
    const a = chunkText('note', 'n', text);
    const b = chunkText('note', 'n', text);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(1);
    expect(a[1].start).toBeLessThan(a[0].end); // windows overlap
  });
  it('contentHash is stable for identical text, differs otherwise', () => {
    expect(contentHash('hello')).toBe(contentHash('hello'));
    expect(contentHash('hello')).not.toBe(contentHash('world'));
  });
  it('drops whitespace-only text', () => {
    expect(chunkText('note', 'n', '   \n  ')).toHaveLength(0);
  });
});

describe('indexer + retriever (end-to-end with conversation store)', () => {
  beforeEach(async () => { await rm(ROOT, { recursive: true, force: true }); embedCalls = 0; });

  it('indexes conversations and recalls the relevant one with provenance', async () => {
    await conversations.save({ id: 'c1', title: 'Alpha chat', messages: [{ role: 'user', content: 'tell me about alpha alpha alpha' }] });
    await conversations.save({ id: 'c2', title: 'Beta chat', messages: [{ role: 'user', content: 'all about beta beta' }] });
    await reindexConversations();

    const hits = await recall('alpha');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].kind).toBe('chat');
    expect(hits[0].ref).toBe('Alpha chat'); // the alpha conversation ranks first
  });

  it('skips re-embedding unchanged sources on a second reindex', async () => {
    await conversations.save({ id: 'c1', title: 'Alpha chat', messages: [{ role: 'user', content: 'alpha content' }] });
    await reindexConversations();
    const callsAfterFirst = embedCalls;
    expect(callsAfterFirst).toBeGreaterThan(0);
    const r = await reindexConversations(); // nothing changed
    expect(embedCalls).toBe(callsAfterFirst); // no new embed calls
    expect(r.skipped).toBeGreaterThan(0);
    expect(r.embedded).toBe(0);
  });
});
