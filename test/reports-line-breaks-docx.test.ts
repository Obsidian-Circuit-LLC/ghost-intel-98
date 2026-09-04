// @vitest-environment node
/**
 * The DOCX half of the Enter-key fix — see reports-line-breaks.test.ts for the mechanism.
 *
 * Split out because the docx path writes a real zip, and adm-zip reads back empty under the jsdom
 * environment the sanitizer needs. The input below is the EXACT string sanitizeReportHtml produces
 * for two Enter-separated lines, asserted in that sibling file; if it ever changes there, this
 * fixture is stale and this test is the one that should be updated to match.
 */
import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { renderReportDocx } from '../src/main/reports/docx';
import type { Report } from '../src/shared/reports-types';

const STORED = '<p>First sentence.</p><p>Second sentence.</p>';
const reportWith = (html: string): Report => ({
  id: 'r', title: 'T', createdAt: '', updatedAt: '', to: 'you',
  blocks: [{ id: 'b', kind: 'text', html }],
});

describe('DOCX export of a typed line break', () => {
  it('puts the two sentences in different paragraphs', () => {
    const xml = new AdmZip(renderReportDocx(reportWith(STORED), {}, null)).readAsText('word/document.xml');
    const body = xml.slice(xml.indexOf('<w:body>'));
    const first = body.indexOf('First sentence.');
    const second = body.indexOf('Second sentence.');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    // A paragraph boundary between them — not one run carrying both sentences.
    expect(body.slice(first, second)).toContain('</w:p>');
  });

  it('welds them together if the break was already lost upstream', () => {
    // Guards the claim that the DOCX side was never the problem: given the OLD sanitizer output,
    // the export produces exactly the clustered result GhostExodus reported.
    const xml = new AdmZip(renderReportDocx(reportWith('First sentence.Second sentence.'), {}, null)).readAsText('word/document.xml');
    expect(xml).toContain('First sentence.Second sentence.');
  });
});
