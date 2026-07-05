import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EntityRecord } from '@shared/types';
import type { EvidenceRecord, Finding, InvestigationRun } from '@shared/investigation-types';
import type { InvestigationScene } from '@shared/investigation-graph';

// Mutable fixture holders read by the mock factories below. Each test sets these via `setup(...)`.
let entitiesFx: EntityRecord[] = [];
let evidenceFx: EvidenceRecord[] = [];
let findingsFx: Finding[] = [];
let runsFx: InvestigationRun[] = [];
let sceneFx: InvestigationScene = { nodes: [], edges: [] };

vi.mock('../src/main/storage/entities', () => ({
  async listAll() { return entitiesFx; }
}));
vi.mock('../src/main/investigation/ledger', () => ({
  async listEvidence(_caseId: string, runId?: string) {
    return runId ? evidenceFx.filter((e) => e.runId === runId) : evidenceFx;
  },
  async listFindings() { return findingsFx; },
  async getRun(_caseId: string, runId: string) { return runsFx.find((r) => r.id === runId); }
}));
vi.mock('../src/main/investigation/graph', () => ({
  async sceneForCase() { return sceneFx; }
}));

import {
  assembleReport,
  KEY_ACTOR_LIMIT,
  W_FINDING,
  W_DEGREE,
  W_THREAT,
  RELATION_LABELS,
  RELATION_PRIORITY,
  TYPE_LABELS
} from '../src/main/investigation/report';

// ---- fixture builders -------------------------------------------------------

function ent(id: string, type: EntityRecord['type'], value: string): EntityRecord {
  return { id, type, value, notes: '', aliases: [], createdAt: 'T', updatedAt: 'T' };
}
function ev(p: Partial<EvidenceRecord> & { id: string; inputEntityId: string }): EvidenceRecord {
  return {
    runId: 'run1', transformId: 'whois', transformVersion: '1',
    producedEntityIds: [], producedEdges: [], signals: [],
    rawRef: `raw/${p.id}.txt`, createdAt: '2020-01-01T00:00:00.000Z',
    ...p
  } as EvidenceRecord;
}
function run(id: string, over: Partial<InvestigationRun> = {}): InvestigationRun {
  return {
    id, caseId: 'cX', seedEntityIds: ['e1'], objective: `obj ${id}`,
    budget: { maxPivots: 3, maxDepth: 3, maxWallClockMs: 1000, maxTokens: 100 },
    status: 'done', actionLog: [{ seq: 0, kind: 'transform', at: 'T' }],
    createdAt: '2020-01-01T00:00:00.000Z', updatedAt: 'T', ...over
  };
}

function setup(f: {
  entities?: EntityRecord[]; evidence?: EvidenceRecord[]; findings?: Finding[];
  runs?: InvestigationRun[]; scene?: InvestigationScene;
}): void {
  entitiesFx = f.entities ?? [];
  evidenceFx = f.evidence ?? [];
  findingsFx = f.findings ?? [];
  runsFx = f.runs ?? [];
  sceneFx = f.scene ?? { nodes: [], edges: [] };
}

