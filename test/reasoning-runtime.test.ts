import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configureReasoningRuntime, ensureReasoningRuntime, reasoningEndpoint, reasoningHealth, reasoningAvailable,
  __setSpawnForTest, __setProbeForTest, __setTagsForTest, __setExistsForTest, __resetReasoningRuntimeForTest
} from '../src/main/services/reasoning/reasoning-runtime';

function fakeChild() {
  const h: Record<string, (() => void)[]> = {};
  return { on(ev: string, cb: () => void) { (h[ev] ||= []).push(cb); }, kill() {}, pid: 1, __fire(ev: string) { (h[ev] || []).forEach((f) => f()); } };
}
beforeEach(() => __resetReasoningRuntimeForTest());

describe('reasoning runtime (model-agnostic mechanism)', () => {
  it('is unconfigured/unavailable until a model dir is configured', async () => {
    expect(await reasoningHealth()).toBe('unconfigured');
    expect(await reasoningAvailable()).toBe(false);
  });

  it('configured + bundle present: spawns on the dedicated port and reports ready', async () => {
    configureReasoningRuntime({ modelsDir: join(tmpdir(), 'rt-models'), model: 'qwen2.5-14b' });
    __setExistsForTest(async () => true); // ollama binary + models dir exist
    let env: NodeJS.ProcessEnv | undefined;
    __setSpawnForTest((_b, _a, opts) => { env = opts.env; return fakeChild(); });
    __setProbeForTest(async () => true);
    __setTagsForTest(async () => ['qwen2.5-14b:latest']);
    await ensureReasoningRuntime();
    expect(env?.OLLAMA_HOST).toContain('11440');
    expect(env?.OLLAMA_MODELS).toContain('rt-models');
    expect(reasoningEndpoint()).toContain('11440');
    expect(await reasoningHealth()).toBe('ready');
  });

  it('server up but model absent → model-missing (honest health)', async () => {
    configureReasoningRuntime({ modelsDir: join(tmpdir(), 'rt-models'), model: 'qwen2.5-14b' });
    __setExistsForTest(async () => true);
    __setSpawnForTest(() => fakeChild());
    __setProbeForTest(async () => true);
    __setTagsForTest(async () => ['llama3.1:latest']); // not the reasoning model
    await ensureReasoningRuntime();
    expect(await reasoningHealth()).toBe('model-missing');
  });

  it('configured but bundle/model dir missing → unavailable, does not spawn', async () => {
    configureReasoningRuntime({ modelsDir: '/nope', model: 'qwen2.5-14b' });
    __setExistsForTest(async () => false);
    let spawned = false;
    __setSpawnForTest(() => { spawned = true; return fakeChild(); });
    await expect(ensureReasoningRuntime()).rejects.toThrow(/unavailable/i);
    expect(spawned).toBe(false);
  });
});
