import { describe, it, expect } from 'vitest';
import { buildInvestigationScene } from '../src/main/investigation/scene';
import type { EntityRecord } from '../src/shared/types';
import type { EvidenceRecord, Finding } from '../src/shared/investigation-types';

const ent = (id: string, type: string, value: string): EntityRecord =>
  ({ id, type: type as never, value, notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' });
const ev = (id: string, input: string, produced: string[], edges: EvidenceRecord['producedEdges']): EvidenceRecord =>
  ({ id, runId: 'r', transformId: 't', transformVersion: '1', inputEntityId: input, producedEntityIds: produced, producedEdges: edges, signals: [], rawRef: '', createdAt: 'T' });

describe('buildInvestigationScene (pure projection)', () => {
  const entities = [ent('e1', 'domain', 'evil.tld'), ent('e2', 'email', 'reg@evil.tld'), ent('e3', 'ip', '1.2.3.4')];
  const evidence = [
    ev('ev1', 'e1', ['e2'], [{ fromValue: 'evil.tld', fromType: 'domain', toValue: 'reg@evil.tld', toType: 'email', relation: 'registrant-of' }]),
    ev('ev2', 'e1', ['e3'], [{ fromValue: 'evil.tld', fromType: 'domain', toValue: '1.2.3.4', toType: 'ip', relation: 'resolves-to' }]),
  ];
  const findings: Finding[] = [{ id: 'f1', runId: 'r', claim: 'x', evidenceIds: ['ev1'], confidence: { band: 'high', attribution: 'attributed', score: 4 }, createdAt: 'T' }];

  it('nodes are the entities referenced by the ledger', () => {
    const s = buildInvestigationScene({ entities, evidence, findings });
    expect(s.nodes.map((n) => n.id).sort()).toEqual(['e1', 'e2', 'e3']);
  });
  it('resolves producedEdges (value/type → id) as relation edges', () => {
    const s = buildInvestigationScene({ entities, evidence, findings });
    const rel = s.edges.filter((e) => e.kind === 'relation');
    expect(rel).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'e1', target: 'e2', relation: 'registrant-of' }),
      expect.objectContaining({ source: 'e1', target: 'e3', relation: 'resolves-to' }),
    ]));
  });
  it('everything reachable ends up in one cluster; a finding lifts its node score', () => {
    const s = buildInvestigationScene({ entities, evidence, findings });
    expect(new Set(s.nodes.map((n) => n.cluster)).size).toBe(1);
    expect(s.nodes.find((n) => n.id === 'e2')!.score).toBe(1); // high-band finding via ev1
  });
  it('is deterministic and finite', () => {
    const a = buildInvestigationScene({ entities, evidence, findings });
    const b = buildInvestigationScene({ entities, evidence, findings });
    expect(a).toEqual(b);
    expect(a.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });
});
