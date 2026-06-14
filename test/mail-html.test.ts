import { describe, it, expect } from 'vitest';
import { buildMailPrintHtml } from '../src/main/services/mail-html';
import type { MailMessage } from '@shared/post-mvp-types';

const base: MailMessage = {
  uid: 1, from: 'a@x.com', to: 'b@y.com', subject: 'Hello', date: '2026-06-14T00:00:00Z',
  preview: '', unseen: false, flagged: false, body: 'plain body text', attachments: []
};

describe('buildMailPrintHtml', () => {
  it('includes From, Subject and body', () => {
    const html = buildMailPrintHtml(base);
    expect(html).toContain('a@x.com');
    expect(html).toContain('Hello');
    expect(html).toContain('plain body text');
  });
  it('escapes a <script> in subject or body (XSS guard)', () => {
    const html = buildMailPrintHtml({ ...base, subject: '<script>alert(1)</script>', body: '<script>evil()</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>evil()</script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('lists attachment filenames with a not-printed note', () => {
    const html = buildMailPrintHtml({ ...base, attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', size: 10 }] });
    expect(html).toContain('a.pdf');
    expect(html).toContain('not printed');
  });
});
