/**
 * X Listening Station Enterprise port — Task 11: exports (JSON/PDF/CSV + SHA-256 sidecar,
 * synthetic excluded).
 *
 * `exportXPostsToFile` wraps the already-hardened X8 serializers (`itemsToJson`/`itemsToCsv`/
 * `buildXItemsHtml`, `ipc.ts`) with two things Enterprise had that X8 didn't need until now:
 *
 *  1. A SHA-256 checksum sidecar (`<path>.sha256.txt`) written alongside the export.
 *  2. Synthetic/demo exclusion — a post with `synthetic:true` must never be written, counted,
 *     or folded into the checksum.
 *
 * The formula-guard (`csvCell`) and HTML-escape (`escapeField`) behaviors themselves are
 * already covered by `test/x-listening-export.test.ts` (X8); this suite proves the export
 * still carries them through when routed via `exportXPostsToFile`, plus the two NEW
 * invariants above.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { XPostArtifact } from '../src/main/x-listening/store';

/** A well-formed captured post artifact, matching the ACTUAL store.ts shape (flat
 *  `metrics`/`metricsRaw`, not the older nested `{raw,value,approx}` shape X8's own fixtures
 *  use) — this is what `store.posts.read()` really returns. */
function post(over: Partial<XPostArtifact> = {}): XPostArtifact {
  return {
    id: over.id ?? 'post-1',
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
    kind: 'post',
    parentPostId: null,
    metrics: { replies: 12, reposts: 3, likes: 1200, views: 45000 },
    metricsRaw: { replies: '12', reposts: '3', likes: '1.2K', views: '45K' },
    evidenceHash: 'deadbeef',
    ...over
  };
}

