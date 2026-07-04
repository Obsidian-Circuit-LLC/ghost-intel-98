import * as entities from '../storage/entities';
import { getTransform } from './registry';
import { runTransform } from './runner';
import { checkAction, recordAction, type GuardState, type ProposedAction } from './guard';
import type { AgentAction, RunEvent } from '@shared/investigation-agent';

export interface RunState {
  runId: string; caseId: string; objective: string; seedIds: string[]; guard: GuardState;
  depth: Map<string, number>; expanded: Set<string>; focus: Set<string>; ignore: Set<string>;
  pendingAsk: ((a: string) => void) | null; lastError: string | null; humanInput: string | null;
  status: 'running' | 'stopped' | 'done'; stopReason: string | null;
}

export function newRunState(runId: string, caseId: string, objective: string, seedIds: string[], guard: GuardState): RunState {
  const depth = new Map<string, number>(); for (const id of seedIds) depth.set(id, 0);
  return { runId, caseId, objective, seedIds, guard, depth, expanded: new Set(), focus: new Set(), ignore: new Set(),
    pendingAsk: null, lastError: null, humanInput: null, status: 'running', stopReason: null };
}

/** One turn's dispatch of a brain action. Returns 'done' to end the run, else 'continue'. `ask` is
 *  emitted here but the WAIT is owned by the loop (Task 4). Deterministic: `now` (ms) is passed in. */
export async function runOneTurn(rs: RunState, action: AgentAction, emit: (e: RunEvent) => void, now: number): Promise<'continue' | 'done'> {
  if (action.kind === 'done') { rs.status = 'done'; rs.stopReason = action.reason; emit({ kind: 'done', reason: action.reason }); return 'done'; }
  if (action.kind === 'ask') { emit({ kind: 'ask', question: action.question }); return 'continue'; }

  if (action.reasoning) emit({ kind: 'thinking', text: action.reasoning });
  const t = getTransform(action.transformId);
  if (!t) { rs.lastError = `unknown transform: ${action.transformId}`; emit({ kind: 'blocked', reason: rs.lastError }); return 'continue'; }
  const all = await entities.listAll();
  const ent = all.find((e) => e.id === action.entityId);
  if (!ent) { rs.lastError = `unknown entity: ${action.entityId}`; emit({ kind: 'blocked', reason: rs.lastError }); return 'continue'; }
  if (!t.inputTypes.includes(ent.type)) { rs.lastError = `${t.id} does not accept ${ent.type}`; emit({ kind: 'blocked', reason: rs.lastError }); return 'continue'; }

  const parentDepth = rs.depth.get(ent.id) ?? 0;
  const pa: ProposedAction = { transformId: t.id, transformActive: t.active, entityId: ent.id, entityValue: ent.value, depth: parentDepth, estTokens: 0 };
  const decision = checkAction(rs.guard, pa, now);
  if (!decision.allow) { rs.lastError = decision.reason; emit({ kind: 'blocked', reason: decision.reason }); return 'continue'; }

  emit({ kind: 'action', transformId: t.id, entityValue: ent.value });
  try {
    const result = await runTransform(rs.caseId, rs.runId, t.id, { entityId: ent.id, entityType: ent.type, value: ent.value }, new Date(now).toISOString());
    rs.expanded.add(ent.id);
    for (const id of result.producedEntityIds) {
      const d = Math.min(rs.depth.get(id) ?? Number.POSITIVE_INFINITY, parentDepth + 1);
      rs.depth.set(id, d);
    }
    recordAction(rs.guard, pa, 0);
    rs.lastError = null;
    emit({ kind: 'observed', newEntities: result.producedEntityIds.length });
  } catch (e) {
    rs.lastError = `transform failed: ${(e as Error).message}`;
    emit({ kind: 'blocked', reason: rs.lastError }); // failed lead — recorded, run continues
  }
  return 'continue';
}
