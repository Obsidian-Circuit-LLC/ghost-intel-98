import type { RunBudget } from '@shared/investigation-types';

export interface ProposedAction {
  transformId: string;
  transformActive: boolean;
  entityId: string;
  entityValue: string;
  depth: number;
  estTokens: number;
}
export type DenyReason =
  | 'stopped' | 'paused'
  | 'budget-pivots' | 'budget-depth' | 'budget-wallclock' | 'budget-tokens'
  | 'duplicate' | 'not-authorized-target';
export type GuardDecision = { allow: true } | { allow: false; reason: DenyReason };

export interface GuardState {
  budget: RunBudget;
  startedAt: number;
  spentPivots: number;
  spentTokens: number;
  seen: Set<string>;       // `${transformId}:${entityId}` — dedup (Task 2)
  scope: Set<string>;      // authorized targets (Task 3)
  paused: boolean;
  stopped: boolean;
  stopReason: string | null;
  progress: number[];      // entity-count history for no-progress (Task 2)
}

export function createGuard(budget: RunBudget, startedAt: number): GuardState {
  return { budget, startedAt, spentPivots: 0, spentTokens: 0, seen: new Set(), scope: new Set(), paused: false, stopped: false, stopReason: null, progress: [] };
}

export function pause(g: GuardState): void { g.paused = true; }
export function resume(g: GuardState): void { g.paused = false; }
export function stop(g: GuardState, reason: string): void { g.stopped = true; g.stopReason = reason; }

/** Budget-only check. Returns the DenyReason or null if within budget. `now` is caller-supplied
 *  (ms epoch) — the ONLY time source, so the guard stays deterministic. */
export function checkBudget(g: GuardState, a: ProposedAction, now: number): DenyReason | null {
  if (now - g.startedAt >= g.budget.maxWallClockMs) return 'budget-wallclock';
  if (g.spentPivots >= g.budget.maxPivots) return 'budget-pivots';
  if (a.depth > g.budget.maxDepth) return 'budget-depth';
  if (g.spentTokens + a.estTokens > g.budget.maxTokens) return 'budget-tokens';
  return null;
}

/** Record an action that was ALLOWED and executed: accrue pivots/tokens and mark it seen (dedup). */
export function recordAction(g: GuardState, a: ProposedAction, actualTokens: number): void {
  g.spentPivots += 1;
  g.spentTokens += actualTokens;
  g.seen.add(`${a.transformId}:${a.entityId}`);
}
