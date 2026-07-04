import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'dcs98-embedrt-test') } }));

import {
  ensureEmbedRuntime, embedEndpoint, embedHealth, embedBundled,
  __setSpawnForTest, __setProbeForTest, __setBundledForTest, __setBundledRootForTest, __resetEmbedRuntimeForTest
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

describe('embedBundled() — gates on the EMBED bundle marker, not the chat MODEL_PRESENT marker', () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dcs98-embed-bundle-')); });
  afterEach(async () => { __setBundledRootForTest(null); await rm(dir, { recursive: true, force: true }); });

  it('is true with the ollama binary + EMBED_MODEL_PRESENT, even though no chat MODEL_PRESENT marker exists', async () => {
    await writeFile(join(dir, process.platform === 'win32' ? 'ollama.exe' : 'ollama'), '');
    await writeFile(join(dir, 'EMBED_MODEL_PRESENT'), '');
    __setBundledRootForTest(dir);
    expect(await embedBundled()).toBe(true);
  });

  it('is false when the EMBED_MODEL_PRESENT marker is absent', async () => {
    await writeFile(join(dir, process.platform === 'win32' ? 'ollama.exe' : 'ollama'), '');
    __setBundledRootForTest(dir);
    expect(await embedBundled()).toBe(false);
  });
});
