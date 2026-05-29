import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { LOCAL_AI_ENDPOINT, LOCAL_AI_MODEL, bundledRoot as defaultBundledRoot, fetchedRoot, fetchedModelsDir } from './local-ai-paths';
import type { LocalAiStatus } from '@shared/ipc-contracts';

let bundledOverride: boolean | null = null; // set by isBundled() in a later task; test seam

let bundledRootFn = defaultBundledRoot;
export function __setBundledRootForTest(p: string): void { bundledRootFn = () => p; }
async function exists(p: string): Promise<boolean> { try { await access(p); return true; } catch { return false; } }

type SpawnLike = (cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; stdio?: unknown }) => { on: (...a: unknown[]) => void; kill: () => void; pid?: number };
let spawnFn: SpawnLike = nodeSpawn as unknown as SpawnLike;
export function __setSpawnForTest(fn: SpawnLike): void { spawnFn = fn; }
let child: { kill: () => void } | null = null; // set ONLY when WE spawned (stop() uses this)

export function stop(): void {
  if (child) { child.kill(); child = null; }
}

export function __resetForTest(): void {
  spawnFn = nodeSpawn as unknown as SpawnLike;
  child = null;
  bundledRootFn = defaultBundledRoot;
  bundledOverride = null;
}

export async function isBundled(): Promise<boolean> {
  const root = bundledRootFn();
  const bin = (await exists(join(root, 'ollama'))) || (await exists(join(root, 'ollama.exe')));
  const model = await exists(join(root, 'MODEL_PRESENT'));
  bundledOverride = bin && model;
  return bundledOverride;
}

async function probeTags(): Promise<string[] | null> {
  try {
    const res = await fetch(`${LOCAL_AI_ENDPOINT}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: { name?: string }[] };
    return (body.models ?? []).map((m) => m.name ?? '');
  } catch { return null; }
}

export async function detect(): Promise<LocalAiStatus> {
  const tags = await probeTags();
  const runtimeUp = tags !== null;
  const modelPresent = !!tags?.some((n) => n.startsWith(LOCAL_AI_MODEL));
  return {
    state: runtimeUp ? (modelPresent ? 'running' : 'not-present') : 'not-present',
    runtimeUp, modelPresent, bundled: bundledOverride ?? false
  };
}

export async function ensureRuntime(): Promise<void> {
  if ((await detect()).runtimeUp) return; // reuse existing — never spawn/kill it
  const bundled = await isBundled();
  const root = bundled ? bundledRootFn() : fetchedRoot();
  const binName = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  const bin = join(root, binName);
  const modelsDir = bundled ? join(root, 'models') : fetchedModelsDir();
  const env: NodeJS.ProcessEnv = { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_MODELS: modelsDir, OLLAMA_NO_ANALYTICS: '1' };
  const c = spawnFn(bin, ['serve'], { env, stdio: 'ignore' });
  child = c;
  // readiness poll: up to ~30s
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if ((await probeTags()) !== null) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Local AI runtime did not become ready in time.');
}
