/**
 * X8 — Exports (reuse the app's existing PDF/DOCX exporters).
 *
 * The case's captured X items are serialized to JSON / CSV / PDF / DOCX for the
 * analyst. This suite proves the three security/honesty invariants the review
 * cares about, WITHOUT electron or the network:
 *
 *  1. JSON export round-trips the captured items (the case's intel is actually
 *     in the file).
 *  2. CSV is formula-injection safe — a scraped tweet body like `=cmd|calc` or
 *     `+cmd` is neutralized (apostrophe-prefixed, quoted) via `csvCell`, so it
 *     can never execute when the CSV is opened in Excel/Sheets. Rounded metrics
 *     are exported VERBATIM (`"1.2K"`), never a false-precision integer.
 *  3. The DOCX / PDF documents escape every scraped field — a `<script>` tweet
 *     body appears escaped (`&lt;script&gt;`), never as live markup, and a remote
 *     media URL is never emitted into an `<img src>` (data: thumbnails only).
 *
 * The DOCX path REUSES the app's existing `renderReportDocx` (no new `docx`
 * dependency); the PDF path REUSES `htmlToPdf` (no new `pdfkit`) — injected here
 * so the orchestration is exercised without a real BrowserWindow.
 */
import { describe, it, expect, vi } from 'vitest';
import AdmZip from 'adm-zip';
import type { HarvestedItem } from '../src/shared/socmint/types';

// capture-window (pulled transitively via ipc.ts) imports electron; export paths
// never touch it, so a minimal stub is enough to let the module import.
vi.mock('electron', () => ({
  session: { fromPartition: () => ({ cookies: { get: async () => [] } }) },
}));

/** Build a captured X item (typed as the base HarvestedItem the store returns; the
 *  X-specific metrics/kind/media fields ride along at runtime, exactly as persisted). */
function xItem(over: Record<string, unknown> = {}): HarvestedItem {
  return {
    id: 'id-1',
    platform: 'x',
    authorHandle: '@alice',
    authorId: 'alice',
    text: 'hello world',
    channelId: 'alice',
    channelLabel: '@alice',
    messageId: '1001',
    publishedAt: '2026-08-01T00:00:00.000Z',
    harvestedAt: '2026-08-06T12:00:00.000Z',
    url: 'https://x.com/alice/status/1001',
    provenance: { collectorVersion: 'x-listening/1.0.0', jobId: 'job-1', caseId: 'case-a' },
    // X-specific runtime fields (not on the base type — cast through the record spread):
    captureProvenance: 'visible-capture',
    verified: false,
    kind: 'post',
    media: ['data:image/png;base64,AAAA'],
    metrics: {
      replies: { raw: '12', value: 12, approx: false },
      reposts: { raw: '3', value: 3, approx: false },
      likes: { raw: '1.2K', value: 1200, approx: true },
      views: { raw: '45K', value: 45000, approx: true },
    },
    ...over,
  } as unknown as HarvestedItem;
}

