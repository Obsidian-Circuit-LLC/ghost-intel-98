// test/memory-add-visible-failure.test.ts — Task 4: "+Add to memory" must surface embed
// failures instead of silently succeeding. `addLibraryDocIndexed` (indexer.ts) is the function
// register.ts's `libraryAdd` IPC handler delegates to — mirrors the memory-bond-ipc.test.ts
// precedent of exercising the underlying op directly rather than standing up ipcMain.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

const ROOT = join(tmpdir(), 'dcs98-add-visible-failure');
vi.mock('electron', () => ({ app: { getPath: () => ROOT } }));

import { setEmbedderForTest } from '../src/main/services/memory/embeddings';
import { addLibraryDocIndexed } from '../src/main/services/memory/indexer';

beforeEach(async () => {
  await rm(ROOT, { recursive: true, force: true });
  setEmbedderForTest(null);
});

describe('add-to-memory visible failure', () => {
  it('resolves ok:true with the persisted doc when the embedder works', async () => {
    setEmbedderForTest(async (texts) => texts.map(() => [0, 0, 0, 0]));
    const result = await addLibraryDocIndexed({ title: 'Doc A', mime: 'text/plain', text: 'hello world, some real content to chunk and embed' });
    expect(result.ok).toBe(true);
    expect(result.doc.title).toBe('Doc A');
    expect(result.error).toBeUndefined();
  });

  it('resolves ok:false with a structured error when the embedder throws (404) — NOT a silent success', async () => {
    setEmbedderForTest(async () => { throw new Error('Embeddings: HTTP 404 Not Found (is the "nomic-embed-text" model present?)'); });
    const result = await addLibraryDocIndexed({ title: 'Doc B', mime: 'text/plain', text: 'some other real content to chunk and embed' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('404');
    // The upload itself is not lost even though indexing failed — the doc text is still persisted.
    expect(result.doc.title).toBe('Doc B');
  });
});
