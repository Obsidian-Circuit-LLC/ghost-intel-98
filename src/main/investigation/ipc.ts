/**
 * SP-4 investigation graph IPC wiring + SP-6 run-harness IPC wiring, extracted from
 * `main/ipc/register.ts` into their own dependency-light module so each seam is unit-testable
 * without dragging in register.ts's entire transitive import surface (chat/ssh/ftp/searchlight/
 * etc). `register.ts` calls `registerInvestigationGraphIpc`/`registerInvestigationRunIpc` with the
 * real `ipcMain`-backed `safeHandle` + `webContents.send`-backed push callbacks.
 *
 * Watcher lifecycle: the renderer calls `investigation:graph(caseId)` to fetch the current
 * scene; the first such call for a given caseId also subscribes it to the debounced emitter
 * (Task 4), so every subsequent ledger append for that case streams a delta via `sendToWatchers`.
 */
import { channels } from '@shared/ipc-contracts';
import { sceneForCase, onSceneDelta, startGraphEmitter } from './graph';
import { startRun, pauseRun, resumeRun, stopRun, addScope, removeScope, focusEntity, ignoreEntity, answerRun } from './run-controller';
import type { InvestigationScene, SceneDelta } from '@shared/investigation-graph';
import type { Brain, RunEvent } from '@shared/investigation-agent';
import type { RunBudget } from '@shared/investigation-types';

type HandleFn = (channel: string, fn: (...args: unknown[]) => unknown) => void;
type SendToWatchers = (payload: { caseId: string; delta: SceneDelta }) => void;

export function registerInvestigationGraphIpc(deps: { handle: HandleFn; sendToWatchers: SendToWatchers; validateCaseId: (id: unknown) => string }): void {
  startGraphEmitter();
  const watched = new Set<string>();
  deps.handle(channels.investigation.graph, (...args: unknown[]): Promise<InvestigationScene> => {
    // Validate BEFORE the id reaches sceneForCase → listEvidence → ledgerFile → caseDir(join): a raw
    // caseId like '../../..' would otherwise escape casesDir() on the read side (node:path.join does
    // not strip traversal). register.ts injects ensureUuid; every sibling caseId channel already does.
    const caseId = deps.validateCaseId(args[0]);
    if (!watched.has(caseId)) {
      watched.add(caseId);
      onSceneDelta(caseId, (delta) => deps.sendToWatchers({ caseId, delta }));
    }
    return sceneForCase(caseId);
  });
}

// ---- SP-6 run harness IPC wiring ----

function ensureNonEmptyString(v: unknown, max: number, context: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new Error(`Invalid ${context}`);
  return v;
}

function ensureStringArray(v: unknown, max: number, context: string): string[] {
  if (!Array.isArray(v)) throw new Error(`Invalid ${context}`);
  return v.map((x) => ensureNonEmptyString(x, max, context));
}

function ensureRunBudget(v: unknown): RunBudget {
  const b = v as Partial<RunBudget> | null | undefined;
  if (!b || typeof b !== 'object') throw new Error('Invalid budget');
  const { maxPivots, maxDepth, maxWallClockMs, maxTokens } = b;
  for (const n of [maxPivots, maxDepth, maxWallClockMs, maxTokens]) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new Error('Invalid budget');
  }
  return { maxPivots: maxPivots as number, maxDepth: maxDepth as number, maxWallClockMs: maxWallClockMs as number, maxTokens: maxTokens as number };
}

export interface RegisterRunIpcDeps {
  handle: HandleFn;
  /** Main→renderer push: every `RunEvent` from any live run, tagged with its runId. */
  sendEvent: (payload: { runId: string; event: RunEvent }) => void;
  /** Same `ensureUuid`-backed validator register.ts injects into the graph seam above. */
  validateCaseId: (id: unknown) => string;
  /** The ONE production wall-clock entry point (`Date.now`), passed through unchanged so the
   *  run loop/guard stay deterministic — see run-controller's `startRun`. */
  now: () => number;
  /** Returns the free-form reasoning brain when the OSINT investigator plugin (subsystem-2) is
   *  installed, else `null` — `run:start` refuses with a guarded error rather than running headless. */
  getBrain: () => Brain | null;
}

/** Wires the SP-6 run harness's start/control surface + its event stream. Mirrors
 *  `registerInvestigationGraphIpc` above: dependency-light and independently unit-testable. Every
 *  control channel besides `start` is a silent no-op for an unknown/already-finished run — see
 *  run-controller's `rsOf`. */
export function registerInvestigationRunIpc(deps: RegisterRunIpcDeps): void {
  // Capability probe: true once the reasoning pack is installed (getBrain() != null). No args, no
  // side effects — the Run panel probes this on mount to render its calm unavailable state.
  deps.handle(channels.investigation.run.available, (): boolean => deps.getBrain() != null);
  deps.handle(channels.investigation.run.start, (...args: unknown[]): string => {
    const caseId = deps.validateCaseId(args[0]);
    const seedIds = ensureStringArray(args[1], 200, 'seedId');
    const objective = ensureNonEmptyString(args[2], 2000, 'objective');
    const budget = ensureRunBudget(args[3]);
    const brain = deps.getBrain();
    if (!brain) throw new Error('OSINT investigator plugin not installed — free-form runs require the reasoning-model plugin.');
    // Return the runId immediately; the loop runs detached (events stream via sendEvent). Blocking
    // here would deadlock the ask/answer flow — the renderer needs the runId to send answers.
    const { runId } = startRun({
      caseId, seedIds, objective, budget, brain,
      deps: { emit: (rid, event) => deps.sendEvent({ runId: rid, event }), now: deps.now }
    });
    return runId;
  });
  deps.handle(channels.investigation.run.pause, (...args: unknown[]): void => {
    pauseRun(ensureNonEmptyString(args[0], 128, 'runId'));
  });
  deps.handle(channels.investigation.run.resume, (...args: unknown[]): void => {
    resumeRun(ensureNonEmptyString(args[0], 128, 'runId'));
  });
  deps.handle(channels.investigation.run.stop, (...args: unknown[]): void => {
    stopRun(ensureNonEmptyString(args[0], 128, 'runId'), ensureNonEmptyString(args[1], 500, 'reason'));
  });
  deps.handle(channels.investigation.run.addScope, (...args: unknown[]): void => {
    addScope(ensureNonEmptyString(args[0], 128, 'runId'), ensureNonEmptyString(args[1], 500, 'target'));
  });
  deps.handle(channels.investigation.run.removeScope, (...args: unknown[]): void => {
    removeScope(ensureNonEmptyString(args[0], 128, 'runId'), ensureNonEmptyString(args[1], 500, 'target'));
  });
  deps.handle(channels.investigation.run.focus, (...args: unknown[]): void => {
    focusEntity(ensureNonEmptyString(args[0], 128, 'runId'), ensureNonEmptyString(args[1], 200, 'entityId'));
  });
  deps.handle(channels.investigation.run.ignore, (...args: unknown[]): void => {
    ignoreEntity(ensureNonEmptyString(args[0], 128, 'runId'), ensureNonEmptyString(args[1], 200, 'entityId'));
  });
  deps.handle(channels.investigation.run.answer, (...args: unknown[]): void => {
    answerRun(ensureNonEmptyString(args[0], 128, 'runId'), ensureNonEmptyString(args[1], 5000, 'answer'));
  });
}
