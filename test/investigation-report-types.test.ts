import { describe, it, expect } from 'vitest';
import type {
  ProvenanceRef,
  KeyActor,
  ReportFinding,
  MethodologyEntry,
  NarrativeSections,
  IntelReport,
  Narrator,
} from '../src/shared/investigation-report';

describe('investigation-report model shapes', () => {
  it('constructs a minimal IntelReport literal with all required fields', () => {
    const provenance: ProvenanceRef = {
      evidenceId: 'ev1',
      transformId: 'whois',
      transformVersion: '1',
      createdAt: '2026-07-05T00:00:00.000Z',
      rawRef: 'blob://enc/ev1',
      relation: 'registrant-of',
    };

    const actor: KeyActor = {
      entityId: 'e1',
      type: 'domain',
      value: 'evil.tld',
      role: 'Registrant',
      cluster: 0,
      salience: 3,
      degree: 1,
      confidence: 'high',
      attribution: 'attributed',
      findingBacked: true,
      evidence: [provenance],
      findingIds: ['f1'],
    };

    const finding: ReportFinding = {
      id: 'f1',
      claim: 'evil.tld registered by John Doe',
      confidence: { band: 'high', attribution: 'attributed', score: 0.9 },
      evidence: [provenance],
      createdAt: '2026-07-05T00:00:00.000Z',
    };

    const methodology: MethodologyEntry = {
      runId: 'r1',
      objective: 'map evil.tld',
      budget: { maxPivots: 3, maxDepth: 3, maxWallClockMs: 1000, maxTokens: 100 },
      status: 'done',
      stopReason: 'budget',
      actionCount: 4,
      transformsUsed: ['whois'],
      createdAt: '2026-07-05T00:00:00.000Z',
    };

    const narrative: NarrativeSections = {
      summary: 'Investigation of case c1',
      source: 'template',
    };

    const report: IntelReport = {
      caseId: 'c1',
      scope: 'case',
      generatedAt: '2026-07-05T00:00:00.000Z',
      entityCount: 1,
      findingCount: 1,
      keyActors: [actor],
      actorTail: { shown: 1, total: 1 },
      findings: [finding],
      methodology: [methodology],
      narrative,
    };

    expect(report.scope).toBe('case');
    expect(report.keyActors).toHaveLength(1);
    expect(report.actorTail).toEqual({ shown: 1, total: 1 });
    expect(report.narrative?.source).toBe('template');
    expect(report.keyActors[0].evidence[0].relation).toBe('registrant-of');
  });

  it('allows a run-scoped report and a model-sourced narrative', () => {
    const narrative: NarrativeSections = {
      summary: 'model prose',
      perActor: { e1: 'per-actor prose' },
      source: 'model',
      model: 'reasoner-v1',
    };
    const report: IntelReport = {
      caseId: 'c1',
      runId: 'r1',
      scope: 'run',
      generatedAt: '2026-07-05T00:00:00.000Z',
      entityCount: 0,
      findingCount: 0,
      keyActors: [],
      actorTail: { shown: 0, total: 0 },
      findings: [],
      methodology: [],
      narrative,
    };
    expect(report.scope).toBe('run');
    expect(report.runId).toBe('r1');
    expect(report.narrative?.source).toBe('model');
    expect(report.narrative?.model).toBe('reasoner-v1');
  });

  it('accepts a Narrator implementation returning NarrativeSections', async () => {
    const narrator: Narrator = {
      async narrate(): Promise<NarrativeSections> {
        return { summary: 's', source: 'template' };
      },
    };
    const out = await narrator.narrate({
      caseId: 'c1',
      scope: 'case',
      generatedAt: '2026-07-05T00:00:00.000Z',
      entityCount: 0,
      findingCount: 0,
      keyActors: [],
      actorTail: { shown: 0, total: 0 },
      findings: [],
      methodology: [],
    });
    expect(out.source).toBe('template');
  });
});
