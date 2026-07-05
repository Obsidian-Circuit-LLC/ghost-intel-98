import * as entities from '../storage/entities';
import { getTransform } from './registry';
import { runTransform } from './runner';
import { checkAction, recordAction, createGuard, recordProgress, shouldStop, stop as guardStop, type GuardState, type ProposedAction } from './guard';
import { assembleContext } from './perceive';
import { sceneForCase } from './graph';
import { upsertRun } from './ledger';
import type { AgentAction, Brain, RunEvent } from '@shared/investigation-agent';
import type { RunBudget, InvestigationRun } from '@shared/investigation-types';

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

interface RunDeps { emit: (runId: string, e: RunEvent) => void; now: () => number; noProgressWindow?: number }
const runs = new Map<string, { rs: RunState; deps: RunDeps }>();
let seq = 0;

export function getRunState(runId: string): RunState | undefined { return runs.get(runId)?.rs; }
export function __resetRunsForTest(): void { runs.clear(); seq = 0; }

export interface StartRunInput { caseId: string; seedIds: string[]; objective: string; budget: RunBudget; brain: Brain; deps: RunDeps }

function runRecord(rs: RunState, now: number): InvestigationRun {
  const iso = new Date(now).toISOString();
  return { id: rs.runId, caseId: rs.caseId, seedEntityIds: rs.seedIds, objective: rs.objective, budget: rs.guard.budget,
    status: rs.status === 'running' ? 'running' : rs.status, stopReason: rs.stopReason ?? undefined,
    actionLog: [], createdAt: iso, updatedAt: iso };
}

/** Runs a full turn loop until the run ends (done, stopped, or budget/no-progress exhaustion).
 *  Deterministic: the ONLY time source is `deps.now()`. Awaits the whole loop so tests can assert
 *  on the finished state; production callers may fire-and-forget. */
export async function startRun(input: StartRunInput): Promise<string> {
  const runId = `run-${++seq}`;
  const window = input.deps.noProgressWindow ?? 4;
  const rs = newRunState(runId, input.caseId, input.objective, input.seedIds, createGuard(input.budget, input.deps.now()));
  runs.set(runId, { rs, deps: input.deps });
  await upsertRun(input.caseId, runRecord(rs, input.deps.now()));
  const emit = (e: RunEvent): void => input.deps.emit(runId, e);

  while (rs.status === 'running') {
    const now = input.deps.now();
    const ctx = await assembleContext({ caseId: rs.caseId, objective: rs.objective, guard: rs.guard, now,
      seedIds: rs.seedIds, depth: rs.depth, expanded: rs.expanded, focus: rs.focus, ignore: rs.ignore,
      humanInput: rs.humanInput, lastError: rs.lastError });
    rs.humanInput = null;
    let action;
    try { action = await input.brain.decide(ctx); }
    catch (e) { rs.lastError = `brain error: ${(e as Error).message}`; emit({ kind: 'blocked', reason: rs.lastError }); action = null; }
    if (action) {
      const outcome = await runOneTurn(rs, action, emit, now);
      if (outcome === 'done') break;
      if (action.kind === 'ask') { await awaitAnswer(rs); continue; } // Task 5
    }
    recordProgress(rs.guard, (await sceneForCase(rs.caseId)).nodes.length);
    const s = shouldStop(rs.guard, input.deps.now(), window);
    if (s.stop) {
      if (!rs.guard.stopped) guardStop(rs.guard, s.reason ?? 'stopped');
      rs.status = 'stopped'; rs.stopReason = s.reason;
      emit({ kind: 'stopped', reason: s.reason ?? 'stopped' });
      break;
    }
  }
  await upsertRun(rs.caseId, runRecord(rs, input.deps.now()));
  runs.delete(runId);
  return runId;
}

// Placeholder wired in Task 5; for Task 4 no run scripts an `ask`.
async function awaitAnswer(rs: RunState): Promise<void> {
  await new Promise<void>((resolve) => { rs.pendingAsk = (a: string) => { rs.humanInput = a; rs.pendingAsk = null; resolve(); }; });
}
