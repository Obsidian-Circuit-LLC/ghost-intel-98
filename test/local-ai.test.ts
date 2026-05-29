import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-localai-test' } }));
import * as localAi from '../src/main/services/local-ai';

describe('local-ai detect()', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reports runtimeUp + modelPresent when the loopback API lists llama3.1', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ models: [{ name: 'llama3.1:latest' }] }), { status: 200 })));
    const s = await localAi.detect();
    expect(s.runtimeUp).toBe(true);
    expect(s.modelPresent).toBe(true);
  });

  it('reports runtime down when the probe rejects (no Ollama)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const s = await localAi.detect();
    expect(s.runtimeUp).toBe(false);
    expect(s.modelPresent).toBe(false);
  });
});

describe('local-ai isBundled()', () => {
  afterAll(async () => {
    await rm('/tmp/ga98-localai-test/res', { recursive: true, force: true });
  });

  it('isBundled() true only when the runtime binary + model marker exist under resources', async () => {
    localAi.__setBundledRootForTest('/tmp/ga98-localai-test/res/local-ai');
    expect(await localAi.isBundled()).toBe(false);
    await mkdir('/tmp/ga98-localai-test/res/local-ai/models', { recursive: true });
    await writeFile('/tmp/ga98-localai-test/res/local-ai/ollama', 'x');
    await writeFile('/tmp/ga98-localai-test/res/local-ai/MODEL_PRESENT', 'llama3.1');
    expect(await localAi.isBundled()).toBe(true);
  });
});
