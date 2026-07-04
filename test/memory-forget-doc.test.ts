import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { rm } from 'node:fs/promises';
const ROOT = join(tmpdir(), 'dcs98-forget-doc');
import { vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));
vi.mock('../src/main/services/memory/embed-runtime', () => ({ ensureEmbedRuntime: async () => {}, embedEndpoint: () => 'x', embedHealth: async () => ({ ok: true }) }));

import { channels } from '../src/shared/ipc-contracts';
import { setEmbedderForTest } from '../src/main/services/memory/embeddings';
import { createLibrary } from '../src/main/services/memory/library/store';
import { reindexLibrary } from '../src/main/services/memory/indexer';
import { recall } from '../src/main/services/memory/retriever';

beforeEach(async () => { await rm(ROOT, { recursive: true, force: true }); setEmbedderForTest(null); });

describe('forgetDoc channel', () => {
  it('declares memory:forgetDoc', () => {
    expect(channels.memory.forgetDoc).toBe('memory:forgetDoc');
  });
});

describe('forgetDoc removes the doc and its chunks', () => {
  it('recall finds an added doc, then no longer finds it once forgotten', async () => {
    setEmbedderForTest(async (texts) => texts.map((t) => [t.includes('zebra') ? 1 : 0, 1]));
    const lib = createLibrary();
    await lib.add({ docId: 'doc-z', title: 'z.txt', mime: 'text/plain', text: 'the zebra crossing report', now: 1 });
    await reindexLibrary();

    const before = await recall('zebra');
    expect(before.some((h) => h.kind === 'doc' && h.ref === 'z.txt')).toBe(true);

    // This is exactly what the memory:forgetDoc handler does: remove from the library, then
    // synchronously reindex the library shard (not the debounced live-reindex libraryRemove uses).
    await createLibrary().remove('doc-z');
    await reindexLibrary();

    const after = await recall('zebra');
    expect(after.some((h) => h.kind === 'doc' && h.ref === 'z.txt')).toBe(false);
  });
});
