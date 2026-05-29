import { describe, it, expect, vi, beforeEach } from 'vitest';
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
