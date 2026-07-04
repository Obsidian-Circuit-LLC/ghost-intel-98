import { spawn as nodeSpawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { bundledRoot } from '../local-ai-paths';

export type ReasoningHealth = 'unconfigured' | 'starting' | 'unavailable' | 'model-missing' | 'ready';
export const REASONING_HOST = '127.0.0.1';
export const REASONING_PORT_BASE = 11440;
const REASONING_PORT_MAX_STEPS = 5; // 11440..11444

type SpawnLike = (cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv; stdio?: unknown }) => { on: (...a: unknown[]) => void; kill: () => void; pid?: number };
let spawnFn: SpawnLike = nodeSpawn as unknown as SpawnLike;
let probeFn: (url: string) => Promise<boolean> = defaultProbe;
let tagsFn: (url: string) => Promise<string[] | null> = defaultTags;
let existsFn: (p: string) => Promise<boolean> = defaultExists;

let config: { modelsDir: string; model: string } | null = null;
let resolvedEndpoint: string | null = null;
let starting = false;

export function configureReasoningRuntime(cfg: { modelsDir: string; model: string } | null): void { config = cfg; resolvedEndpoint = null; }
export function __setSpawnForTest(fn: SpawnLike | null): void { spawnFn = fn ?? (nodeSpawn as unknown as SpawnLike); }
export function __setProbeForTest(fn: ((u: string) => Promise<boolean>) | null): void { probeFn = fn ?? defaultProbe; }
export function __setTagsForTest(fn: ((u: string) => Promise<string[] | null>) | null): void { tagsFn = fn ?? defaultTags; }
export function __setExistsForTest(fn: ((p: string) => Promise<boolean>) | null): void { existsFn = fn ?? defaultExists; }
export function __resetReasoningRuntimeForTest(): void {
  spawnFn = nodeSpawn as unknown as SpawnLike; probeFn = defaultProbe; tagsFn = defaultTags; existsFn = defaultExists;
  config = null; resolvedEndpoint = null; starting = false;
}

async function defaultExists(p: string): Promise<boolean> { try { await access(p); return true; } catch { return false; } }
async function defaultProbe(url: string): Promise<boolean> { try { const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } }
async function defaultTags(url: string): Promise<string[] | null> {
  try {
    const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const b = (await r.json()) as { models?: { name?: string }[] };
    return Array.isArray(b.models) ? b.models.map((m) => m.name ?? '') : null;
  } catch { return null; }
}
function binName(): string { return process.platform === 'win32' ? 'ollama.exe' : 'ollama'; }

// `bundledRoot()` reads `process.resourcesPath`, which only exists under a packaged Electron
// runtime; guard it so dev/test contexts (where it's undefined) don't crash before we even reach
// the exists-check / spawn/probe loop below (mirrors embed-runtime.ts's `safeBundledRoot()`).
function safeBundledRoot(): string {
  try { return bundledRoot(); } catch { return join(process.cwd(), 'resources', 'local-ai'); }
}

/** True when the runtime CAN start: bundled ollama binary present AND the configured models dir exists. */
export async function reasoningAvailable(): Promise<boolean> {
  if (!config) return false;
  const bin = await existsFn(join(safeBundledRoot(), binName()));
  const dir = await existsFn(config.modelsDir);
  return bin && dir;
}
export function reasoningEndpoint(): string | null { return resolvedEndpoint; }

async function spawnOnPort(port: number): Promise<boolean> {
  if (!config) return false;
  const endpoint = `http://${REASONING_HOST}:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, OLLAMA_HOST: `${REASONING_HOST}:${port}`, OLLAMA_MODELS: config.modelsDir, OLLAMA_NO_ANALYTICS: '1' };
  starting = true;
  const c = spawnFn(join(safeBundledRoot(), binName()), ['serve'], { env, stdio: 'ignore' });
  let earlyExit = false;
  c.on('exit', () => { earlyExit = true; });
  c.on('error', () => { earlyExit = true; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (earlyExit) { starting = false; return false; }
    if (await probeFn(endpoint)) { resolvedEndpoint = endpoint; starting = false; return true; }
    await new Promise((r) => setTimeout(r, 500));
  }
  starting = false; return false;
}

export async function ensureReasoningRuntime(): Promise<void> {
  if (resolvedEndpoint && (await probeFn(resolvedEndpoint))) return;
  if (!(await reasoningAvailable())) throw new Error('Reasoning runtime unavailable (model not configured or not present).');
  for (let step = 0; step < REASONING_PORT_MAX_STEPS; step++) {
    if (await spawnOnPort(REASONING_PORT_BASE + step)) return;
  }
  throw new Error('Reasoning runtime could not start (is a port in 11440–11444 free?).');
}

export async function reasoningHealth(): Promise<ReasoningHealth> {
  if (!config) return 'unconfigured';
  if (starting) return 'starting';
  if (!resolvedEndpoint) return 'unavailable';
  const tags = await tagsFn(resolvedEndpoint);
  if (tags === null) return 'unavailable';
  return tags.some((n) => n.startsWith(config!.model)) ? 'ready' : 'model-missing';
}
