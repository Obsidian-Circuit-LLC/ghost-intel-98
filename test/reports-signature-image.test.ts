/**
 * Task 6: Signature drawn/uploaded image — model + PDF + DOCX (non-jsdom half).
 *
 * (a) ensureReport/ensureReportTemplate accept + bound `signatureRef` (mirrors bannerRef's
 *     ensureFileName routing) and a template round-trips it through the shared validator shape.
 * (b) buildReportHtml emits an <img> for the signature when signatureRef resolves in the asset
 *     map, else falls back to the legacy `Signature: <text>` line; renderReportDocx uses its
 *     addImage media helper when signatureRef is set, else the text run — mirroring bannerRef.
 */
import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { ensureReport, ensureReportTemplate } from '../src/main/security/validate';
import { buildReportHtml } from '../src/main/reports/report-html';
import { renderReportDocx } from '../src/main/reports/docx';
import type { Report } from '../src/shared/reports-types';

describe('signatureRef model + validator', () => {
  it('ensureReport preserves a valid signatureRef', () => {
    const r = ensureReport({ id: 'r1', to: '', signatureRef: 'sig-1.png', blocks: [] });
    expect(r.signatureRef).toBe('sig-1.png');
  });

  it('ensureReport leaves signatureRef unset when absent', () => {
    const r = ensureReport({ id: 'r1', to: '', blocks: [] });
    expect(r.signatureRef).toBeUndefined();
  });

  it('ensureReport drops a signatureRef with path separators (ensureFileName routing)', () => {
    const r = ensureReport({ id: 'r1', to: '', signatureRef: '../../etc/passwd', blocks: [] });
    expect(r.signatureRef).toBeUndefined();
  });

  it('ensureReport drops a non-string signatureRef', () => {
    const r = ensureReport({ id: 'r1', to: '', signatureRef: 12345, blocks: [] });
    expect(r.signatureRef).toBeUndefined();
  });

  it('ensureReportTemplate preserves a valid signatureRef (template round-trip)', () => {
    const t = ensureReportTemplate({ id: 't1', name: 'Tpl', to: '', signatureRef: 'sig-1.png', blocks: [] });
    expect(t.signatureRef).toBe('sig-1.png');
  });

  it('ensureReportTemplate leaves signatureRef unset when absent', () => {
    const t = ensureReportTemplate({ id: 't1', name: 'Tpl', to: '', blocks: [] });
    expect(t.signatureRef).toBeUndefined();
  });

  it('ensureReportTemplate drops a malformed signatureRef', () => {
    const t = ensureReportTemplate({ id: 't1', name: 'Tpl', to: '', signatureRef: 'a/b.png', blocks: [] });
    expect(t.signatureRef).toBeUndefined();
  });
});

const reportWithSigImage: Report = {
  id: 'r1', title: 'Chain of Custody', createdAt: 'x', updatedAt: 'x',
  to: 'Det. Vance', signatureRef: 'sig-1.png', signature: 'A. Investigator (legacy text)', blocks: []
};

const reportWithLegacySigOnly: Report = {
  id: 'r2', title: 'Chain of Custody', createdAt: 'x', updatedAt: 'x',
  to: 'Det. Vance', signature: 'A. Investigator', blocks: []
};

const reportWithNeitherSig: Report = {
  id: 'r3', title: 'Chain of Custody', createdAt: 'x', updatedAt: 'x', to: 'Det. Vance', blocks: []
};

const SIG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('buildReportHtml — signature image', () => {
  it('emits an <img> for the signature when signatureRef resolves in the asset map', () => {
    const html = buildReportHtml(reportWithSigImage, { 'sig-1.png': SIG_DATA_URL }, null, null);
    expect(html).toContain(`<img src="${SIG_DATA_URL}"`);
    expect(html).not.toContain('Signature: A. Investigator (legacy text)');
  });

  it('falls back to the legacy text line when signatureRef does not resolve', () => {
    const html = buildReportHtml(reportWithLegacySigOnly, {}, null, null);
    expect(html).toContain('Signature: A. Investigator');
    expect(html).not.toContain('<img src="" class="signature');
  });

  it('emits nothing when neither signatureRef nor signature text is set', () => {
    const html = buildReportHtml(reportWithNeitherSig, {}, null, null);
    expect(html).not.toContain('class="signature');
  });
});

describe('renderReportDocx — signature image', () => {
  it('embeds the signature as media (drawing run) when signatureRef resolves', () => {
    const doc = new AdmZip(renderReportDocx(reportWithSigImage, { 'sig-1.png': SIG_DATA_URL }, null, null));
    const documentXml = doc.getEntry('word/document.xml')!.getData().toString('utf8');
    expect(documentXml).toContain('<w:drawing>');
    expect(documentXml).not.toContain('Signature: A. Investigator (legacy text)');
    // The image bytes actually landed in the package as media.
    expect(doc.getEntry('word/media/image1.png')).toBeTruthy();
  });

  it('falls back to the legacy text run when signatureRef does not resolve', () => {
    const doc = new AdmZip(renderReportDocx(reportWithLegacySigOnly, {}, null, null));
    const documentXml = doc.getEntry('word/document.xml')!.getData().toString('utf8');
    expect(documentXml).toContain('Signature: A. Investigator');
    expect(documentXml).not.toContain('<w:drawing>');
  });
});
