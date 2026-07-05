import { describe, it, expect } from 'vitest';
import type {
  IntelReport,
  KeyActor,
  ReportFinding,
  NarrativeSections,
  Narrator
} from '@shared/investigation-report';
import { TemplateNarrator, applyNarrative } from '../src/main/investigation/narrator';

// ---- fixture builders -------------------------------------------------------

function actor(over: Partial<KeyActor> & { entityId: string; value: string }): KeyActor {
  return {
    type: 'domain',
    role: 'Domain',
    cluster: 0,
    salience: 1,
    degree: 0,
    confidence: 'low',
    attribution: 'unattributed',
    findingBacked: false,
    evidence: [],
    findingIds: [],
    ...over
  };
}

function finding(over: Partial<ReportFinding> & { id: string; claim: string }): ReportFinding {
  return {
    confidence: { band: 'low', attribution: 'unattributed', score: 0.3 },
    evidence: [],
    createdAt: '2020-01-01T00:00:00.000Z',
    ...over
  };
}

function report(over: Partial<IntelReport> = {}): IntelReport {
  const keyActors = over.keyActors ?? [
    actor({ entityId: 'e1', value: 'evil.tld', role: 'Domain', confidence: 'high', attribution: 'attributed', salience: 6.8 }),
    actor({ entityId: 'e2', value: 'r@evil.tld', role: 'Registrant', confidence: 'medium', attribution: 'unconfirmed', salience: 5.8 }),
    actor({ entityId: 'e3', value: '1.2.3.4', role: 'Resolves to', confidence: 'low', attribution: 'unattributed', salience: 3.2 })
  ];
  const findings = over.findings ?? [
    finding({ id: 'f1', claim: 'evil.tld registered by r@evil.tld', confidence: { band: 'high', attribution: 'attributed', score: 0.9 } }),
    finding({ id: 'f2', claim: 'evil.tld resolves to 1.2.3.4', confidence: { band: 'medium', attribution: 'unconfirmed', score: 0.6 } })
  ];
  return {
    caseId: 'case-abc',
    scope: 'case',
    generatedAt: '1970-01-01T00:00:00.000Z',
    entityCount: keyActors.length,
    findingCount: findings.length,
    keyActors,
    actorTail: { shown: keyActors.length, total: keyActors.length },
    findings,
    methodology: [],
    ...over
  };
}

// ---- TemplateNarrator -------------------------------------------------------

describe('TemplateNarrator', () => {
  it('stamps source: template', async () => {
    const n = await new TemplateNarrator().narrate(report());
    expect(n.source).toBe('template');
    expect(n.model).toBeUndefined();
  });

  it('is deterministic — narrating twice is deep-equal', async () => {
    const r = report();
    const a = await new TemplateNarrator().narrate(r);
    const b = await new TemplateNarrator().narrate(r);
    expect(a).toEqual(b);
  });

  it('restates the entity + finding counts verbatim (no invented numbers)', async () => {
    const r = report({ entityCount: 3, findingCount: 2 });
    const { summary } = await new TemplateNarrator().narrate(r);
    expect(summary).toContain('3 entities');
    expect(summary).toContain('2 findings');
    expect(summary).toContain('case-abc');
  });

  it('restates top actors (value + role + confidence/attribution) from the model', async () => {
    const { summary } = await new TemplateNarrator().narrate(report());
    expect(summary).toContain('evil.tld (Domain, high/attributed)');
    expect(summary).toContain('r@evil.tld (Registrant, medium/unconfirmed)');
  });

  it('restates the highest-confidence finding claim + band', async () => {
    const { summary } = await new TemplateNarrator().narrate(report());
    expect(summary).toContain('evil.tld registered by r@evil.tld');
    expect(summary).toContain('(high)');
  });

  it('invents nothing when there are no actors or findings', async () => {
    const r = report({ keyActors: [], findings: [], entityCount: 0, findingCount: 0, actorTail: { shown: 0, total: 0 } });
    const { summary } = await new TemplateNarrator().narrate(r);
    expect(summary).toContain('0 entities');
    expect(summary).toContain('0 findings');
    // no fabricated actor/finding text
    expect(summary).not.toMatch(/\(.*\/.*\)/); // no "(role, conf/attr)" tuple
  });
});

// ---- applyNarrative seam ----------------------------------------------------

describe('applyNarrative', () => {
  it('falls back to TemplateNarrator when narrator is null', async () => {
    const out = await applyNarrative(report(), null);
    expect(out.narrative?.source).toBe('template');
    expect(out.narrative?.summary).toContain('case-abc');
  });

  it('falls back to TemplateNarrator when narrator is undefined', async () => {
    const out = await applyNarrative(report());
    expect(out.narrative?.source).toBe('template');
  });

  it('falls back to TemplateNarrator when the model narrator throws (report still narrated)', async () => {
    const throwing: Narrator = {
      async narrate(): Promise<NarrativeSections> {
        throw new Error('model narrator exploded');
      }
    };
    const out = await applyNarrative(report(), throwing);
    expect(out.narrative?.source).toBe('template');
    expect(out.narrative?.summary).toBeDefined();
  });

  it('uses the injected narrator when it succeeds', async () => {
    const model: Narrator = {
      async narrate(): Promise<NarrativeSections> {
        return { summary: 'model prose', source: 'model', model: 'test-model-1' };
      }
    };
    const out = await applyNarrative(report(), model);
    expect(out.narrative).toEqual({ summary: 'model prose', source: 'model', model: 'test-model-1' });
  });

  it('does not mutate the input report and preserves all fact fields', async () => {
    const r = report();
    const out = await applyNarrative(r, null);
    expect(r.narrative).toBeUndefined();       // input untouched
    expect(out.keyActors).toBe(r.keyActors);   // facts carried through
    expect(out.findings).toBe(r.findings);
    expect(out.entityCount).toBe(r.entityCount);
  });
});
