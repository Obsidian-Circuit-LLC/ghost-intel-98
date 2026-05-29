import { LOCAL_AI_ENDPOINT, LOCAL_AI_MODEL } from './local-ai-paths';
import type { LocalAiStatus } from '@shared/ipc-contracts';

let bundledOverride: boolean | null = null; // set by isBundled() in a later task; test seam

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
