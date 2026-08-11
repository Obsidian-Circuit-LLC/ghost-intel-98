/**
 * X8 — Export serializers (`itemsToJson`/`itemsToCsv`/`buildXItemsHtml`, `ipc.ts`).
 *
 * The case's captured X items are serialized to JSON / CSV / HTML for the analyst —
 * `exports.ts` (Task 11) and the interactive save-dialog-gated exports reuse these same
 * three builders (the base for the Enterprise-port's JSON/PDF/CSV export surface; the
 * DOCX/base64 `exportXItems` orchestration these builders used to feed was retired at
 * Task 16 along with the rest of the clearnet-only X1-X8 IPC surface — `test/
 * x-listening-exports.test.ts` proves the checksum/synthetic-exclusion behavior the
 * surviving `exportXPostsToFile` orchestration adds on top). This suite proves the two
 * security/honesty invariants the review cares about, WITHOUT electron or the network:
 *
 *  1. JSON round-trips the captured items (the case's intel is actually in the file).
 *  2. CSV is formula-injection safe — a scraped tweet body like `=cmd|calc` or
 *     `+cmd` is neutralized (apostrophe-prefixed, quoted) via `csvCell`, so it
 *     can never execute when the CSV is opened in Excel/Sheets. Rounded metrics
 *     are exported VERBATIM (`"1.2K"`), never a false-precision integer.
 *  3. The HTML document escapes every scraped field — a `<script>` tweet body
 *     appears escaped (`&lt;script&gt;`), never as live markup, and a remote media
 *     URL is never emitted into an `<img src>` (data: thumbnails only).
 */
import { describe, it, expect } from 'vitest';
import type { HarvestedItem } from '../src/shared/socmint/types';

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

