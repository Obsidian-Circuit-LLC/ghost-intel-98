import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-embep-test') } }));

const ensured = { called: false };
vi.mock('../src/main/services/memory/embed-runtime', () => ({
  ensureEmbedRuntime: async () => { ensured.called = true; },
  embedEndpoint: () => 'http://127.0.0.1:11435'
}));

import { embed, setEmbedderForTest } from '../src/main/services/memory/embeddings';

beforeEach(() => { ensured.called = false; setEmbedderForTest(null); });

describe('embeddings routing', () => {
  it('defaultEmbed ensures the embed runtime and POSTs to its endpoint', async () => {
    let calledUrl = '';
    const g = globalThis as unknown as { fetch: typeof fetch };
    const orig = g.fetch;
    g.fetch = (async (url: string) => {
      calledUrl = String(url);
      return { ok: true, json: async () => ({ embedding: [1, 0, 0] }) } as Response;
    }) as typeof fetch;
    try {
      const out = await embed(['hello']);
      expect(ensured.called).toBe(true);
      expect(calledUrl).toBe('http://127.0.0.1:11435/api/embeddings');
      expect(out[0]).toEqual([1, 0, 0]);
    } finally { g.fetch = orig; }
  });
});
