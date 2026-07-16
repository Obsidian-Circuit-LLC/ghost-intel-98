import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

// store/indexer/bonds/profile reach electron-bound paths; point userData at a temp dir so the real
// conversation store, shard store, bond store and profile store all share one on-disk dataRoot.
// Unlike the Task-1 test we do NOT mock the conversation store here — the whole point of this task
// is to prove the tombstone survives a real save()/get() round-trip (persistence is Task 2's concern).
const ROOT = join(tmpdir(), 'dcs98-forget-convo-ipc');
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));

import { setEmbedderForTest } from '../src/main/services/memory/embeddings';
import { reindexConversations } from '../src/main/services/memory/indexer';
import { conversationShardPath, loadShard } from '../src/main/services/memory/store';
import { buildGraph } from '../src/main/services/memory/graph';
import { createBonds } from '../src/main/services/memory/bonds';
import { recallProfile, setConversationFactsExcluded } from '../src/main/services/memory/profile';
import { createProfileStore } from '../src/main/services/memory/profile/profile-store';
import { normalizeItemText, type MemoryItem } from '../src/main/services/memory/profile/types';
import * as aiConvos from '../src/main/storage/ai-conversations';

const C1 = '11111111-1111-4111-8111-111111111111';
const NODE = `__conversations__:convo:${C1}`;

// The exact composition the memory:forgetConversation / rememberConversation IPC handlers run
// (register.ts). Kept here so the test drives the same handler-backing functions the handler does.
// Note: the handler deliberately does NOT prune bonds (a destructive, irreversible op that broke the
// "reversible tombstone" promise) — it tombstones both the chat chunks AND the facts distilled solely
// from this conversation, both reversibly.
async function forgetConversation(id: string): Promise<void> {
  const convo = await aiConvos.get(id);
  if (convo) await aiConvos.save({ ...convo, memoryExcluded: true });
  await reindexConversations();
  await setConversationFactsExcluded(id, true);
}
async function rememberConversation(id: string): Promise<void> {
  const convo = await aiConvos.get(id);
  if (convo) await aiConvos.save({ ...convo, memoryExcluded: false });
  await reindexConversations();
  await setConversationFactsExcluded(id, false);
}

const vec = (t: string): number[] => [t.length, 0, 0, 0];
const shardKeys = async (): Promise<string[]> => {
  const shard = await loadShard(conversationShardPath());
  return shard ? shard.chunks.map((c) => c.sourceKey) : [];
};

function fact(over: Partial<MemoryItem>): MemoryItem {
  const text = over.text ?? 'user prefers Y';
  return {
    id: 'f1',
    scope: 'global',
    text,
    normalized: normalizeItemText(text),
    provenance: [`conversation:${C1}`],
    confidence: 0.5,
    createdAt: 1000,
    lastSeenAt: 1000,
    pinned: false,
    source: 'extractor',
    ...over
  };
}
const recallIds = async (): Promise<string[]> => (await recallProfile('anything', ['global'])).items.map((i) => i.id);
const factNodeIds = async (): Promise<string[]> =>
  (await buildGraph()).nodes.filter((n) => n.kind === 'fact').map((n) => n.id);

beforeEach(async () => {
  await rm(ROOT, { recursive: true, force: true });
  setEmbedderForTest(async (texts) => texts.map(vec));
  await aiConvos._resetForTest();
  await aiConvos.save({ id: C1, title: 'Keeper', messages: [{ role: 'user', content: 'index this conversation in memory please' }] });
});

describe('memory:forgetConversation / rememberConversation', () => {
  it('forget tombstones: chat record survives, chunks vanish, user-drawn bond is PRESERVED (reversible)', async () => {
    await createBonds().add(NODE, 'profile:global:aaaaaaaa');
    await reindexConversations();
    expect(await shardKeys()).toContain(`convo:${C1}`);

    await forgetConversation(C1);

    const convo = await aiConvos.get(C1);
    expect(convo).not.toBeNull();               // chat survives (tombstone, not delete)
    expect(convo!.memoryExcluded).toBe(true);   // flag persisted through the store
    expect(await shardKeys()).not.toContain(`convo:${C1}`); // node/chunks gone
    // The hand-drawn bond is NOT destroyed — a forget is a reversible tombstone, not a delete.
    const bonds = await createBonds().list();
    expect(bonds.some((b) => b.a === NODE || b.b === NODE)).toBe(true);

    // Remember brings the node back and the bond still connects it — a true round-trip.
    await rememberConversation(C1);
    expect(await shardKeys()).toContain(`convo:${C1}`);
    expect((await createBonds().list()).some((b) => b.a === NODE || b.b === NODE)).toBe(true);
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

  it('forget also tombstones the facts distilled from the conversation: no longer injected, no longer a Mind\'s Eye node, but restorable', async () => {
    // A fact learnFromConversation would have distilled — provenance is SOLELY this conversation.
    await createProfileStore().put([fact({ id: 'solely-x' })]);
    expect(await recallIds()).toContain('solely-x');   // injected into answers before forget
    expect(await factNodeIds()).toContain('solely-x'); // rendered in Mind's Eye before forget

    await forgetConversation(C1);

    expect(await recallIds()).not.toContain('solely-x');   // no longer injected
    expect(await factNodeIds()).not.toContain('solely-x'); // no longer rendered
    // Reversible tombstone, not a delete: the item survives on disk (inspectable/erasable/restorable).
    expect((await createProfileStore().all()).some((i) => i.id === 'solely-x')).toBe(true);

    await rememberConversation(C1);

    expect(await recallIds()).toContain('solely-x');   // restored to injection
    expect(await factNodeIds()).toContain('solely-x'); // restored to the graph
  });

  it('forget leaves facts with independent support (multi-provenance) live', async () => {
    // Reinforced by another conversation / a note as well — it has support beyond the forgotten
    // conversation, so Forget must NOT hide it (reconcile.ts merges provenance on reinforcement).
    await createProfileStore().put([fact({ id: 'shared', provenance: [`conversation:${C1}`, 'note:foo'] })]);

    await forgetConversation(C1);

    expect(await recallIds()).toContain('shared');
    expect(await factNodeIds()).toContain('shared');
  });
});
