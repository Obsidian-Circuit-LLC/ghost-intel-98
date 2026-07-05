import { describe, it, expect } from 'vitest';
import type {
  IntelReport,
  KeyActor,
  ReportFinding,
  MethodologyEntry,
  ProvenanceRef,
  NarrativeSections
} from '@shared/investigation-report';
import { buildIntelReportHtml } from '../src/main/investigation/report-html';

// ---- fixture builders -------------------------------------------------------

function prov(over: Partial<ProvenanceRef> & { evidenceId: string }): ProvenanceRef {
  return {
    transformId: 'whois.lookup',
    transformVersion: '1.0.0',
    createdAt: '2020-01-01T00:00:00.000Z',
    rawRef: 'ref:9f8c2a1b',
    ...over
  };
}

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

function method(over: Partial<MethodologyEntry> & { runId: string }): MethodologyEntry {
  return {
    objective: 'map the infrastructure',
    budget: { maxPivots: 5, maxDepth: 3, maxWallClockMs: 60000, maxTokens: 1000 },
    status: 'completed',
    actionCount: 4,
    transformsUsed: ['dns.resolve', 'whois.lookup'],
    createdAt: '2020-01-01T00:00:00.000Z',
    ...over
  };
}

function report(over: Partial<IntelReport> = {}): IntelReport {
  const keyActors = over.keyActors ?? [
    actor({
      entityId: 'e1',
      value: 'evil.tld',
      role: 'Domain',
      confidence: 'high',
      attribution: 'attributed',
      findingBacked: true,
      salience: 6.8,
      evidence: [prov({ evidenceId: 'ev1' })]
    }),
    actor({ entityId: 'e2', value: 'r@evil.tld', role: 'Registrant', confidence: 'medium', attribution: 'unconfirmed', salience: 5.8 })
  ];
  const findings = over.findings ?? [
    finding({ id: 'f1', claim: 'evil.tld registered by r@evil.tld', confidence: { band: 'high', attribution: 'attributed', score: 0.9 }, evidence: [prov({ evidenceId: 'ev1' })] })
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
    methodology: over.methodology ?? [method({ runId: 'run-1' })],
    ...over
  };
}

// ---- structure --------------------------------------------------------------

describe('buildIntelReportHtml — structure', () => {
  it('renders the header with scope, counts and injected generatedAt', () => {
    const html = buildIntelReportHtml(report());
    expect(html).toContain('case-abc');
    expect(html).toContain('1970-01-01T00:00:00.000Z');
    expect(html).toContain('2'); // entity count
  });

  it('renders the Key Actors table with the five columns', () => {
    const html = buildIntelReportHtml(report());
    for (const col of ['Actor', 'Role', 'Confidence', 'Attribution', 'Evidence']) {
      expect(html).toContain(col);
    }
    expect(html).toContain('evil.tld');
    expect(html).toContain('Registrant');
  });

  it('renders each provenance ref as transformId@version · createdAt', () => {
    const html = buildIntelReportHtml(report());
    expect(html).toContain('whois.lookup@1.0.0');
    expect(html).toContain('2020-01-01T00:00:00.000Z');
  });

  it('renders the findings with claim and band+score', () => {
    const html = buildIntelReportHtml(report());
    expect(html).toContain('evil.tld registered by r@evil.tld');
    expect(html).toContain('high');
    expect(html).toContain('0.9');
  });

  it('renders the methodology appendix per run', () => {
    const html = buildIntelReportHtml(report());
    expect(html).toContain('run-1');
    expect(html).toContain('map the infrastructure');
    expect(html).toContain('completed');
    expect(html).toContain('dns.resolve');
  });
});

// ---- truncation footer ------------------------------------------------------

