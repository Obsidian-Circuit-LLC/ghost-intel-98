import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
const ROOT = join(tmpdir(), 'dcs98-graph-assemble');
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));
vi.mock('../src/main/services/memory/embed-runtime', () => ({ ensureEmbedRuntime: async () => {}, embedEndpoint: () => 'x', embedHealth: async () => 'ready' }));

import { setEmbedderForTest } from '../src/main/services/memory/embeddings';
import { createLibrary } from '../src/main/services/memory/library/store';
import { reindexLibrary } from '../src/main/services/memory/indexer';
import { buildGraph } from '../src/main/services/memory/graph';

beforeEach(async () => { await rm(ROOT, { recursive: true, force: true }); setEmbedderForTest(null); });

describe('assemble MemoryGraph', () => {
  it('builds nodes with finite positions and links similar docs', async () => {
    // deterministic embedder: token-overlap vector so the two zebra docs land near-identical
    setEmbedderForTest(async (texts) => texts.map((t) => [t.includes('zebra') ? 1 : 0, t.includes('giraffe') ? 1 : 0]));
    const lib = createLibrary();
    await lib.add({ docId: 'doc-z1', title: 'z1.txt', mime: 'text/plain', text: 'the zebra crossing report', now: 1 });
    await lib.add({ docId: 'doc-z2', title: 'z2.txt', mime: 'text/plain', text: 'another zebra sighting', now: 2 });
    await reindexLibrary();

    const graph = await buildGraph();
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    expect(graph.edges.length).toBeGreaterThan(0);
    const docEdge = graph.edges.find((e) => e.kind === 'auto');
    expect(docEdge).toBeTruthy();
  });

  it('charter: determinism — buildGraph() twice on the same pool gives identical positions and edges', async () => {
    setEmbedderForTest(async (texts) => texts.map((t) => [t.includes('zebra') ? 1 : 0, t.includes('giraffe') ? 1 : 0]));
    const lib = createLibrary();
    await lib.add({ docId: 'doc-z1', title: 'z1.txt', mime: 'text/plain', text: 'the zebra crossing report', now: 1 });
    await lib.add({ docId: 'doc-z2', title: 'z2.txt', mime: 'text/plain', text: 'another zebra sighting', now: 2 });
    await reindexLibrary();

    const a = await buildGraph();
    const b = await buildGraph();
    expect(a.nodes).toEqual(b.nodes);
    expect(a.edges).toEqual(b.edges);
  });
});
