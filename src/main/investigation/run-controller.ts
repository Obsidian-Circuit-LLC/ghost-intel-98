import * as entities from '../storage/entities';
import { getTransform } from './registry';
import { runTransform } from './runner';
import { checkAction, recordAction, createGuard, recordProgress, shouldStop, stop as guardStop, pause, resume, addToScope, removeFromScope, type GuardState, type ProposedAction } from './guard';
import { assembleContext } from './perceive';
import { sceneForCase } from './graph';
import { upsertRun } from './ledger';
import type { AgentAction, Brain, RunEvent } from '@shared/investigation-agent';
import type { RunBudget, InvestigationRun } from '@shared/investigation-types';

export interface RunState {
  runId: string; caseId: string; objective: string; seedIds: string[]; guard: GuardState;
  depth: Map<string, number>; expanded: Set<string>; focus: Set<string>; ignore: Set<string>;
  pendingAsk: ((a: string) => void) | null; resumeSignal: (() => void) | null;
  lastError: string | null; humanInput: string | null;
  status: 'running' | 'stopped' | 'done'; stopReason: string | null;
}

export function newRunState(runId: string, caseId: string, objective: string, seedIds: string[], guard: GuardState): RunState {
  const depth = new Map<string, number>(); for (const id of seedIds) depth.set(id, 0);
  return { runId, caseId, objective, seedIds, guard, depth, expanded: new Set(), focus: new Set(), ignore: new Set(),
    pendingAsk: null, resumeSignal: null, lastError: null, humanInput: null, status: 'running', stopReason: null };
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

export interface StartRunHandle { runId: string; completed: Promise<void> }

function emitFor(runId: string, e: RunEvent): void { runs.get(runId)?.deps.emit(runId, e); }

/** Park until answered or stopped (a brain `ask`). Resolves immediately if the run is no longer
 *  running, so a stop-during-in-flight-decide can never arm a never-resolved wait. */
function awaitAnswer(rs: RunState): Promise<void> {
  if (rs.status !== 'running') return Promise.resolve();
  return new Promise<void>((resolve) => { rs.pendingAsk = (a: string) => { rs.humanInput = a; rs.pendingAsk = null; resolve(); }; });
}

/** Park until resumed or stopped (a `pauseRun`). */
function awaitResume(rs: RunState): Promise<void> {
  if (rs.status !== 'running') return Promise.resolve();
  return new Promise<void>((resolve) => { rs.resumeSignal = () => { rs.resumeSignal = null; resolve(); }; });
}

/**
 * Start a run. Returns the `runId` IMMEDIATELY (registered synchronously) plus a `completed` promise
 * that resolves when the loop ends. The loop runs DETACHED so an IPC caller isn't blocked and the
 * ask/answer + pause control flow works. A storage/perceive error finalizes the run as `stopped`
 * (never leaks the registry entry), and a paused run truly parks (no busy-spin into no-progress).
 * Deterministic: the ONLY time source is `deps.now()`.
 */
export function startRun(input: StartRunInput): StartRunHandle {
  const runId = `run-${++seq}`;
  const window = input.deps.noProgressWindow ?? 4;
  const rs = newRunState(runId, input.caseId, input.objective, input.seedIds, createGuard(input.budget, input.deps.now()));
  runs.set(runId, { rs, deps: input.deps });
  const emit = (e: RunEvent): void => input.deps.emit(runId, e);

  const completed = (async () => {
    await upsertRun(input.caseId, runRecord(rs, input.deps.now()));
    try {
      while (rs.status === 'running') {
        if (rs.guard.paused) { await awaitResume(rs); continue; } // truly park, don't busy-spin
        const now = input.deps.now();
        const ctx = await assembleContext({ caseId: rs.caseId, objective: rs.objective, guard: rs.guard, now,
          seedIds: rs.seedIds, depth: rs.depth, expanded: rs.expanded, focus: rs.focus, ignore: rs.ignore,
          humanInput: rs.humanInput, lastError: rs.lastError });
        rs.humanInput = null;
        let action: AgentAction | null;
        try { action = await input.brain.decide(ctx); }
        catch (e) { rs.lastError = `brain error: ${(e as Error).message}`; emit({ kind: 'blocked', reason: rs.lastError }); action = null; }
        if (action) {
          const outcome = await runOneTurn(rs, action, emit, now);
          if (outcome === 'done') break;
          if (action.kind === 'ask') {
            if (rs.status !== 'running') break;    // stopped during the in-flight decide → do NOT park
            await awaitAnswer(rs);
            if (rs.status !== 'running') break;    // stopped while parked on the ask
            continue;
          }
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
    } catch (e) {
      // A perceive/storage error must never leak the run — finalize it as stopped.
      if (rs.status === 'running') {
        rs.status = 'stopped'; rs.stopReason = `error: ${(e as Error).message}`;
        if (!rs.guard.stopped) guardStop(rs.guard, rs.stopReason);
        emit({ kind: 'stopped', reason: rs.stopReason });
      }
    } finally {
      await upsertRun(rs.caseId, runRecord(rs, input.deps.now())).catch(() => {});
      runs.delete(runId);
    }
  })();

  return { runId, completed };
}

function rsOf(runId: string): RunState | undefined { return runs.get(runId)?.rs; }

export function pauseRun(runId: string): void {
  const rs = rsOf(runId); if (!rs || rs.status !== 'running' || rs.guard.paused) return;
  pause(rs.guard); emitFor(runId, { kind: 'paused' }); // the loop parks at its next top-of-iteration check
}
export function resumeRun(runId: string): void {
  const rs = rsOf(runId); if (!rs || !rs.guard.paused) return;
  resume(rs.guard); emitFor(runId, { kind: 'resumed' }); rs.resumeSignal?.(); // unpark the loop
}
export function addScope(runId: string, target: string): void { const rs = rsOf(runId); if (rs) addToScope(rs.guard, target); }
export function removeScope(runId: string, target: string): void { const rs = rsOf(runId); if (rs) removeFromScope(rs.guard, target); }
export function focusEntity(runId: string, entityId: string): void { const rs = rsOf(runId); if (rs) { rs.focus.add(entityId); rs.ignore.delete(entityId); } }
export function ignoreEntity(runId: string, entityId: string): void { const rs = rsOf(runId); if (rs) { rs.ignore.add(entityId); rs.focus.delete(entityId); } }
export function answerRun(runId: string, text: string): void { const rs = rsOf(runId); if (rs) rs.pendingAsk?.(text); }
export function stopRun(runId: string, reason: string): void {
  const rs = rsOf(runId); if (!rs) return;
  guardStop(rs.guard, reason); rs.status = 'stopped'; rs.stopReason = reason;
  rs.pendingAsk?.('');    // unblock a run parked on `ask`
  rs.resumeSignal?.();    // unblock a run parked on `pause`
}