// ── M15: per-export SOURCE / TYPE / QUERY filters ─────────────────────────────
describe('applyExportFilters (M15)', () => {
  it('filters by SOURCE (normalized key), TYPE (kind) and QUERY (text/handle substring)', async () => {
    const { applyExportFilters } = await import('../src/main/x-listening/exports');
    const posts = [
      post({ id: 'a', channelId: 'alice', authorHandle: '@alice', kind: 'post', text: 'ransomware alert' }),
      post({ id: 'b', channelId: 'Alice', authorHandle: '@alice', kind: 'reply', text: 'a reply' }),
      post({ id: 'c', channelId: 'bob', authorHandle: '@bob', kind: 'post', text: 'unrelated' }),
    ];
    // SOURCE 'alice' is case-insensitive on the source key → a + b, never c
    expect(applyExportFilters(posts, { source: 'alice' }).map((p) => p.id)).toEqual(['a', 'b']);
    // TYPE 'post' → a + c
    expect(applyExportFilters(posts, { kind: 'post' }).map((p) => p.id)).toEqual(['a', 'c']);
    // QUERY matches post text OR @handle, case-insensitive
    expect(applyExportFilters(posts, { query: 'RANSOMWARE' }).map((p) => p.id)).toEqual(['a']);
    expect(applyExportFilters(posts, { query: '@bob' }).map((p) => p.id)).toEqual(['c']);
    // combined AND
    expect(applyExportFilters(posts, { source: 'alice', kind: 'post' }).map((p) => p.id)).toEqual(['a']);
  });

  it("treats 'all' / '' / undefined as no filter (full pass-through)", async () => {
    const { applyExportFilters } = await import('../src/main/x-listening/exports');
    const posts = [post({ id: 'a', kind: 'post' }), post({ id: 'b', kind: 'reply' })];
    expect(applyExportFilters(posts, { source: 'all', kind: 'all', query: '' }).map((p) => p.id)).toEqual(['a', 'b']);
    expect(applyExportFilters(posts, undefined).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('exportXPostsToFile applies the filters AFTER synthetic-exclusion (a filter never surfaces a demo record)', async () => {
    const { exportXPostsToFile } = await import('../src/main/x-listening/exports');
    const readPosts = vi.fn(async () => [
      post({ id: 'real', channelId: 'alice', authorHandle: '@alice', kind: 'post', text: 'genuine' }),
      // a synthetic record whose fields WOULD match the filter — must still be excluded
      post({ id: 'demo', channelId: 'alice', authorHandle: '@alice', kind: 'post', text: 'genuine', synthetic: true } as never),
      post({ id: 'other', channelId: 'bob', authorHandle: '@bob', kind: 'post', text: 'genuine' }),
    ]);
    const written = new Map<string, Buffer | string>();
    const writeFile = vi.fn(async (p: string, data: Buffer | string) => { written.set(p, data); });
    const res = await exportXPostsToFile('case-a', 'json', '/exports/f.json', { readPosts, writeFile }, { source: 'alice' });
    // only the REAL alice post survives (demo excluded, bob filtered out)
    expect(res.count).toBe(1);
    const parsed = JSON.parse(String(written.get('/exports/f.json')));
    expect(parsed.map((p: { id: string }) => p.id)).toEqual(['real']);
  });
});

describe('exportXPostsToFile', () => {
  it('json export round-trips the real posts and writes a matching SHA-256 sidecar', async () => {
    const { exportXPostsToFile } = await import('../src/main/x-listening/exports');
    const readPosts = vi.fn(async () => [post({ text: 'primary intel' })]);
    const written = new Map<string, Buffer | string>();
    const writeFile = vi.fn(async (p: string, data: Buffer | string) => {
      written.set(p, data);
    });

    const res = await exportXPostsToFile('case-a', 'json', '/exports/out.json', {
      readPosts,
      writeFile
    });

    expect(readPosts).toHaveBeenCalledWith('case-a');
    expect(res.count).toBe(1);
    expect(res.filePath).toBe('/exports/out.json');
    expect(res.checksumPath).toBe('/exports/out.json.sha256.txt');

    // the file actually holds the intel, round-trippably
    const fileData = written.get('/exports/out.json');
    expect(fileData).toBeDefined();
    const parsed = JSON.parse(String(fileData));
    expect(parsed[0].text).toBe('primary intel');
    expect(parsed[0].evidenceHash).toBe('deadbeef');

    // the sidecar is a correct sha256 of the EXACT bytes written to the export file
    const expectedDigest = createHash('sha256').update(String(fileData), 'utf8').digest('hex');
    expect(res.sha256).toBe(expectedDigest);
    const sidecar = String(written.get('/exports/out.json.sha256.txt'));
    expect(sidecar).toBe(`${expectedDigest}  out.json\n`);
  });

  it('csv export formula-guards a scraped post body via csvCell', async () => {
    const { exportXPostsToFile } = await import('../src/main/x-listening/exports');
    const readPosts = vi.fn(async () => [post({ text: '=HYPERLINK("http://evil")' })]);
    const written = new Map<string, Buffer | string>();
    const writeFile = vi.fn(async (p: string, data: Buffer | string) => {
      written.set(p, data);
    });

    const res = await exportXPostsToFile('case-a', 'csv', '/exports/out.csv', {
      readPosts,
      writeFile
    });

    const csv = String(written.get('/exports/out.csv'));
    // apostrophe-prefixed AND quoted — the formula-injection guard
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"")"');
    expect(res.count).toBe(1);
    // the sidecar hashes the CSV bytes actually written, not some other representation
    const expectedDigest = createHash('sha256').update(csv, 'utf8').digest('hex');
    expect(res.sha256).toBe(expectedDigest);
  });

  it('pdf export HTML-escapes a scripted post body before handing it to htmlToPdf', async () => {
    const { exportXPostsToFile } = await import('../src/main/x-listening/exports');
    const readPosts = vi.fn(async () => [post({ text: '<script>steal()</script>' })]);
    const written = new Map<string, Buffer | string>();
    const writeFile = vi.fn(async (p: string, data: Buffer | string) => {
      written.set(p, data);
    });
    const htmlToPdf = vi.fn(async (html: string) => {
      expect(html).toContain('&lt;script&gt;steal()&lt;/script&gt;');
      expect(html).not.toContain('<script>steal()');
      return Buffer.from(html, 'utf8');
    });

    const res = await exportXPostsToFile('case-a', 'pdf', '/exports/out.pdf', {
      readPosts,
      writeFile,
      htmlToPdf
    });

    expect(htmlToPdf).toHaveBeenCalledTimes(1);
    expect(written.has('/exports/out.pdf')).toBe(true);
    expect(res.checksumPath).toBe('/exports/out.pdf.sha256.txt');
  });

  it('excludes synthetic/demo posts from JSON export, count, and the checksum', async () => {
    const { exportXPostsToFile } = await import('../src/main/x-listening/exports');
    const readPosts = vi.fn(async () => [
      post({ id: 'real-1', text: 'real intel' }),
      post({ id: 'demo-1', text: 'DEMO seeded post', synthetic: true })
    ]);
    const written = new Map<string, Buffer | string>();
    const writeFile = vi.fn(async (p: string, data: Buffer | string) => {
      written.set(p, data);
    });

    const res = await exportXPostsToFile('case-a', 'json', '/exports/out.json', {
      readPosts,
      writeFile
    });

    expect(res.count).toBe(1);
    const fileData = String(written.get('/exports/out.json'));
    expect(fileData).toContain('real intel');
    expect(fileData).not.toContain('DEMO seeded post');
    expect(fileData).not.toContain('demo-1');

    // the checksum is of the FILTERED file, not the raw store contents
    const expectedDigest = createHash('sha256').update(fileData, 'utf8').digest('hex');
    expect(res.sha256).toBe(expectedDigest);
  });

  it('excludes synthetic posts from CSV export and count', async () => {
    const { exportXPostsToFile } = await import('../src/main/x-listening/exports');
    const readPosts = vi.fn(async () => [
      post({ id: 'real-1', text: 'kept row' }),
      post({ id: 'demo-1', text: 'excluded demo row', synthetic: true })
    ]);
    const written = new Map<string, Buffer | string>();
    const writeFile = vi.fn(async (p: string, data: Buffer | string) => {
      written.set(p, data);
    });

    const res = await exportXPostsToFile('case-a', 'csv', '/exports/out.csv', {
      readPosts,
      writeFile
    });

    expect(res.count).toBe(1);
    const csv = String(written.get('/exports/out.csv'));
    expect(csv).toContain('kept row');
    expect(csv).not.toContain('excluded demo row');
  });

  it('excludes synthetic posts from the PDF/HTML export', async () => {
    const { exportXPostsToFile } = await import('../src/main/x-listening/exports');
    const readPosts = vi.fn(async () => [
      post({ id: 'real-1', text: 'kept in pdf' }),
      post({ id: 'demo-1', text: 'excluded from pdf', synthetic: true })
    ]);
    const written = new Map<string, Buffer | string>();
    const writeFile = vi.fn(async (p: string, data: Buffer | string) => {
      written.set(p, data);
    });
    const htmlToPdf = vi.fn(async (html: string) => Buffer.from(html, 'utf8'));

    await exportXPostsToFile('case-a', 'pdf', '/exports/out.pdf', {
      readPosts,
      writeFile,
      htmlToPdf
    });

    const html = String(htmlToPdf.mock.calls[0]![0]);
    expect(html).toContain('kept in pdf');
    expect(html).not.toContain('excluded from pdf');
  });

  it('excludeSynthetic keeps posts with an absent/undefined synthetic flag', async () => {
    const { excludeSynthetic } = await import('../src/main/x-listening/exports');
    const kept = excludeSynthetic([post({ id: 'a' }), post({ id: 'b', synthetic: false })]);
    expect(kept.map((p) => p.id)).toEqual(['a', 'b']);
  });

  // ---- M10: CSV metric columns read from the flat `metricsRaw` shape -----
  it('csv export populates the replies/reposts/likes/views columns from metricsRaw (M10)', async () => {
    const { exportXPostsToFile } = await import('../src/main/x-listening/exports');
    const { X_ITEMS_CSV_HEADER } = await import('../src/main/x-listening/ipc');
    // The store shape: flat number `metrics` + raw platform strings on `metricsRaw`.
    const readPosts = vi.fn(async () => [post()]);
    const written = new Map<string, Buffer | string>();
    const writeFile = vi.fn(async (p: string, data: Buffer | string) => {
      written.set(p, data);
    });

    await exportXPostsToFile('case-a', 'csv', '/exports/out.csv', { readPosts, writeFile });

    const csv = String(written.get('/exports/out.csv'));
    const lines = csv.replace('﻿', '').split('\r\n');
    const unquote = (line: string) => line.split(',').map((c) => c.replace(/^"|"$/g, ''));
    const header = [...X_ITEMS_CSV_HEADER];
    const row = unquote(lines[1]);
    const col = (name: string) => row[header.indexOf(name)];
    // Before the fix these columns rendered '' (the nested `metrics?.[name]?.raw` read a number).
    expect(col('replies')).toBe('12');
    expect(col('reposts')).toBe('3');
    expect(col('likes')).toBe('1.2K');
    expect(col('views')).toBe('45K');
  });

  // ---- M9: PDF restores the dropped evidence fields ---------------------
  it('pdf export restores analyst notes, per-post SHA-256, first/last observed, and Monitored via @source (M9)', async () => {
    const { exportXPostsToFile } = await import('../src/main/x-listening/exports');
    const readPosts = vi.fn(async () => [
      post({ id: 'p1', evidenceHash: 'abc123ev', harvestedAt: '2026-08-06T12:00:00.000Z' }),
    ]);
    const readNotes = vi.fn(async () => [
      { findingId: 'p1', text: 'suspicious phrasing here', savedAt: '2026-08-07T09:00:00.000Z' },
    ]);
    let capturedHtml = '';
    const htmlToPdf = vi.fn(async (html: string) => {
      capturedHtml = html;
      return Buffer.from(html, 'utf8');
    });
    const writeFile = vi.fn(async () => {});

    await exportXPostsToFile('case-a', 'pdf', '/exports/out.pdf', {
      readPosts,
      readNotes,
      writeFile,
      htmlToPdf,
    });

    // analyst note (text + a notes heading)
    expect(capturedHtml).toContain('suspicious phrasing here');
    expect(capturedHtml).toMatch(/Analyst notes/i);
    // per-post SHA-256 evidence hash
    expect(capturedHtml).toContain('abc123ev');
    // first/last observed (fall back to harvestedAt when the post carries no observed range)
    expect(capturedHtml).toContain('First observed 2026-08-06T12:00:00.000Z');
    expect(capturedHtml).toContain('Last observed 2026-08-06T12:00:00.000Z');
    // "Monitored via @source" — falls back to the post's own handle when no source is stored
    expect(capturedHtml).toContain('Monitored via @alice');
    // hardening we already added must survive: metrics line stays present
    expect(capturedHtml).toContain('1.2K');
  });

  it('pdf export without a readNotes seam still exports (notes default to none)', async () => {
    const { exportXPostsToFile } = await import('../src/main/x-listening/exports');
    const readPosts = vi.fn(async () => [post({ id: 'p1' })]);
    let capturedHtml = '';
    const htmlToPdf = vi.fn(async (html: string) => {
      capturedHtml = html;
      return Buffer.from(html, 'utf8');
    });
    const writeFile = vi.fn(async () => {});
    await exportXPostsToFile('case-a', 'pdf', '/exports/out.pdf', { readPosts, writeFile, htmlToPdf });
    // evidence footer still renders from the artifact; no analyst-notes section without notes
    expect(capturedHtml).toContain('Monitored via @alice');
    expect(capturedHtml).not.toMatch(/Analyst notes/i);
  });
});
