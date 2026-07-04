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

/** True if this transform+entity pair has already been run — the dedup rail (the model must not
 *  re-pivot the same way). */
export function isDuplicate(g: GuardState, a: ProposedAction): boolean {
  return g.seen.has(`${a.transformId}:${a.entityId}`);
}

/** Record the total entity count observed at the end of a turn (for no-progress detection). */
export function recordProgress(g: GuardState, entityCount: number): void {
  g.progress.push(entityCount);
}

/** True when the last `window` recorded turns produced no new entities (all equal) — the stall
 *  signal for a free-form run. Needs at least `window` turns of history first. */
export function noProgress(g: GuardState, window: number): boolean {
  if (window <= 0 || g.progress.length < window) return false;
  const tail = g.progress.slice(-window);
  return tail.every((c) => c === tail[0]);
}

/** Authorized if the value equals an in-scope entry or is a subdomain of one (`x.evil.tld` for
 *  `evil.tld`). Never a lookalike (`evil.tld.attacker.com`). */
export function isAuthorized(scope: Set<string>, value: string): boolean {
  for (const s of scope) {
    if (value === s || value.endsWith(`.${s}`)) return true;
  }
  return false;
}

/** Human-set only: the orchestrator wires these to a human-gated control, never the agent path. */
export function addToScope(g: GuardState, target: string): void { g.scope.add(target); }
export function removeFromScope(g: GuardState, target: string): void { g.scope.delete(target); }
