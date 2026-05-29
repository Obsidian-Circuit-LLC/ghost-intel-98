import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/ga98-fetch-test' } }));
import { downloadVerified } from '../src/main/services/local-ai-fetch';
import { mkdir, writeFile, access, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const DIR = '/tmp/ga98-fetch-test';
beforeEach(async () => { await rm(DIR, { recursive: true, force: true }); await mkdir(DIR, { recursive: true }); });

it('rejects + removes the file on sha256 mismatch', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1,2,3]), { status: 200 })));
  const dest = `${DIR}/blob.bin`;
  await expect(downloadVerified('https://x/y', dest, 'deadbeef'.repeat(8), () => {}))
    .rejects.toThrow(/sha256/i);
  await expect(access(dest)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('writes the file and reports progress when the hash matches', async () => {
  const bytes = new Uint8Array([10,20,30,40]);
  const good = createHash('sha256').update(bytes).digest('hex');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } })));
  const dest = `${DIR}/ok.bin`;
  const seen: number[] = [];
  await downloadVerified('https://x/y', dest, good, (p) => seen.push(p.receivedBytes));
  expect([...(await readFile(dest))]).toEqual([10,20,30,40]);
  expect(seen.at(-1)).toBe(4);
});

it('rejects on a non-OK HTTP status', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
  await expect(downloadVerified('https://x/y', `${DIR}/z.bin`, 'x'.repeat(64), () => {})).rejects.toThrow();
});
