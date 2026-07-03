import { spawn as nodeSpawn } from 'node:child_process';
import { join } from 'node:path';
import { bundledRoot, LOCAL_AI_ENDPOINT } from '../local-ai-paths';
import { isBundled, ensureRuntime } from '../local-ai';

export type EmbedHealth = 'ready' | 'starting' | 'unavailable';

export const EMBED_HOST = '127.0.0.1';
export const EMBED_PORT_BASE = 11435;
const EMBED_PORT_MAX_STEPS = 5; // try EMBED_PORT_BASE .. EMBED_PORT_BASE+4

type SpawnLike = (cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; stdio?: unknown }) => { on: (...a: unknown[]) => void; kill: () => void; pid?: number };

let spawnFn: SpawnLike = nodeSpawn as unknown as SpawnLike;
let probeFn: (url: string) => Promise<boolean> = defaultProbe;
let bundledOverride: boolean | null = null;

let resolvedEndpoint: string | null = null;
let starting = false;

export function __setSpawnForTest(fn: SpawnLike | null): void { spawnFn = fn ?? (nodeSpawn as unknown as SpawnLike); }
export function __setProbeForTest(fn: ((url: string) => Promise<boolean>) | null): void { probeFn = fn ?? defaultProbe; }
export function __setBundledForTest(v: boolean | null): void { bundledOverride = v; }
export function __resetEmbedRuntimeForTest(): void {
  spawnFn = nodeSpawn as unknown as SpawnLike;
  probeFn = defaultProbe;
  bundledOverride = null;
  resolvedEndpoint = null;
  starting = false;
}

async function defaultProbe(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}

async function resolveBundled(): Promise<boolean> {
  if (bundledOverride !== null) return bundledOverride;
  return isBundled();
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
  return (await probeFn(endpoint)) ? 'ready' : 'unavailable';
}
