import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

// indexer/store reach electron-bound paths; point userData at a temp dir.
const ROOT = join(tmpdir(), 'dcs98-forget-convo');
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));

// Two seeded conversations, one tombstoned (memoryExcluded). The store's save() strips
// unknown fields, so inject the flag by mocking the conversation store directly — this task
// only proves reindexConversations honors the flag; persistence is Task 2's concern.
const convos = [
  {
    id: 'inc', title: 'Included', createdAt: '', updatedAt: '',
    messages: [{ role: 'user', content: 'keep this conversation in the memory index please' }]
  },
  {
    id: 'exc', title: 'Excluded', createdAt: '', updatedAt: '',
    messages: [{ role: 'user', content: 'this conversation must be tombstoned out of memory' }],
    memoryExcluded: true
  }
];
vi.mock('../src/main/storage/ai-conversations', () => ({
  list: vi.fn(async () =>
    convos.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messageCount: c.messages.length }))),
  get: vi.fn(async (id: string) => convos.find((c) => c.id === id) ?? null)
}));

import { setEmbedderForTest } from '../src/main/services/memory/embeddings';
import { reindexConversations } from '../src/main/services/memory/indexer';
import { conversationShardPath, loadShard } from '../src/main/services/memory/store';

const vec = (t: string): number[] => [t.length, 0, 0, 0];

beforeEach(async () => {
  await rm(ROOT, { recursive: true, force: true });
  setEmbedderForTest(async (texts) => texts.map(vec));
});

describe('reindexConversations tombstone', () => {
  it('indexes included conversations but omits memoryExcluded ones', async () => {
    await reindexConversations();
    const shard = await loadShard(conversationShardPath());
    expect(shard).not.toBeNull();
    const keys = shard!.chunks.map((c) => c.sourceKey);
    expect(keys).toContain('convo:inc');
    expect(keys).not.toContain('convo:exc');
  });
});
