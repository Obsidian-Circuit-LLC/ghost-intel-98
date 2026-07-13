import { describe, it, expect, beforeEach } from 'vitest';
import { reasoningGenerate, configureReasoningRuntime, __setExistsForTest, __setProbeForTest, __setGenerateFetchForTest, __resetReasoningRuntimeForTest, ensureReasoningRuntime } from '../src/main/services/reasoning/reasoning-runtime';

describe('reasoningGenerate', () => {
  beforeEach(() => { __resetReasoningRuntimeForTest(); });
  it('POSTs the prompt to /api/generate on the resolved endpoint and returns the response text', async () => {
    configureReasoningRuntime({ modelsDir: '/tmp/models', model: 'reason' });
    __setExistsForTest(async () => true);
    __setProbeForTest(async () => true);   // runtime resolves immediately
    let seenUrl = ''; let seenBody: any = null;
    __setGenerateFetchForTest(async (url, init: any) => { seenUrl = url; seenBody = JSON.parse(init.body); return { ok: true, json: async () => ({ response: 'run-transform crypto-btc-txs' }) }; });
    await ensureReasoningRuntime();
    const out = await reasoningGenerate('decide', { maxTokens: 128, stop: ['\n\n'] });
    expect(seenUrl).toMatch(/\/api\/generate$/);
    expect(seenBody).toMatchObject({ model: 'reason', prompt: 'decide', stream: false });
    expect(out).toBe('run-transform crypto-btc-txs');
  });
  it('throws a clear error when the runtime is not resolved', async () => {
    __resetReasoningRuntimeForTest();
    await expect(reasoningGenerate('x')).rejects.toThrow(/reasoning runtime not available/i);
  });
});