// A rich, deterministic case: 4 entities, 3 evidence records, 2 findings, 1 run.
function richCase() {
  const entities = [
    ent('e1', 'domain', 'evil.tld'),
    ent('e2', 'email', 'r@evil.tld'),
    ent('e3', 'ip', '1.2.3.4'),
    ent('e4', 'person', 'John Doe')
  ];
  const evidence: EvidenceRecord[] = [
    ev({ id: 'ev1', transformId: 'whois', transformVersion: '1', inputEntityId: 'e1', producedEntityIds: ['e2'],
      producedEdges: [{ fromValue: 'evil.tld', fromType: 'domain', toValue: 'r@evil.tld', toType: 'email', relation: 'registrant-of' }],
      signals: [{ kind: 'spam', weight: 2 }], createdAt: '2020-01-01T00:00:00.000Z' }),
    ev({ id: 'ev2', transformId: 'dns', transformVersion: '2', inputEntityId: 'e1', producedEntityIds: ['e3'],
      producedEdges: [{ fromValue: 'evil.tld', fromType: 'domain', toValue: '1.2.3.4', toType: 'ip', relation: 'resolves-to' }],
      signals: [{ kind: 'geo', weight: 1 }], createdAt: '2020-01-02T00:00:00.000Z' }),
    ev({ id: 'ev3', transformId: 'social', transformVersion: '1', inputEntityId: 'e2', producedEntityIds: ['e4'],
      producedEdges: [{ fromValue: 'r@evil.tld', fromType: 'email', toValue: 'John Doe', toType: 'person', relation: 'co-occurs-with' }],
      signals: [], createdAt: '2020-01-03T00:00:00.000Z' })
  ];
  const findings: Finding[] = [
    { id: 'f1', runId: 'run1', claim: 'evil.tld registered by r@evil.tld', evidenceIds: ['ev1'],
      confidence: { band: 'high', attribution: 'attributed', score: 0.9 }, createdAt: '2020-01-01T00:00:00.000Z' },
    { id: 'f2', runId: 'run1', claim: 'evil.tld resolves to 1.2.3.4', evidenceIds: ['ev2'],
      confidence: { band: 'medium', attribution: 'unconfirmed', score: 0.6 }, createdAt: '2020-01-02T00:00:00.000Z' }
  ];
  const scene: InvestigationScene = {
    nodes: [
      { id: 'e1', type: 'domain', value: 'evil.tld', cluster: 0, score: 0.9, x: 0, y: 0 },
      { id: 'e2', type: 'email', value: 'r@evil.tld', cluster: 0, score: 0.9, x: 0, y: 0 },
      { id: 'e3', type: 'ip', value: '1.2.3.4', cluster: 0, score: 0.6, x: 0, y: 0 },
      { id: 'e4', type: 'person', value: 'John Doe', cluster: 1, score: 0.3, x: 0, y: 0 }
    ],
    edges: [
      { source: 'e1', target: 'e2', relation: 'registrant-of', kind: 'relation' },
      { source: 'e1', target: 'e3', relation: 'resolves-to', kind: 'relation' },
      { source: 'e2', target: 'e4', relation: 'co-occurs', kind: 'cooccurrence' }
    ]
  };
  return { entities, evidence, findings, runs: [run('run1')], scene };
}

beforeEach(() => setup({}));

describe('assembleReport — constants', () => {
  it('exports the pinned weight constants and limit', () => {
    expect(W_FINDING).toBe(2);
    expect(W_DEGREE).toBe(1);
    expect(W_THREAT).toBe(1);
    expect(KEY_ACTOR_LIMIT).toBeGreaterThan(0);
  });
  it('relation label + priority + type label maps are pinned', () => {
    expect(RELATION_LABELS['registrant-of']).toBe('Registrant');
    expect(RELATION_LABELS['resolves-to']).toBe('Resolves to');
    expect(RELATION_LABELS['mx-of']).toBe('Mail server');
    expect(RELATION_LABELS['co-occurs-with']).toBe('Associate');
    expect(RELATION_PRIORITY.indexOf('registrant-of')).toBeLessThan(RELATION_PRIORITY.indexOf('resolves-to'));
    expect(RELATION_PRIORITY.indexOf('resolves-to')).toBeLessThan(RELATION_PRIORITY.indexOf('mx-of'));
    expect(RELATION_PRIORITY.indexOf('mx-of')).toBeLessThan(RELATION_PRIORITY.indexOf('co-occurs-with'));
    expect(TYPE_LABELS.domain).toBe('Domain');
    expect(TYPE_LABELS.email).toBe('Email address');
  });
});

