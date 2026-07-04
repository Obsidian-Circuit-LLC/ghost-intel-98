import { onLedgerAppend, listEvidence } from './ledger';
import { buildInvestigationScene } from './scene';
import { diffScenes } from './scene-diff';
import * as entities from '../storage/entities';
import type { InvestigationScene, SceneDelta } from '@shared/investigation-graph';

const EMPTY: InvestigationScene = { nodes: [], edges: [] };
type TimerId = ReturnType<typeof setTimeout>;
let setTimeoutFn: (cb: () => void, ms: number) => TimerId = setTimeout;
let clearTimeoutFn: (id: TimerId) => void = clearTimeout;

const subs = new Map<string, Set<(d: SceneDelta) => void>>();
const lastScene = new Map<string, InvestigationScene>();
const pending = new Map<string, TimerId>();
let unsub: (() => void) | null = null;

export function __resetGraphForTest(): void {
  subs.clear(); lastScene.clear(); pending.clear();
  setTimeoutFn = setTimeout; clearTimeoutFn = clearTimeout;
  if (unsub) { unsub(); unsub = null; }
}

export async function sceneForCase(caseId: string): Promise<InvestigationScene> {
  const [all, evidence] = await Promise.all([entities.listAll(), listEvidence(caseId)]);
  return buildInvestigationScene({ entities: all, evidence, findings: [] });
}

async function flush(caseId: string): Promise<void> {
  pending.delete(caseId);
  const next = await sceneForCase(caseId);
  const prev = lastScene.get(caseId) ?? EMPTY;
  lastScene.set(caseId, next);
  const delta = diffScenes(prev, next);
  for (const cb of subs.get(caseId) ?? []) cb(delta);
}

export function startGraphEmitter(deps?: { setTimeoutFn?: typeof setTimeoutFn; clearTimeoutFn?: typeof clearTimeoutFn }): void {
  if (deps?.setTimeoutFn) setTimeoutFn = deps.setTimeoutFn;
  if (deps?.clearTimeoutFn) clearTimeoutFn = deps.clearTimeoutFn;
  if (unsub) return;
  unsub = onLedgerAppend((caseId) => {
    const existing = pending.get(caseId); if (existing) clearTimeoutFn(existing);
    pending.set(caseId, setTimeoutFn(() => { void flush(caseId); }, 150));
  });
}

export function onSceneDelta(caseId: string, cb: (d: SceneDelta) => void): () => void {
  const set = subs.get(caseId) ?? new Set(); set.add(cb); subs.set(caseId, set);
  return () => set.delete(cb);
}