describe('X8 export — pure builders', () => {
  it('itemsToJson round-trips the captured items', async () => {
    const { itemsToJson } = await import('../src/main/x-listening/ipc');
    const json = itemsToJson([xItem({ text: 'primary intel' })]);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].text).toBe('primary intel');
    expect(parsed[0].messageId).toBe('1001');
  });

  it('itemsToCsv neutralizes a formula-leading tweet body and keeps rounded metrics verbatim', async () => {
    const { itemsToCsv } = await import('../src/main/x-listening/ipc');
    const csv = itemsToCsv([
      xItem({ text: '=cmd|calc' }),
      xItem({ id: 'id-2', messageId: '1002', text: '+cmd danger' }),
      xItem({ id: 'id-3', messageId: '1003', text: 'benign body' }),
    ]);
    // formula-leading cells are apostrophe-prefixed AND quoted
    expect(csv).toContain('"\'=cmd|calc"');
    expect(csv).toContain('"\'+cmd danger"');
    // a benign body is quoted but NOT apostrophe-prefixed
    expect(csv).toContain('"benign body"');
    expect(csv).not.toContain('"\'benign body"');
    // honesty: the rounded metric is exported VERBATIM, never expanded to 1200
    expect(csv).toContain('1.2K');
    expect(csv).not.toContain('1200');
    // header + BOM, one line per item
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.replace('﻿', '').split('\r\n');
    expect(lines[0]).toContain('text');
    expect(lines).toHaveLength(1 + 3);
  });

  it('buildXItemsHtml escapes a scripted tweet body and never emits a remote media URL', async () => {
    const { buildXItemsHtml } = await import('../src/main/x-listening/ipc');
    const html = buildXItemsHtml('case-a', [
      xItem({
        text: '<script>steal()</script>',
        // a remote URL must never survive to an <img src>; data: only
        media: ['https://pbs.twimg.com/media/evil.jpg', 'data:image/png;base64,AAAA'],
      }),
    ]);
    expect(html).toContain('&lt;script&gt;steal()&lt;/script&gt;');
    expect(html).not.toContain('<script>steal()');
    // the remote media URL is dropped; only the data: thumbnail is inlined
    expect(html).not.toContain('pbs.twimg.com');
    expect(html).toContain('data:image/png;base64,AAAA');
  });
});

describe('X8 export — orchestration over the encrypted store', () => {
  it('exportXItems(json) reads the case items and reports the count', async () => {
    const { exportXItems } = await import('../src/main/x-listening/ipc');
    const readItems = vi.fn(async () => [xItem({ text: 'from store' })]);
    const res = await exportXItems('case-a', 'json', { readItems });
    expect(readItems).toHaveBeenCalledWith('case-a');
    expect(res.format).toBe('json');
    expect(res.count).toBe(1);
    expect(res.encoding).toBe('utf8');
    expect(JSON.parse(res.data)[0].text).toBe('from store');
    expect(res.suggestedName.endsWith('.json')).toBe(true);
  });

  it('exportXItems(csv) formula-guards a scraped body pulled from the store', async () => {
    const { exportXItems } = await import('../src/main/x-listening/ipc');
    const readItems = vi.fn(async () => [xItem({ text: '=HYPERLINK("http://evil")' })]);
    const res = await exportXItems('case-a', 'csv', { readItems });
    expect(res.encoding).toBe('utf8');
    expect(res.data).toContain('"\'=HYPERLINK(""http://evil"")"');
    expect(res.suggestedName.endsWith('.csv')).toBe(true);
  });

  it('exportXItems(docx) REUSES renderReportDocx and escapes a scripted body in document.xml', async () => {
    const { exportXItems } = await import('../src/main/x-listening/ipc');
    const readItems = vi.fn(async () => [xItem({ text: '<script>bad()</script>' })]);
    const res = await exportXItems('case-a', 'docx', { readItems });
    expect(res.encoding).toBe('base64');
    expect(res.mime).toContain('wordprocessingml');
    const zip = new AdmZip(Buffer.from(res.data, 'base64'));
    const doc = zip.getEntry('word/document.xml')!.getData().toString('utf8');
    // the tweet body is escaped, never live markup
    expect(doc).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(doc).not.toContain('<script>bad()');
  });

  it('exportXItems(pdf) REUSES the injected htmlToPdf on the escaped document', async () => {
    const { exportXItems } = await import('../src/main/x-listening/ipc');
    const readItems = vi.fn(async () => [xItem({ text: '<script>x()</script>' })]);
    const htmlToPdf = vi.fn(async (html: string) => Buffer.from(html, 'utf8'));
    const res = await exportXItems('case-a', 'pdf', { readItems, htmlToPdf });
    expect(htmlToPdf).toHaveBeenCalledTimes(1);
    expect(res.encoding).toBe('base64');
    expect(res.mime).toBe('application/pdf');
    const rendered = Buffer.from(res.data, 'base64').toString('utf8');
    expect(rendered).toContain('&lt;script&gt;x()&lt;/script&gt;');
    expect(rendered).not.toContain('<script>x()');
  });
});
