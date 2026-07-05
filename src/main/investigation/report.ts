// SP-7 INTELREPORT — deterministic assembler.
//
// `assembleReport(caseId, opts?)` turns the evidence a run (SP-6) accumulates into the ledger
// (SP-2) into the fact model of a court-defensible report: a salience-ranked key-actors table
// (who/role/confidence/evidence chain), a findings list, and a per-run methodology appendix.
//
// CHARTER — DETERMINISM: this module NEVER calls an LLM, and it is a critical path. No
// `Date.now()`, no `Math.random()`, no argless `new Date()`. Time enters only through the injected
// `now: () => number`; `new Date(now()).toISOString()` is the sole allowed conversion (the storage
// boundary). Every sort has an explicit tie-break so the same case + ledger yields a byte-identical
// model.
import { listAll } from '../storage/entities';
import { listEvidence, listFindings, getRun } from './ledger';
import { sceneForCase } from './graph';
import type { EntityRecord } from '@shared/types';
import type { EvidenceRecord, Finding } from '@shared/investigation-types';
import type {
  IntelReport,
  KeyActor,
  ProvenanceRef,
  ReportFinding,
  MethodologyEntry
} from '@shared/investigation-report';
import type { EntityType } from '@shared/types';

// ---- Pinned machine parameters (documented + exported so tests/reviewer can pin them). ----

/** Salience weights: salience = W_FINDING·bestFindingScore + W_DEGREE·degree + W_THREAT·threatWeight. */
export const W_FINDING = 2;
export const W_DEGREE = 1;
export const W_THREAT = 1;

/** Top-N key actors shown in the table; the remainder is recorded honestly in `actorTail` (charter:
 *  no silent cap — the HTML renders a truncation footer whenever shown < total). */
export const KEY_ACTOR_LIMIT = 25;

/** Producing-edge relation → human role label. Unknown relations are title-cased (see `titleCase`). */
export const RELATION_LABELS: Record<string, string> = {
  'registrant-of': 'Registrant',
  'owner-of': 'Owner',
  'operates': 'Operator',
  'resolves-to': 'Resolves to',
  'mx-of': 'Mail server',
  'co-occurs-with': 'Associate',
  'co-occurs': 'Associate'
};

/** When an entity has multiple producing relations, the highest-priority one (lowest index) wins;
 *  ties break lexically. Relations absent from this list rank below every listed relation. */
export const RELATION_PRIORITY: readonly string[] = [
  'registrant-of',
  'owner-of',
  'operates',
  'resolves-to',
  'mx-of',
  'co-occurs-with'
];

/** Entity type → role label, used when an actor has no producing edge (seed or manual entity). */
export const TYPE_LABELS: Record<EntityType, string> = {
  person: 'Person',
  alias: 'Alias',
  email: 'Email address',
  phone: 'Phone number',
  domain: 'Domain',
  ip: 'IP address',
  organisation: 'Organisation',
  'social-profile': 'Social profile',
  vehicle: 'Vehicle',
  location: 'Location',
  'crypto-wallet': 'Crypto wallet',
  other: 'Other',
  url: 'URL',
  hostname: 'Hostname',
  asn: 'ASN',
  certificate: 'Certificate',
  username: 'Username',
  'file-hash': 'File hash'
};

/** Title-case an unknown relation/type token: split on `-`/`_`/whitespace, capitalise each word. */
function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Rank a relation for priority selection: [priorityIndex, relation] — lower wins. Relations not in
 *  RELATION_PRIORITY get index === list length (below all listed), then break ties lexically. */
function relationRank(relation: string): [number, string] {
  const idx = RELATION_PRIORITY.indexOf(relation);
  return [idx < 0 ? RELATION_PRIORITY.length : idx, relation];
}

/** Pick the highest-priority relation among a set (or undefined if empty). */
function pickRelation(relations: string[]): string | undefined {
  let best: string | undefined;
  let bestRank: [number, string] | undefined;
  for (const rel of relations) {
    const rank = relationRank(rel);
    if (!bestRank || rank[0] < bestRank[0] || (rank[0] === bestRank[0] && rank[1] < bestRank[1])) {
      best = rel;
      bestRank = rank;
    }
  }
  return best;
}

