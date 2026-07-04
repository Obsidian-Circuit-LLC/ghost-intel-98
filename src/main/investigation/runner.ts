import { getTransform } from './registry';
import { appendEvidence } from './ledger';
import { scoreConfidence } from './confidence';
import * as entities from '../storage/entities';
import type { TransformInput, EvidenceRecord, ConfidenceResult } from '@shared/investigation-types';

export interface RunTransformResult {
  evidence: EvidenceRecord;
  producedEntityIds: string[];
  confidence: ConfidenceResult;
}

/** Invoke a registered transform on one input entity, merge its produced entities into the cross-case
 *  registry (dedup by type+value), write an append-only evidence record with the raw output, and compute
 *  machine-derived confidence. `now` is caller-supplied for determinism. No agent, no scope logic here —
 *  this is the "transforms callable directly" runner that proves the SP-2 contract. */
export async function runTransform(
  caseId: string, runId: string, transformId: string, input: TransformInput, now: string
): Promise<RunTransformResult> {
  const t = getTransform(transformId);
  if (!t) throw new Error(`Unknown transform: ${transformId}`);
  const out = await t.run(input);

  // Merge produced entities into the cross-case registry (simple type+value dedup; canonicalization is a
  // later refinement in SP-3 when real transforms emit noisy values).
  const all = await entities.listAll();
  const byKey = new Map(all.map((r) => [`${r.type} ${r.value}`, r.id]));
  const producedEntityIds: string[] = [];
  for (const e of out.entities) {
    const key = `${e.type} ${e.value}`;
    let id = byKey.get(key);
    if (!id) { const rec = await entities.create({ type: e.type, value: e.value }); id = rec.id; byKey.set(key, id); }
    producedEntityIds.push(id);
  }

  const evidence = await appendEvidence(caseId, {
    runId, transformId: t.id, transformVersion: t.version, inputEntityId: input.entityId,
    producedEntityIds, producedEdges: out.edges, signals: out.signals,
  }, out.raw, now);

  return { evidence, producedEntityIds, confidence: scoreConfidence(out.signals) };
}
