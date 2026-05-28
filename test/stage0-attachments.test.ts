import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

// json-fs → paths.ts imports electron's `app`; mock it to a temp userData dir so the
// real fileStore runs against real files without an Electron runtime.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-stage0-test' } }));

// imported AFTER the mock (vitest hoists vi.mock above imports)
import { fileStore } from '../src/main/storage/json-fs';
import { caseAttachmentsDir } from '../src/main/storage/paths';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
let attachDir: string;

beforeAll(async () => {
  attachDir = caseAttachmentsDir(CASE_ID);
  await mkdir(attachDir, { recursive: true });
});

afterAll(async () => {
  await rm('/tmp/ga98-stage0-test', { recursive: true, force: true });
});

describe('readAttachmentBytes', () => {
  it('reads a clamped slice and reports size/hasMore', async () => {
    const data = Buffer.from('Hello, Ghost Access 98');
    await writeFile(join(attachDir, 'doc.bin'), data);

    const first = await fileStore.readAttachmentBytes(CASE_ID, 'doc.bin', 0, 5);
    expect(first.base64).toBe(Buffer.from('Hello').toString('base64'));
    expect(first.size).toBe(data.length);
    expect(first.length).toBe(5);
    expect(first.hasMore).toBe(true);

    const rest = await fileStore.readAttachmentBytes(CASE_ID, 'doc.bin', 5, 1000);
    expect(Buffer.from(rest.base64!, 'base64').toString()).toBe(', Ghost Access 98');
    expect(rest.hasMore).toBe(false);
  });

  it('returns out-of-range past EOF and read-error for a missing file', async () => {
    const oob = await fileStore.readAttachmentBytes(CASE_ID, 'doc.bin', 9999, 10);
    expect(oob.reason).toBe('out-of-range');
    expect(oob.base64).toBeNull();

    const missing = await fileStore.readAttachmentBytes(CASE_ID, 'nope.bin', 0, 10);
    expect(missing.reason).toBe('read-error');
  });
});

describe('readEmlPreview', () => {
  it('parses headers, subject, and body', async () => {
    const eml = [
      'From: alice@example.com',
      'To: bob@example.com',
      'Subject: Test Subject',
      'Date: Wed, 28 May 2026 12:00:00 +0000',
      '',
      'Hello body text.'
    ].join('\r\n');
    await writeFile(join(attachDir, 'msg.eml'), eml);

    const p = await fileStore.readEmlPreview(CASE_ID, 'msg.eml');
    expect(p.subject).toBe('Test Subject');
    expect(p.from).toContain('alice@example.com');
    expect(p.to).toContain('bob@example.com');
    expect(p.text.trim()).toBe('Hello body text.');
    expect(p.headers.some((h) => h.key === 'subject')).toBe(true);
  });
});

describe('extractAttachmentMeta + cache + skip-filter', () => {
  it('extracts metadata, caches it, and the cache is not listed as an attachment', async () => {
    await writeFile(join(attachDir, 'note.txt'), 'plain text');

    const meta = await fileStore.extractAttachmentMeta(CASE_ID, 'note.txt');
    expect(meta.fileType).toBe('txt');
    expect(meta.size).toBe('plain text'.length);
    expect(meta.modifiedAt).toBeDefined();

    // Caching this attachment wrote note.txt.extracted.json next to it; listing must skip it.
    const list = await fileStore.listAttachments(CASE_ID);
    const names = list.map((a) => a.fileName);
    expect(names).toContain('note.txt');
    expect(names.every((n) => !n.endsWith('.extracted.json'))).toBe(true);
  });
});
