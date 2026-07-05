/**
 * renderIntelReportPdf is a thin composition: buildIntelReportHtml(report) → htmlToPdf(html).
 * The Electron-dependent htmlToPdf body (offscreen window + printToPDF) is exercised manually /
 * behavior-preserved from renderCasePdf; here we mock it to a spy and assert the composition:
 * the built HTML is what gets handed to the shared PDF renderer, and its Buffer is returned.
 */
import { describe, it, expect, vi } from 'vitest';
import type {
  IntelReport,
  KeyActor,
  ReportFinding,
  MethodologyEntry
} from '@shared/investigation-report';

const { FAKE_PDF, htmlToPdf } = vi.hoisted(() => {
  const pdf = Buffer.from('%PDF-1.4 fake');
  return { FAKE_PDF: pdf, htmlToPdf: vi.fn(async (_html: string) => pdf) };
});
vi.mock('../src/main/services/export', () => ({ htmlToPdf }));

import { buildIntelReportHtml } from '../src/main/investigation/report-html';
import { renderIntelReportPdf } from '../src/main/investigation/report-pdf';

function actor(over: Partial<KeyActor> & { entityId: string; value: string }): KeyActor {
  return {
    type: 'domain', role: 'Domain', cluster: 0, salience: 1, degree: 0,
    confidence: 'low', attribution: 'unattributed', findingBacked: false,
    evidence: [], findingIds: [], ...over
  };
}
function finding(over: Partial<ReportFinding> & { id: string; claim: string }): ReportFinding {
  return { confidence: { band: 'low', attribution: 'unattributed', score: 0.3 }, evidence: [], createdAt: '2020-01-01T00:00:00.000Z', ...over };
}
function method(over: Partial<MethodologyEntry> & { runId: string }): MethodologyEntry {
  return { objective: 'map it', budget: { maxPivots: 5, maxDepth: 3, maxWallClockMs: 60000, maxTokens: 1000 }, status: 'completed', actionCount: 1, transformsUsed: ['whois.lookup'], createdAt: '2020-01-01T00:00:00.000Z', ...over };
}
function report(over: Partial<IntelReport> = {}): IntelReport {
  const keyActors = over.keyActors ?? [actor({ entityId: 'e1', value: 'evil.tld', salience: 6 })];
  const findings = over.findings ?? [finding({ id: 'f1', claim: 'evil.tld is bad' })];
  return {
    caseId: 'case-abc', scope: 'case', generatedAt: '1970-01-01T00:00:00.000Z',
    entityCount: keyActors.length, findingCount: findings.length, keyActors,
    actorTail: { shown: keyActors.length, total: keyActors.length }, findings,
    methodology: over.methodology ?? [method({ runId: 'run-1' })], ...over
  };
}

describe('renderIntelReportPdf', () => {
  it('renders the built INTELREPORT HTML through the shared htmlToPdf helper and returns its Buffer', async () => {
    htmlToPdf.mockClear();
    const r = report();
    const out = await renderIntelReportPdf(r);
    expect(htmlToPdf).toHaveBeenCalledTimes(1);
    expect(htmlToPdf).toHaveBeenCalledWith(buildIntelReportHtml(r));
    expect(out).toBe(FAKE_PDF);
  });
});