describe('assembleReport — salience & ranking', () => {
  it('ranks by 2·bestFindingScore + degree + threatWeight', async () => {
    setup(richCase());
    const r = await assembleReport('cX');
    expect(r.keyActors.map((a) => a.entityId)).toEqual(['e1', 'e2', 'e3', 'e4']);
    const byId = Object.fromEntries(r.keyActors.map((a) => [a.entityId, a]));
    // e1: 2*0.9 + degree2 + threat(2+1)=3  => 6.8
    expect(byId.e1.salience).toBeCloseTo(6.8, 10);
    expect(byId.e1.degree).toBe(2);
    // e2: 2*0.9 + degree2 + threat2 => 5.8
    expect(byId.e2.salience).toBeCloseTo(5.8, 10);
    // e3: 2*0.6 + degree1 + threat1 => 3.2
    expect(byId.e3.salience).toBeCloseTo(3.2, 10);
    // e4: 2*0 + degree1 + threat0 => 1
    expect(byId.e4.salience).toBeCloseTo(1, 10);
  });

  it('tie-breaks equal salience by entityId ascending', async () => {
    const entities = [ent('eB', 'other', 'b'), ent('eA', 'other', 'a')];
    const evidence = [
      ev({ id: 'ev1', inputEntityId: 'eA', producedEntityIds: ['eA'], transformId: 't', signals: [] }),
      ev({ id: 'ev2', inputEntityId: 'eB', producedEntityIds: ['eB'], transformId: 't', signals: [] })
    ];
    const scene: InvestigationScene = { nodes: [
      { id: 'eA', type: 'other', value: 'a', cluster: 0, score: 0.3, x: 0, y: 0 },
      { id: 'eB', type: 'other', value: 'b', cluster: 0, score: 0.3, x: 0, y: 0 }
    ], edges: [] };
    setup({ entities, evidence, scene, runs: [run('run1')] });
    const r = await assembleReport('cX');
    expect(r.keyActors.map((a) => a.entityId)).toEqual(['eA', 'eB']);
    expect(r.keyActors[0].salience).toBe(r.keyActors[1].salience);
  });
});

describe('assembleReport — role derivation', () => {
  it('derives role from the producing-edge relation', async () => {
    setup(richCase());
    const r = await assembleReport('cX');
    const byId = Object.fromEntries(r.keyActors.map((a) => [a.entityId, a]));
    expect(byId.e2.role).toBe('Registrant');
    expect(byId.e3.role).toBe('Resolves to');
    expect(byId.e4.role).toBe('Associate');
  });

  it('falls back to the type label for a seed/manual entity with no producing edge', async () => {
    setup(richCase());
    const r = await assembleReport('cX');
    const e1 = r.keyActors.find((a) => a.entityId === 'e1')!;
    expect(e1.role).toBe('Domain'); // e1 is never the toValue of a producing edge
  });

  it('picks the highest-priority relation when an entity has multiple producers', async () => {
    const entities = [ent('e1', 'domain', 'seed.tld'), ent('e2', 'ip', '9.9.9.9')];
    const evidence = [
      ev({ id: 'evA', inputEntityId: 'e1', producedEntityIds: ['e2'], transformId: 'a',
        producedEdges: [{ fromValue: 'seed.tld', fromType: 'domain', toValue: '9.9.9.9', toType: 'ip', relation: 'mx-of' }] }),
      ev({ id: 'evB', inputEntityId: 'e1', producedEntityIds: ['e2'], transformId: 'b',
        producedEdges: [{ fromValue: 'seed.tld', fromType: 'domain', toValue: '9.9.9.9', toType: 'ip', relation: 'registrant-of' }] })
    ];
    const scene: InvestigationScene = { nodes: [
      { id: 'e1', type: 'domain', value: 'seed.tld', cluster: 0, score: 0.3, x: 0, y: 0 },
      { id: 'e2', type: 'ip', value: '9.9.9.9', cluster: 0, score: 0.3, x: 0, y: 0 }
    ], edges: [] };
    setup({ entities, evidence, scene, runs: [run('run1')] });
    const r = await assembleReport('cX');
    expect(r.keyActors.find((a) => a.entityId === 'e2')!.role).toBe('Registrant');
  });

  it('title-cases an unknown relation', async () => {
    const entities = [ent('e1', 'domain', 'seed.tld'), ent('e2', 'other', 'thing')];
    const evidence = [ev({ id: 'evA', inputEntityId: 'e1', producedEntityIds: ['e2'], transformId: 'a',
      producedEdges: [{ fromValue: 'seed.tld', fromType: 'domain', toValue: 'thing', toType: 'other', relation: 'foo-bar' }] })];
    const scene: InvestigationScene = { nodes: [
      { id: 'e1', type: 'domain', value: 'seed.tld', cluster: 0, score: 0.3, x: 0, y: 0 },
      { id: 'e2', type: 'other', value: 'thing', cluster: 0, score: 0.3, x: 0, y: 0 }
    ], edges: [] };
    setup({ entities, evidence, scene, runs: [run('run1')] });
    const r = await assembleReport('cX');
    expect(r.keyActors.find((a) => a.entityId === 'e2')!.role).toBe('Foo Bar');
  });
});

