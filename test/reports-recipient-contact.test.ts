import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { ensureReport, ensureReportTemplate } from '../src/main/security/validate';
import { buildReportHtml } from '../src/main/reports/report-html';
import { renderReportDocx } from '../src/main/reports/docx';
import type { Report, Contact } from '../src/shared/reports-types';

describe('toContactId model + validator', () => {
  it('preserves a valid toContactId, like fromContactId', () => {
    const r = ensureReport({ id: 'r1', to: '', toContactId: 'c-recipient', blocks: [] });
    expect(r.toContactId).toBe('c-recipient');
  });

  it('leaves toContactId unset when absent', () => {
    const r = ensureReport({ id: 'r1', to: '', blocks: [] });
    expect(r.toContactId).toBeUndefined();
  });

  it('drops an over-long toContactId', () => {
    const r = ensureReport({ id: 'r1', to: '', toContactId: 'x'.repeat(65), blocks: [] });
    expect(r.toContactId).toBeUndefined();
  });

  it('drops a non-string toContactId', () => {
    const r = ensureReport({ id: 'r1', to: '', toContactId: 12345, blocks: [] });
    expect(r.toContactId).toBeUndefined();
  });

  it('drops an empty-string toContactId', () => {
    const r = ensureReport({ id: 'r1', to: '', toContactId: '', blocks: [] });
    expect(r.toContactId).toBeUndefined();
  });
});

describe('ensureReportTemplate — toContactId (recipient survives a template save)', () => {
  it('preserves a valid toContactId, exactly like fromContactId', () => {
    const t = ensureReportTemplate({ id: 't1', name: 'Tpl', to: '', fromContactId: 'c-from', toContactId: 'c-recipient', blocks: [] });
    expect(t.toContactId).toBe('c-recipient');
    expect(t.fromContactId).toBe('c-from');
  });

  it('leaves toContactId unset when absent', () => {
    const t = ensureReportTemplate({ id: 't1', name: 'Tpl', to: '', blocks: [] });
    expect(t.toContactId).toBeUndefined();
  });

  it('drops an over-long toContactId', () => {
    const t = ensureReportTemplate({ id: 't1', name: 'Tpl', to: '', toContactId: 'x'.repeat(65), blocks: [] });
    expect(t.toContactId).toBeUndefined();
  });

  it('drops a non-string toContactId', () => {
    const t = ensureReportTemplate({ id: 't1', name: 'Tpl', to: '', toContactId: 12345, blocks: [] });
    expect(t.toContactId).toBeUndefined();
  });

  it('drops an empty-string toContactId', () => {
    const t = ensureReportTemplate({ id: 't1', name: 'Tpl', to: '', toContactId: '', blocks: [] });
    expect(t.toContactId).toBeUndefined();
  });
});

const toContact: Contact = {
  id: 'c-recipient', name: 'Jordan <b>Recipient</b>', title: 'Case Officer', org: 'Field Office', email: 'jordan@example.com'
};

const reportWithToContact: Report = {
  id: 'r1', title: 'Chain of Custody', createdAt: 'x', updatedAt: 'x',
  toContactId: 'c-recipient', to: 'legacy string should not appear', blocks: []
};

const reportWithLegacyTo: Report = {
  id: 'r2', title: 'Chain of Custody', createdAt: 'x', updatedAt: 'x',
  to: '<b>Legacy</b> Recipient', blocks: []
};

describe('buildReportHtml — structured To (PDF)', () => {
  it('renders the resolved recipient contact via the same contactHtml block as From', () => {
    const html = buildReportHtml(reportWithToContact, {}, null, toContact);
    expect(html).toContain('Jordan &lt;b&gt;Recipient&lt;/b&gt;');
    expect(html).toContain('Case Officer');
    expect(html).toContain('Field Office');
    expect(html).toContain('jordan@example.com');
    expect(html).not.toContain('legacy string should not appear');
  });

  it('falls back to the escaped legacy report.to string when toContactId does not resolve', () => {
    const html = buildReportHtml(reportWithLegacyTo, {}, null, null);
    expect(html).not.toContain('<b>Legacy</b> Recipient');
    expect(html).toContain('&lt;b&gt;Legacy&lt;/b&gt; Recipient');
  });
});

describe('renderReportDocx — structured To', () => {
  it('renders the resolved recipient contact lines instead of report.to', () => {
    const doc = new AdmZip(renderReportDocx(reportWithToContact, {}, null, toContact)).getEntry('word/document.xml')!.getData().toString('utf8');
    expect(doc).toContain('Jordan &lt;b&gt;Recipient&lt;/b&gt;');
    expect(doc).toContain('Case Officer');
    expect(doc).toContain('Field Office');
    expect(doc).toContain('jordan@example.com');
    expect(doc).not.toContain('legacy string should not appear');
  });

  it('falls back to the escaped legacy report.to line when toContactId does not resolve', () => {
    const doc = new AdmZip(renderReportDocx(reportWithLegacyTo, {}, null, null)).getEntry('word/document.xml')!.getData().toString('utf8');
    expect(doc).not.toContain('<b>Legacy</b> Recipient');
    expect(doc).toContain('&lt;b&gt;Legacy&lt;/b&gt; Recipient');
  });
});
