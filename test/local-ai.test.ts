import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-localai-test' } }));
import { settingsStore } from '../src/main/storage/json-fs';
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

  it('treats a foreign 200 with no models array as runtime-down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const s = await localAi.detect();
    expect(s.runtimeUp).toBe(false);
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

  it('ensureRuntime() fails fast and clears the child if it exits before ready', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); })); // never becomes ready
    const kill = vi.fn();
    // spawn mock whose 'exit' listener fires immediately
    localAi.__setSpawnForTest(() => {
      const handlers: Record<string, () => void> = {};
      queueMicrotask(() => handlers.exit?.());
      return { on: (ev: string, cb: () => void) => { handlers[ev] = cb; }, kill, pid: 5 };
    });
    localAi.__setBundledRootForTest('/tmp/ga98-localai-test/res/local-ai');
    await expect(localAi.ensureRuntime()).rejects.toThrow(/exited before/i);
    localAi.stop();
    expect(kill).not.toHaveBeenCalled(); // child was cleared on early exit
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

describe('local-ai ensureModel()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localAi.__resetForTest();
  });

  afterEach(() => {
    localAi.__resetForTest();
  });

  it('ensureModel() is a no-op when llama3.1 already present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'llama3.1' }] }), { status: 200 })));
    const run = vi.fn();
    localAi.__setRunForTest(run);
    await localAi.ensureModel();
    expect(run).not.toHaveBeenCalled();
  });

  it('ensureModel() runs the import when the model is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })));
    const run = vi.fn(async () => {});
    localAi.__setRunForTest(run);
    localAi.__setBundledRootForTest('/tmp/ga98-localai-test/res/local-ai');
    await localAi.ensureModel();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('local-ai autoConfigure()', () => {
  beforeEach(async () => {
    localAi.__resetForTest();
    await rm('/tmp/ga98-localai-test', { recursive: true, force: true });
    await mkdir('/tmp/ga98-localai-test', { recursive: true });
  });

  afterEach(async () => {
    localAi.__resetForTest();
    await rm('/tmp/ga98-localai-test', { recursive: true, force: true });
  });

  it('autoConfigure() sets ollama/loopback/llama3.1 when provider is none', async () => {
    await settingsStore.update({ ai: { provider: 'none', endpoint: '', model: '' } as any });
    await localAi.autoConfigure();
    const s = await settingsStore.read();
    expect(s.ai.provider).toBe('ollama');
    expect(s.ai.endpoint).toBe('http://127.0.0.1:11434');
    expect(s.ai.model).toBe('llama3.1');
  });

  it('autoConfigure() never overrides a user-set custom endpoint', async () => {
    await settingsStore.update({ ai: { provider: 'openai-compatible', endpoint: 'https://api.example.com', model: 'gpt-4o-mini' } as any });
    await localAi.autoConfigure();
    const s = await settingsStore.read();
    expect(s.ai.provider).toBe('openai-compatible');
    expect(s.ai.endpoint).toBe('https://api.example.com');
  });
});
