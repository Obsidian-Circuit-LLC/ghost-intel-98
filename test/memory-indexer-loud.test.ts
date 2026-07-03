import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

// indexer/store reach electron-bound paths; point userData at a temp dir.
const ROOT = join(tmpdir(), 'dcs98-indexer-loud');
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));

import { setEmbedderForTest } from '../src/main/services/memory/embeddings';
import { reindexAll } from '../src/main/services/memory/indexer';
import { conversationShardPath, loadShard } from '../src/main/services/memory/store';
import * as conversations from '../src/main/storage/ai-conversations';

const vec = (t: string): number[] => [t.length, 0, 0, 0];

beforeEach(async () => {
  await rm(ROOT, { recursive: true, force: true });
  setEmbedderForTest(null);
});

describe('loud indexer', () => {
  it('reindexAll reports failures instead of swallowing, and does not wipe a prior shard', async () => {
    await conversations.save({
      id: 'c1',
      title: 'Alpha chat',
      messages: [{ role: 'user', content: 'alpha content that will be embedded on the first pass' }]
    });

    // First reindexAll succeeds with a working embedder: this writes a real, non-empty shard.
    setEmbedderForTest(async (texts) => texts.map(vec));
    const first = await reindexAll();
    expect(first.failures).toEqual([]);
    expect(first.chunks).toBeGreaterThan(0);

    const priorShard = await loadShard(conversationShardPath());
    expect(priorShard).not.toBeNull();
    const priorChunkCount = priorShard!.chunks.length;
    expect(priorChunkCount).toBeGreaterThan(0);

    // Change the conversation so a re-embed is attempted, then make the embedder throw.
    await conversations.save({
      id: 'c1',
      title: 'Alpha chat',
      messages: [{ role: 'user', content: 'a completely different message that must trigger a re-embed' }]
    });
    setEmbedderForTest(async () => { throw new Error('embed boom'); });

    const second = await reindexAll();
    expect(Array.isArray(second.failures)).toBe(true);
    expect(second.failures.length).toBeGreaterThanOrEqual(1);
    expect(second.failures[0].error).toContain('boom');

    // The prior good shard must survive the failed reindex — no empty/partial overwrite.
    const afterShard = await loadShard(conversationShardPath());
    expect(afterShard).not.toBeNull();
    expect(afterShard!.chunks.length).toBe(priorChunkCount);
  });
});
