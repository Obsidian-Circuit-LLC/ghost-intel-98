import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

// store/indexer/bonds reach electron-bound paths; point userData at a temp dir so the real
// conversation store, shard store and bond store all share one on-disk dataRoot. Unlike the
// Task-1 test we do NOT mock the conversation store here — the whole point of this task is to
// prove the tombstone survives a real save()/get() round-trip (persistence is Task 2's concern).
const ROOT = join(tmpdir(), 'dcs98-forget-convo-ipc');
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));

import { setEmbedderForTest } from '../src/main/services/memory/embeddings';
import { reindexConversations } from '../src/main/services/memory/indexer';
import { conversationShardPath, loadShard } from '../src/main/services/memory/store';
import { pruneBondsForNode } from '../src/main/services/memory/graph';
import { createBonds } from '../src/main/services/memory/bonds';
import * as aiConvos from '../src/main/storage/ai-conversations';

const C1 = '11111111-1111-4111-8111-111111111111';
const NODE = `__conversations__:convo:${C1}`;

// The exact composition the memory:forgetConversation / rememberConversation IPC handlers run
// (register.ts). Kept here so the test drives the same handler-backing functions the handler does.
async function forgetConversation(id: string): Promise<void> {
  const convo = await aiConvos.get(id);
  if (convo) await aiConvos.save({ ...convo, memoryExcluded: true });
  await reindexConversations();
  await pruneBondsForNode(`__conversations__:convo:${id}`);
}
async function rememberConversation(id: string): Promise<void> {
  const convo = await aiConvos.get(id);
  if (convo) await aiConvos.save({ ...convo, memoryExcluded: false });
  await reindexConversations();
}

const vec = (t: string): number[] => [t.length, 0, 0, 0];
const shardKeys = async (): Promise<string[]> => {
  const shard = await loadShard(conversationShardPath());
  return shard ? shard.chunks.map((c) => c.sourceKey) : [];
};

beforeEach(async () => {
  await rm(ROOT, { recursive: true, force: true });
  setEmbedderForTest(async (texts) => texts.map(vec));
  await aiConvos._resetForTest();
  await aiConvos.save({ id: C1, title: 'Keeper', messages: [{ role: 'user', content: 'index this conversation in memory please' }] });
});

describe('memory:forgetConversation / rememberConversation', () => {
  it('forget tombstones: chat record survives, chunks vanish, dangling bond is pruned', async () => {
    await createBonds().add(NODE, 'profile:global:aaaaaaaa');
    await reindexConversations();
    expect(await shardKeys()).toContain(`convo:${C1}`);

    await forgetConversation(C1);

    const convo = await aiConvos.get(C1);
    expect(convo).not.toBeNull();               // chat survives (tombstone, not delete)
    expect(convo!.memoryExcluded).toBe(true);   // flag persisted through the store
    expect(await shardKeys()).not.toContain(`convo:${C1}`); // node/chunks gone
    const bonds = await createBonds().list();
    expect(bonds.some((b) => b.a === NODE || b.b === NODE)).toBe(false); // dead edge removed
  });

  it('remember restores: flag cleared and the chunks return', async () => {
    await forgetConversation(C1);
    expect(await shardKeys()).not.toContain(`convo:${C1}`);

    await rememberConversation(C1);

    const convo = await aiConvos.get(C1);
    expect(convo!.memoryExcluded).toBe(false);
    expect(await shardKeys()).toContain(`convo:${C1}`);
  });

  it('a normal resave without the flag preserves an existing tombstone (chatting more does not un-forget)', async () => {
    await forgetConversation(C1);
    // Renderer-style save: only {id,title,messages} — no memoryExcluded field.
    await aiConvos.save({ id: C1, title: 'Keeper', messages: [{ role: 'user', content: 'a new turn in the forgotten chat' }] });
    const convo = await aiConvos.get(C1);
    expect(convo!.memoryExcluded).toBe(true);
    await reindexConversations();
    expect(await shardKeys()).not.toContain(`convo:${C1}`);
  });
});