describe('assembleReport — confidence / attribution / findingBacked', () => {
  it('takes band + attribution from the highest-score referencing finding', async () => {
    setup(richCase());
    const r = await assembleReport('cX');
    const byId = Object.fromEntries(r.keyActors.map((a) => [a.entityId, a]));
    expect(byId.e1.confidence).toBe('high');
    expect(byId.e1.attribution).toBe('attributed');
    expect(byId.e1.findingBacked).toBe(true);
    expect(byId.e3.confidence).toBe('medium');
    expect(byId.e3.attribution).toBe('unconfirmed');
  });

  it('marks low/unattributed/findingBacked=false when no finding references the actor', async () => {
    setup(richCase());
    const r = await assembleReport('cX');
    const e4 = r.keyActors.find((a) => a.entityId === 'e4')!;
    expect(e4.confidence).toBe('low');
    expect(e4.attribution).toBe('unattributed');
    expect(e4.findingBacked).toBe(false);
    expect(e4.findingIds).toEqual([]);
  });

  it('actor↔finding membership is set logic over the findings’ evidence records', async () => {
    setup(richCase());
    const r = await assembleReport('cX');
    const byId = Object.fromEntries(r.keyActors.map((a) => [a.entityId, a]));
    expect(byId.e1.findingIds).toEqual(['f1', 'f2']); // input of ev1 and ev2
    expect(byId.e2.findingIds).toEqual(['f1']);       // produced by ev1
    expect(byId.e3.findingIds).toEqual(['f2']);       // produced by ev2
  });
});

describe('assembleReport — evidence chain', () => {
  it('collects every touching record with provenance fields, sorted createdAt then evidenceId', async () => {
    setup(richCase());
    const r = await assembleReport('cX');
    const e1 = r.keyActors.find((a) => a.entityId === 'e1')!;
    expect(e1.evidence.map((p) => p.evidenceId)).toEqual(['ev1', 'ev2']);
    expect(e1.evidence[0]).toMatchObject({
      evidenceId: 'ev1', transformId: 'whois', transformVersion: '1',
      createdAt: '2020-01-01T00:00:00.000Z', rawRef: 'raw/ev1.txt'
    });
    // ev1 did not *produce* e1 (e1 is the input), so no producing relation on this ref.
    expect(e1.evidence[0].relation).toBeUndefined();
    // e2 was produced by ev1 via registrant-of → relation carried on the ref.
    const e2 = r.keyActors.find((a) => a.entityId === 'e2')!;
    expect(e2.evidence.find((p) => p.evidenceId === 'ev1')!.relation).toBe('registrant-of');
  });
});

