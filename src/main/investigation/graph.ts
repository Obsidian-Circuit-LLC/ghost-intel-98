import { onLedgerAppend, listEvidence, listFindings, appendEvidence } from './ledger';
import { buildInvestigationScene } from './scene';
import { diffScenes } from './scene-diff';
import * as entities from '../storage/entities';
import type { InvestigationScene, SceneDelta } from '@shared/investigation-graph';
import type { EntityType } from '@shared/types';

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
  const [all, evidence, findings] = await Promise.all([entities.listAll(), listEvidence(caseId), listFindings(caseId)]);
  return buildInvestigationScene({ entities: all, evidence, findings });
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

/** Manual add-node: reuses an existing entity of the same type+value if one exists (no
 *  duplicates), else creates it, then appends a `manual` evidence record referencing it so the
 *  ledger notifier streams the change like any transform-produced entity. `now` is supplied by
 *  the caller (the IPC boundary) — this stays clock-free. */
export async function addManualNode(caseId: string, type: EntityType, value: string, now: string): Promise<void> {
  const all = await entities.listAll();
  const existing = all.find((e) => e.type === type && e.value === value);
  const rec = existing ?? (await entities.create({ type, value }));
  await appendEvidence(
    caseId,
    { runId: 'manual', transformId: 'manual', transformVersion: '1', inputEntityId: rec.id, producedEntityIds: [rec.id], producedEdges: [], signals: [] },
    '',
    now
  );
}

/** Manual draw-edge: both entities must already exist (referenced by id, as `GraphCanvas`'s
 *  draw-bond gesture connects two already-rendered nodes). Appends a `manual` evidence record
 *  whose `producedEdges` carries the resolved {value,type} pair `buildInvestigationScene` expects. */
export async function addManualEdge(caseId: string, fromId: string, toId: string, relation: string, now: string): Promise<void> {
  const all = await entities.listAll();
  const a = all.find((e) => e.id === fromId);
  const b = all.find((e) => e.id === toId);
  if (!a || !b) throw new Error('Both entities must exist to add an edge');
  await appendEvidence(
    caseId,
    {
      runId: 'manual',
      transformId: 'manual',
      transformVersion: '1',
      inputEntityId: fromId,
      producedEntityIds: [fromId, toId],
      producedEdges: [{ fromValue: a.value, fromType: a.type, toValue: b.value, toType: b.type, relation }],
      signals: []
    },
    '',
    now
  );
}
