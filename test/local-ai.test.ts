import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest';
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

describe('local-ai ensureRuntime()', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localAi.__resetForTest();
    // Ensure the bundled binary fixture exists on disk for spawn tests
    await mkdir('/tmp/ga98-localai-test/res/local-ai/models', { recursive: true });
    await writeFile('/tmp/ga98-localai-test/res/local-ai/ollama', 'x');
    await writeFile('/tmp/ga98-localai-test/res/local-ai/MODEL_PRESENT', 'llama3.1');
  });

  afterEach(async () => {
    localAi.__resetForTest();
    await rm('/tmp/ga98-localai-test/res', { recursive: true, force: true });
  });

  it('ensureRuntime() reuses an existing runtime without spawning', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })));
    const spawn = vi.fn();
    localAi.__setSpawnForTest(spawn);
    await localAi.ensureRuntime();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('ensureRuntime() spawns the managed child (loopback env) when none is up', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(async () => { throw new Error('down'); })   // initial detect
      .mockImplementation(async () => new Response(JSON.stringify({ models: [] }), { status: 200 }))); // readiness
    const spawn = vi.fn(() => ({ on: vi.fn(), kill: vi.fn(), pid: 123 }));
    localAi.__setSpawnForTest(spawn);
    localAi.__setBundledRootForTest('/tmp/ga98-localai-test/res/local-ai'); // binary present from 1.3 test setup
    await localAi.ensureRuntime();
    expect(spawn).toHaveBeenCalledTimes(1);
    const env = spawn.mock.calls[0][2].env;
    expect(env.OLLAMA_HOST).toBe('127.0.0.1:11434');
  });
});

describe('local-ai stop()', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localAi.__resetForTest();
    await mkdir('/tmp/ga98-localai-test/res/local-ai/models', { recursive: true });
    await writeFile('/tmp/ga98-localai-test/res/local-ai/ollama', 'x');
    await writeFile('/tmp/ga98-localai-test/res/local-ai/MODEL_PRESENT', 'llama3.1');
  });

  afterEach(async () => {
    localAi.__resetForTest();
    await rm('/tmp/ga98-localai-test/res', { recursive: true, force: true });
  });

  it('stop() kills only a child we spawned, once', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(async () => { throw new Error('down'); })
      .mockImplementation(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })));
    const kill = vi.fn();
    localAi.__setSpawnForTest(() => ({ on: vi.fn(), kill, pid: 7 }));
    localAi.__setBundledRootForTest('/tmp/ga98-localai-test/res/local-ai');
    await localAi.ensureRuntime();
    localAi.stop(); localAi.stop();
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('stop() never kills a reused runtime', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })));
    const kill = vi.fn();
    localAi.__setSpawnForTest(() => ({ on: vi.fn(), kill, pid: 9 }));
    await localAi.ensureRuntime(); // runtime already up → reuse, no spawn
    localAi.stop();
    expect(kill).not.toHaveBeenCalled();
  });
});
