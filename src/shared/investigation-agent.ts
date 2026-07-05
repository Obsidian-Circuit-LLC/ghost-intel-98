import type { EntityType } from './types';

export interface AgentEntity { entityId: string; type: EntityType; value: string; score: number; depth: number }
export interface AgentContext {
  objective: string;
  seeds: AgentEntity[];
  keyEntities: AgentEntity[];
  frontier: AgentEntity[];
  recentFindings: string[];
  budget: { pivotsLeft: number; depthMax: number; wallClockMsLeft: number; tokensLeft: number };
  transforms: { id: string; title: string; inputTypes: EntityType[]; active: boolean }[];
  humanInput: string | null;
  lastError: string | null;
}
export type AgentAction =
  | { kind: 'run-transform'; transformId: string; entityId: string; reasoning?: string }
  | { kind: 'ask'; question: string }
  | { kind: 'done'; reason: string };
export interface Brain { decide(ctx: AgentContext): Promise<AgentAction> }
export type RunEvent =
  | { kind: 'thinking'; text: string }
  | { kind: 'action'; transformId: string; entityValue: string }
  | { kind: 'observed'; newEntities: number }
  | { kind: 'blocked'; reason: string }
  | { kind: 'ask'; question: string }
  | { kind: 'paused' } | { kind: 'resumed' }
  | { kind: 'stopped'; reason: string } | { kind: 'done'; reason: string };