describe('assembleReport — findings section', () => {
  it('lists findings score desc then id asc, with resolved evidence refs', async () => {
    setup(richCase());
    const r = await assembleReport('cX');
    expect(r.findings.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(r.findings[0].confidence).toEqual({ band: 'high', attribution: 'attributed', score: 0.9 });
    expect(r.findings[0].evidence.map((p) => p.evidenceId)).toEqual(['ev1']);
    expect(r.findingCount).toBe(2);
  });
});

describe('assembleReport — methodology', () => {
  it('one entry per in-scope run with transformsUsed distinct+sorted', async () => {
    setup(richCase());
    const r = await assembleReport('cX');
    expect(r.methodology).toHaveLength(1);
    expect(r.methodology[0]).toMatchObject({ runId: 'run1', objective: 'obj run1', status: 'done', actionCount: 1 });
    expect(r.methodology[0].transformsUsed).toEqual(['dns', 'social', 'whois']);
  });
});

describe('assembleReport — scope & truncation', () => {
  it('runId filter narrows findings/actors vs the case aggregate', async () => {
    const base = richCase();
    const entities = [...base.entities, ent('e5', 'username', 'ghost')];
    const evidence = [
      ...base.evidence,
      ev({ id: 'ev9', runId: 'run2', inputEntityId: 'e5', producedEntityIds: ['e5'], transformId: 'x', signals: [] })
    ];
    const findings = [
      ...base.findings,
      { id: 'f9', runId: 'run2', claim: 'other run finding', evidenceIds: ['ev9'],
        confidence: { band: 'low', attribution: 'unattributed', score: 0.3 }, createdAt: '2020-02-01T00:00:00.000Z' } as Finding
    ];
    const scene: InvestigationScene = {
      nodes: [...base.scene.nodes, { id: 'e5', type: 'username', value: 'ghost', cluster: 2, score: 0.3, x: 0, y: 0 }],
      edges: base.scene.edges
    };
    setup({ entities, evidence, findings, runs: [run('run1'), run('run2')], scene });

    const caseR = await assembleReport('cX');
    expect(caseR.scope).toBe('case');
    expect(caseR.keyActors.map((a) => a.entityId)).toContain('e5');
    expect(caseR.findingCount).toBe(3);
    expect(caseR.methodology.map((m) => m.runId).sort()).toEqual(['run1', 'run2']);

    const runR = await assembleReport('cX', { runId: 'run1' });
    expect(runR.scope).toBe('run');
    expect(runR.runId).toBe('run1');
    expect(runR.keyActors.map((a) => a.entityId)).not.toContain('e5');
    expect(runR.findingCount).toBe(2);
    expect(runR.methodology.map((m) => m.runId)).toEqual(['run1']);
  });

  it('honestly records actorTail when key actors exceed KEY_ACTOR_LIMIT', async () => {
    const n = KEY_ACTOR_LIMIT + 5;
    const entities: EntityRecord[] = [];
    const evidence: EvidenceRecord[] = [];
    const nodes = [];
    for (let i = 0; i < n; i++) {
      const id = `k${String(i).padStart(3, '0')}`;
      entities.push(ent(id, 'other', `v${i}`));
      evidence.push(ev({ id: `e_${id}`, inputEntityId: id, producedEntityIds: [id], transformId: 't', signals: [{ kind: 's', weight: i }] }));
      nodes.push({ id, type: 'other' as const, value: `v${i}`, cluster: 0, score: 0.3, x: 0, y: 0 });
    }
    setup({ entities, evidence, scene: { nodes, edges: [] }, runs: [run('run1')] });
    const r = await assembleReport('cX');
    expect(r.keyActors).toHaveLength(KEY_ACTOR_LIMIT);
    expect(r.actorTail).toEqual({ shown: KEY_ACTOR_LIMIT, total: n });
    expect(r.entityCount).toBe(n);
  });
});

describe('assembleReport — determinism & generatedAt', () => {
  it('assemble-twice is deep-equal', async () => {
    setup(richCase());
    const a = await assembleReport('cX', { now: () => 1234567890000 });
    setup(richCase());
    const b = await assembleReport('cX', { now: () => 1234567890000 });
    expect(a).toEqual(b);
  });

  it('generatedAt comes from the injected now (no wall clock)', async () => {
    setup(richCase());
    const r = await assembleReport('cX', { now: () => 0 });
    expect(r.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    setup(richCase());
    const r2 = await assembleReport('cX', { now: () => 1234567890000 });
    expect(r2.generatedAt).toBe('2009-02-13T23:31:30.000Z');
  });
});
