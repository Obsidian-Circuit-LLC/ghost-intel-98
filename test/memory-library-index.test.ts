import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { rm } from 'node:fs/promises';
const ROOT = join(tmpdir(), 'dcs98-lib-index');
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));
vi.mock('../src/main/services/memory/embed-runtime', () => ({ ensureEmbedRuntime: async () => {}, embedEndpoint: () => 'x', embedHealth: async () => ({ ok: true }) }));

import { setEmbedderForTest } from '../src/main/services/memory/embeddings';
import { createLibrary } from '../src/main/services/memory/library/store';
import { reindexLibrary } from '../src/main/services/memory/indexer';
import { recall } from '../src/main/services/memory/retriever';

beforeEach(async () => { await rm(ROOT, { recursive: true, force: true }); setEmbedderForTest(null); });

describe('library indexing + recall', () => {
  it('an added document is embedded and recalled globally', async () => {
    // deterministic embedder: token-overlap vector so query matches doc
    setEmbedderForTest(async (texts) => texts.map((t) => [t.includes('zebra') ? 1 : 0, 1]));
    const lib = createLibrary();
    await lib.add({ docId: 'doc-z', title: 'z.txt', mime: 'text/plain', text: 'the zebra crossing report', now: 1 });
    const r = await reindexLibrary();
    expect(r.chunks).toBeGreaterThan(0);
    const hits = await recall('zebra');
    expect(hits.some((h) => h.kind === 'doc' && h.ref === 'z.txt')).toBe(true);
  });
});
