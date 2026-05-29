import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { LOCAL_AI_ENDPOINT, LOCAL_AI_MODEL, bundledRoot as defaultBundledRoot } from './local-ai-paths';
import type { LocalAiStatus } from '@shared/ipc-contracts';

let bundledOverride: boolean | null = null; // set by isBundled() in a later task; test seam

let bundledRootFn = defaultBundledRoot;
export function __setBundledRootForTest(p: string): void { bundledRootFn = () => p; }
async function exists(p: string): Promise<boolean> { try { await access(p); return true; } catch { return false; } }

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
