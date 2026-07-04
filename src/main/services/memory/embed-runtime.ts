import { spawn as nodeSpawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { bundledRoot, LOCAL_AI_ENDPOINT } from '../local-ai-paths';
import { ensureRuntime } from '../local-ai';
import { EMBED_MODEL } from './embeddings';

export type EmbedHealth = 'ready' | 'starting' | 'unavailable' | 'model-missing';

export const EMBED_HOST = '127.0.0.1';
export const EMBED_PORT_BASE = 11435;
const EMBED_PORT_MAX_STEPS = 5; // try EMBED_PORT_BASE .. EMBED_PORT_BASE+4

type SpawnLike = (cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; stdio?: unknown }) => { on: (...a: unknown[]) => void; kill: () => void; pid?: number };

let spawnFn: SpawnLike = nodeSpawn as unknown as SpawnLike;
let probeFn: (url: string) => Promise<boolean> = defaultProbe;
let tagsFn: (url: string) => Promise<string[] | null> = defaultTags;
let bundledOverride: boolean | null = null;
let bundledRootOverride: string | null = null;

let resolvedEndpoint: string | null = null;
let starting = false;

export function __setSpawnForTest(fn: SpawnLike | null): void { spawnFn = fn ?? (nodeSpawn as unknown as SpawnLike); }
export function __setProbeForTest(fn: ((url: string) => Promise<boolean>) | null): void { probeFn = fn ?? defaultProbe; }
export function __setTagsForTest(fn: ((url: string) => Promise<string[] | null>) | null): void { tagsFn = fn ?? defaultTags; }
export function __setBundledForTest(v: boolean | null): void { bundledOverride = v; }
export function __setBundledRootForTest(dir: string | null): void { bundledRootOverride = dir; }
export function __resetEmbedRuntimeForTest(): void {
  spawnFn = nodeSpawn as unknown as SpawnLike;
  probeFn = defaultProbe;
  tagsFn = defaultTags;
  bundledOverride = null;
  bundledRootOverride = null;
  resolvedEndpoint = null;
  starting = false;
}

async function defaultProbe(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}

/** Fetches the loaded-model tag list from `<url>/api/tags`, or `null` if the server is unreachable
 * / responded with an error — mirrors chat's `probeTags()` in `local-ai.ts` so `embedHealth()` can
 * tell "server up but model not loaded" apart from "server down". */
async function defaultTags(url: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: { name?: string }[] };
    return Array.isArray(body.models) ? body.models.map((m) => m.name ?? '') : null;
  } catch { return null; }
}

async function exists(p: string): Promise<boolean> { try { await access(p); return true; } catch { return false; } }

/**
 * Whether the dedicated embedding bundle (ollama binary + `EMBED_MODEL_PRESENT`) shipped with
 * this install — independent of the chat model's `MODEL_PRESENT` marker. The installer ships
 * only `EMBED_MODEL_PRESENT` (the chat model is the user's own Ollama), so gating on the chat
 * marker (as `resolveBundled()` used to, via `isBundled()`) is always false in production and the
 * 11435 embed runtime never starts.
 */
export async function embedBundled(root?: string): Promise<boolean> {
  try {
    const r = root ?? bundledRootOverride ?? safeBundledRoot();
    if (!r) return false;
    const bin = (await exists(join(r, 'ollama'))) || (await exists(join(r, 'ollama.exe')));
    const model = await exists(join(r, 'EMBED_MODEL_PRESENT'));
    return bin && model;
  } catch { return false; }
}

async function resolveBundled(): Promise<boolean> {
  if (bundledOverride !== null) return bundledOverride;
  return embedBundled();
}

export function embedEndpoint(): string {
  return resolvedEndpoint ?? LOCAL_AI_ENDPOINT;
}

// `bundledRoot()` reads `process.resourcesPath`, which only exists under a packaged Electron
// runtime; guard it so dev/test contexts (where it's undefined) don't crash before we even reach
// the spawn/probe loop below.
function safeBundledRoot(): string {
  try { return bundledRoot(); } catch { return join(process.cwd(), 'resources', 'local-ai'); }
}

async function spawnOnPort(port: number): Promise<boolean> {
  const root = safeBundledRoot();
  const binName = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  const bin = join(root, binName);
  const modelsDir = join(root, 'models');
  const endpoint = `http://${EMBED_HOST}:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, OLLAMA_HOST: `${EMBED_HOST}:${port}`, OLLAMA_MODELS: modelsDir, OLLAMA_NO_ANALYTICS: '1' };

  starting = true;
  const c = spawnFn(bin, ['serve'], { env, stdio: 'ignore' });
  let earlyExit = false;
  c.on('exit', () => { earlyExit = true; });
  c.on('error', () => { earlyExit = true; });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (earlyExit) return false;
    if (await probeFn(endpoint)) {
      resolvedEndpoint = endpoint;
      starting = false;
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function ensureEmbedRuntime(): Promise<void> {
  // Idempotent short-circuit, mirroring local-ai.ts's ensureRuntime(): if we already resolved
  // an endpoint and it's still answering, reuse it instead of re-entering the spawn/port-step loop.
  if (resolvedEndpoint && (await probeFn(resolvedEndpoint))) return;
  if (await resolveBundled()) {
    for (let step = 0; step < EMBED_PORT_MAX_STEPS; step++) {
      const port = EMBED_PORT_BASE + step;
      if (await spawnOnPort(port)) return;
    }
    starting = false;
    throw new Error('Embedding runtime could not start (is a port in 11435–11439 free?).');
  }
  // Dev fallback: never spawn our own runtime — reuse the user's own Ollama on 11434.
  await ensureRuntime();
  resolvedEndpoint = LOCAL_AI_ENDPOINT;
}

export async function embedHealth(): Promise<EmbedHealth> {
  if (starting) return 'starting';
  const endpoint = embedEndpoint();
  const tags = await tagsFn(endpoint);
  if (tags === null) return 'unavailable';
  const modelPresent = tags.some((n) => n.startsWith(EMBED_MODEL));
  return modelPresent ? 'ready' : 'model-missing';
}