function relationLabel(relation: string): string {
  return RELATION_LABELS[relation] ?? titleCase(relation);
}

export interface AssembleOptions {
  runId?: string;
  now?: () => number;
}

export async function assembleReport(caseId: string, opts: AssembleOptions = {}): Promise<IntelReport> {
  const runId = opts.runId;
  const now = opts.now ?? (() => 0);

  const [entities, evidence, allFindings, scene] = await Promise.all([
    listAll(),
    listEvidence(caseId, runId),
    listFindings(caseId),
    sceneForCase(caseId)
  ]);

  // Run scope narrows findings by runId; case scope keeps them all.
  const findings = runId ? allFindings.filter((f) => f.runId === runId) : allFindings;

  const entityById = new Map<string, EntityRecord>(entities.map((e) => [e.id, e]));
  const evidenceById = new Map<string, EvidenceRecord>(evidence.map((e) => [e.id, e]));

  // Candidate entity set = registry entities referenced by the in-scope evidence (mirrors the
  // scene's node set). This is the honest denominator for key actors.
  const candidateIds = new Set<string>();
  for (const ev of evidence) {
    if (entityById.has(ev.inputEntityId)) candidateIds.add(ev.inputEntityId);
    for (const p of ev.producedEntityIds) if (entityById.has(p)) candidateIds.add(p);
  }

  // Evidence records touching an entity (input OR produced), for threat + evidence chain.
  const evidenceTouching = (entityId: string): EvidenceRecord[] =>
    evidence.filter((ev) => ev.inputEntityId === entityId || ev.producedEntityIds.includes(entityId));

  // Graph degree from the (case-wide) scene: edges incident to the entity.
  const degreeOf = new Map<string, number>();
  for (const e of scene.edges) {
    degreeOf.set(e.source, (degreeOf.get(e.source) ?? 0) + 1);
    degreeOf.set(e.target, (degreeOf.get(e.target) ?? 0) + 1);
  }
  const clusterById = new Map<string, number>(scene.nodes.map((n) => [n.id, n.cluster]));

  // Actor ↔ finding membership: finding F references entity E iff E appears as input or produced
  // in any in-scope evidence record listed in F.evidenceIds.
  const findingsByEntity = new Map<string, Finding[]>();
  for (const f of findings) {
    const touched = new Set<string>();
    for (const eid of f.evidenceIds) {
      const rec = evidenceById.get(eid);
      if (!rec) continue;
      if (candidateIds.has(rec.inputEntityId)) touched.add(rec.inputEntityId);
      for (const p of rec.producedEntityIds) if (candidateIds.has(p)) touched.add(p);
    }
    for (const id of touched) {
      const list = findingsByEntity.get(id) ?? [];
      list.push(f);
      findingsByEntity.set(id, list);
    }
  }

  const keyActorsAll: KeyActor[] = [];
  for (const entityId of candidateIds) {
    const entity = entityById.get(entityId)!;
    const touching = evidenceTouching(entityId);

    // Producing edges: records that produced this entity, with an edge whose toValue/toType match.
    const producingRelations: string[] = [];
    for (const ev of touching) {
      if (!ev.producedEntityIds.includes(entityId)) continue;
      for (const edge of ev.producedEdges) {
        if (edge.toValue === entity.value && edge.toType === entity.type) producingRelations.push(edge.relation);
      }
    }
    const chosenRelation = pickRelation(producingRelations);
    const role = chosenRelation ? relationLabel(chosenRelation) : TYPE_LABELS[entity.type] ?? titleCase(entity.type);

    // Threat weight: Σ signal weights over the entity's touching evidence.
    let threatWeight = 0;
    for (const ev of touching) for (const s of ev.signals) threatWeight += s.weight;

    const degree = degreeOf.get(entityId) ?? 0;

    // Best-referencing finding: highest score wins (tie-break id asc for a stable pick).
    const refs = (findingsByEntity.get(entityId) ?? []).slice().sort((a, b) =>
      b.confidence.score - a.confidence.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
    const best = refs[0];
    const bestFindingScore = best ? best.confidence.score : 0;
    const findingBacked = best !== undefined;

    const salience = W_FINDING * bestFindingScore + W_DEGREE * degree + W_THREAT * threatWeight;

    // Evidence chain: every touching record, sorted createdAt asc then evidenceId asc.
    const evidenceRefs: ProvenanceRef[] = touching
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((ev) => {
        // Producing relation on this specific record, if it produced the actor.
        const recRelations: string[] = ev.producedEntityIds.includes(entityId)
          ? ev.producedEdges.filter((e) => e.toValue === entity.value && e.toType === entity.type).map((e) => e.relation)
          : [];
        const rel = pickRelation(recRelations);
        const ref: ProvenanceRef = {
          evidenceId: ev.id,
          transformId: ev.transformId,
          transformVersion: ev.transformVersion,
          createdAt: ev.createdAt,
          rawRef: ev.rawRef
        };
        if (rel !== undefined) ref.relation = rel;
        return ref;
      });

    keyActorsAll.push({
      entityId,
      type: entity.type,
      value: entity.value,
      role,
      cluster: clusterById.get(entityId) ?? 0,
      salience,
      degree,
      confidence: best ? best.confidence.band : 'low',
      attribution: best ? best.confidence.attribution : 'unattributed',
      findingBacked,
      evidence: evidenceRefs,
      findingIds: (findingsByEntity.get(entityId) ?? []).map((f) => f.id).slice().sort()
    });
  }

  // Salience desc, tie-break entityId asc.
  keyActorsAll.sort((a, b) => b.salience - a.salience || (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
  const total = keyActorsAll.length;
  const keyActors = keyActorsAll.slice(0, KEY_ACTOR_LIMIT);

  // Findings section: score desc, id asc; evidence resolved from evidenceIds.
  const reportFindings: ReportFinding[] = findings
    .slice()
    .sort((a, b) => b.confidence.score - a.confidence.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((f) => {
      const refs: ProvenanceRef[] = f.evidenceIds
        .map((eid) => evidenceById.get(eid))
        .filter((r): r is EvidenceRecord => r !== undefined)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((ev) => ({
          evidenceId: ev.id,
          transformId: ev.transformId,
          transformVersion: ev.transformVersion,
          createdAt: ev.createdAt,
          rawRef: ev.rawRef
        }));
      return { id: f.id, claim: f.claim, confidence: f.confidence, evidence: refs, createdAt: f.createdAt };
    });

  const methodology = await buildMethodology(caseId, runId, evidence);

  return {
    caseId,
    ...(runId ? { runId } : {}),
    scope: runId ? 'run' : 'case',
    generatedAt: new Date(now()).toISOString(),
    entityCount: total,
    findingCount: findings.length,
    keyActors,
    actorTail: { shown: keyActors.length, total },
    findings: reportFindings,
    methodology
  };
}

/** One MethodologyEntry per in-scope run. Run set = the filter `runId` when run-scoped, else the
 *  distinct `runId`s across the in-scope evidence (no `listRuns` API exists). Pseudo-runs (e.g.
 *  `manual`) that have no InvestigationRun record are skipped — they carry no objective/budget. */
async function buildMethodology(
  caseId: string,
  runId: string | undefined,
  evidence: EvidenceRecord[]
): Promise<MethodologyEntry[]> {
  const runIds = runId ? [runId] : [...new Set(evidence.map((e) => e.runId))];

  const transformsByRun = new Map<string, Set<string>>();
  for (const ev of evidence) {
    const set = transformsByRun.get(ev.runId) ?? new Set<string>();
    set.add(ev.transformId);
    transformsByRun.set(ev.runId, set);
  }

  const entries: MethodologyEntry[] = [];
  for (const rid of runIds) {
    const run = await getRun(caseId, rid);
    if (!run) continue; // pseudo/absent run — no methodology to report
    const entry: MethodologyEntry = {
      runId: rid,
      objective: run.objective,
      budget: run.budget,
      status: run.status,
      actionCount: run.actionLog.length,
      transformsUsed: [...(transformsByRun.get(rid) ?? new Set<string>())].sort(),
      createdAt: run.createdAt
    };
    if (run.stopReason !== undefined) entry.stopReason = run.stopReason;
    entries.push(entry);
  }

  // Stable order: createdAt asc, tie-break runId asc.
  entries.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
  return entries;
}
