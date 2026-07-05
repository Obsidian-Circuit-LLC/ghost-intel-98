import { sceneForCase } from './graph';
import { listFindings } from './ledger';
import { listTransforms } from './registry';
import type { GuardState } from './guard';
import type { AgentContext, AgentEntity } from '@shared/investigation-agent';
import type { InvNode } from '@shared/investigation-graph';

const TOP_K = 12;
const RECENT_FINDINGS = 10;

export interface PerceiveInput {
  caseId: string; objective: string; guard: GuardState; now: number;
  seedIds: string[]; depth: Map<string, number>; expanded: Set<string>;
  focus: Set<string>; ignore: Set<string>; humanInput: string | null; lastError: string | null;
}

function toEntity(n: InvNode, depth: Map<string, number>): AgentEntity {
  return { entityId: n.id, type: n.type, value: n.value, score: n.score, depth: depth.get(n.id) ?? 0 };
}

export async function assembleContext(input: PerceiveInput): Promise<AgentContext> {
  const [scene, findings] = await Promise.all([sceneForCase(input.caseId), listFindings(input.caseId)]);
  // Rank: focused first, ignored excluded, then score desc, then id for stable determinism.
  const visible = scene.nodes.filter((n) => !input.ignore.has(n.id));
  const rank = (a: InvNode, b: InvNode): number => {
    const fa = input.focus.has(a.id) ? 1 : 0, fb = input.focus.has(b.id) ? 1 : 0;
    if (fa !== fb) return fb - fa;
    if (a.score !== b.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  };
  const ranked = [...visible].sort(rank);
  const keyEntities = ranked.slice(0, TOP_K).map((n) => toEntity(n, input.depth));
  const frontier = ranked.filter((n) => !input.expanded.has(n.id)).slice(0, TOP_K).map((n) => toEntity(n, input.depth));
  const seeds = scene.nodes.filter((n) => input.seedIds.includes(n.id)).map((n) => toEntity(n, input.depth));

  const g = input.guard;
  return {
    objective: input.objective,
    seeds,
    keyEntities,
    frontier,
    recentFindings: findings.slice(-RECENT_FINDINGS).map((f) => f.claim),
    budget: {
      pivotsLeft: Math.max(0, g.budget.maxPivots - g.spentPivots),
      depthMax: g.budget.maxDepth,
      wallClockMsLeft: Math.max(0, g.budget.maxWallClockMs - (input.now - g.startedAt)),
      tokensLeft: Math.max(0, g.budget.maxTokens - g.spentTokens),
    },
    transforms: listTransforms().map((t) => ({ id: t.id, title: t.title, inputTypes: t.inputTypes, active: t.active })),
    humanInput: input.humanInput,
    lastError: input.lastError,
  };
}