describe('buildIntelReportHtml — truncation', () => {
  it('renders a truncation footer when actorTail.shown < total', () => {
    const html = buildIntelReportHtml(report({ actorTail: { shown: 2, total: 40 } }));
    expect(html).toMatch(/2[\s\S]*40|40[\s\S]*2/);
    expect(html.toLowerCase()).toMatch(/showing|of|remaining|truncat/);
  });

  it('renders no truncation footer when all actors are shown', () => {
    const html = buildIntelReportHtml(report({ actorTail: { shown: 2, total: 2 } }));
    expect(html.toLowerCase()).not.toMatch(/truncat/);
  });
});

// ---- narrative quarantine ---------------------------------------------------

describe('buildIntelReportHtml — narrative block', () => {
  it('renders no narrative block when narrative is absent', () => {
    const html = buildIntelReportHtml(report());
    expect(html.toLowerCase()).not.toContain('narrative');
  });

  it('stamps the source label for a template narrative', () => {
    const narrative: NarrativeSections = { summary: 'plain restatement', source: 'template' };
    const html = buildIntelReportHtml(report({ narrative }));
    expect(html.toLowerCase()).toContain('template');
    expect(html).toContain('plain restatement');
    expect(html.toLowerCase()).not.toMatch(/non-reproducible/);
  });

  it('marks a model narrative source-stamped AND non-reproducible', () => {
    const narrative: NarrativeSections = { summary: 'model prose', source: 'model', model: 'reasoner-7b' };
    const html = buildIntelReportHtml(report({ narrative }));
    expect(html).toContain('reasoner-7b');
    expect(html.toLowerCase()).toContain('model');
    expect(html.toLowerCase()).toMatch(/non-reproducible/);
  });
});

// ---- security: escaping -----------------------------------------------------

const XSS = '<img src=x onerror=alert(1)>';

describe('buildIntelReportHtml — escaping (trust boundary)', () => {
  it('escapes a malicious entity value', () => {
    const html = buildIntelReportHtml(report({
      keyActors: [actor({ entityId: 'e1', value: XSS })],
      actorTail: { shown: 1, total: 1 }
    }));
    expect(html).not.toContain(XSS);
    expect(html).toContain('&lt;img');
  });

  it('escapes a malicious finding claim', () => {
    const html = buildIntelReportHtml(report({
      findings: [finding({ id: 'f1', claim: XSS })]
    }));
    expect(html).not.toContain(XSS);
    expect(html).toContain('&lt;img');
  });

  it('escapes a malicious derived role', () => {
    const html = buildIntelReportHtml(report({
      keyActors: [actor({ entityId: 'e1', value: 'x', role: XSS })],
      actorTail: { shown: 1, total: 1 }
    }));
    expect(html).not.toContain(XSS);
  });

  it('escapes a malicious methodology objective', () => {
    const html = buildIntelReportHtml(report({
      methodology: [method({ runId: 'run-1', objective: XSS })]
    }));
    expect(html).not.toContain(XSS);
    expect(html).toContain('&lt;img');
  });

  it('escapes a malicious model-narrative summary (compromised narrator)', () => {
    const narrative: NarrativeSections = { summary: XSS, source: 'model', model: XSS };
    const html = buildIntelReportHtml(report({ narrative }));
    expect(html).not.toContain(XSS);
    expect(html).toContain('&lt;img');
  });
});

// ---- security: rawRef as text, no external URLs -----------------------------

describe('buildIntelReportHtml — no links, no egress', () => {
  it('renders rawRef as text, never a clickable link', () => {
    const html = buildIntelReportHtml(report({
      keyActors: [actor({ entityId: 'e1', value: 'evil.tld', evidence: [prov({ evidenceId: 'ev1', rawRef: 'ref:deadbeef' })] })],
      actorTail: { shown: 1, total: 1 }
    }));
    expect(html).toContain('ref:deadbeef');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href');
  });

  it('emits no external resource URLs (fully offline)', () => {
    const html = buildIntelReportHtml(report({ narrative: { summary: 's', source: 'template' } }));
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html).not.toContain('file://');
  });
});
