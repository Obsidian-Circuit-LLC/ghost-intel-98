import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-embedrt-test') } }));

import {
  ensureEmbedRuntime, embedEndpoint, embedHealth,
  __setSpawnForTest, __setProbeForTest, __setBundledForTest, __resetEmbedRuntimeForTest
} from '../src/main/services/memory/embed-runtime';

function fakeChild() {
  const handlers: Record<string, (() => void)[]> = {};
  return { on(ev: string, cb: () => void) { (handlers[ev] ||= []).push(cb); }, kill() {}, pid: 1234, __fire(ev: string) { (handlers[ev] || []).forEach((f) => f()); } };
}

beforeEach(() => __resetEmbedRuntimeForTest());

describe('dedicated embedding runtime', () => {
  it('bundled: spawns on the dedicated port and reports ready', async () => {
    __setBundledForTest(true);
    let spawnedEnv: NodeJS.ProcessEnv | undefined;
    __setSpawnForTest((_bin, _args, opts) => { spawnedEnv = opts.env; return fakeChild(); });
    __setProbeForTest(async () => true); // runtime answers immediately
    await ensureEmbedRuntime();
    expect(spawnedEnv?.OLLAMA_HOST).toContain('11435');
    expect(spawnedEnv?.OLLAMA_MODELS).toContain('models');
    expect(embedEndpoint()).toContain('11435');
    expect(await embedHealth()).toBe('ready');
  });

  it('not bundled: does not spawn, endpoint falls back to 11434', async () => {
    __setBundledForTest(false);
    let spawned = false;
    __setSpawnForTest(() => { spawned = true; return fakeChild(); });
    __setProbeForTest(async (url) => url.includes('11434'));
    await ensureEmbedRuntime();
    expect(spawned).toBe(false);
    expect(embedEndpoint()).toContain('11434');
  });
});
