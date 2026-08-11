/**
 * X Listening Station Enterprise port — Task 9: media/avatar caching.
 *
 * `cacheRemoteMedia` composes the host-anchored `remoteMediaToDataUri` (security.ts) with
 * a byte-persistence step: the resolved `data:` payload is decoded to raw bytes, sha256'd,
 * and written via `secureWriteFile` under the case's own media directory
 * (`scrapingCaseDir('x', caseId)/x-media/<sha256>`) — never a plaintext `fs.writeFile`. The
 * only thing the function ever returns on success is a LOCAL reference (`ref`) + the byte
 * hash; a remote URL or the raw `data:` URI itself is never handed back, so a caller that
 * persists `ref` onto `XPostArtifact.mediaRefs` / `XNetworkAccount.avatar` can never leak a
 * fetchable remote URL (Global Constraints no-remote-media rule).
 *
 * Two test tiers, mirroring x-listening-store.test.ts:
 *  1. Pure/injected-deps: decoy-host rejection, ref shape, sha256 correctness, failure modes
 *     — no electron, deps.writeBytes is a plain in-memory spy.
 *  2. Production-wired: `secureWriteFile` really runs (fake reversible vault, mirroring
 *     x-listening-store.test.ts) — proves the cached bytes are CIPHERTEXT on disk, not
 *     plaintext image bytes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { MediaCapturePage } from '../src/main/capture/security';

const DATA = join(tmpdir(), 'dcs98-x-listening-media-test');
const MAGIC = Buffer.from('ENCX');

vi.mock('electron', () => ({ app: { getPath: () => DATA } }));

// Reversible fake vault: encrypt = MAGIC prefix + byte-inverted body; enabled + unlocked.
vi.mock('../src/main/services/vault', () => {
  const isEnc = (b: Buffer) => b.length >= 4 && b.subarray(0, 4).equals(MAGIC);
  return {
    isEnabledCached: () => true,
    isUnlocked: () => true,
    shouldEncrypt: () => true,
    hasMagicPrefix: (b: Buffer) => isEnc(b),
    isEncrypted: (b: Buffer) => isEnc(b),
    encryptBuffer: (b: Buffer) => Buffer.concat([MAGIC, Buffer.from(b.map((x) => x ^ 0xff))]),
    decryptBuffer: (b: Buffer) => Buffer.from(b.subarray(4).map((x) => x ^ 0xff)),
  };
});

const mkWin = (impl: (js: string) => Promise<unknown>): MediaCapturePage =>
  ({ webContents: { executeJavaScript: vi.fn((js: string) => impl(js)) } }) as unknown as MediaCapturePage;

const PNG_BYTES = Buffer.from('hello media bytes');
const PNG_DATA_URI = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
const PNG_SHA256 = createHash('sha256').update(PNG_BYTES).digest('hex');

// ---- 1. pure/injected-deps ----------------------------------------------

describe('cacheRemoteMedia: injected deps', () => {
  it('decoy host is rejected — no in-page fetch, cacheRemoteMedia returns null', async () => {
    const { cacheRemoteMedia } = await import('../src/main/x-listening/media');
    const exec = vi.fn(() => Promise.resolve(PNG_DATA_URI));
    const win = { webContents: { executeJavaScript: exec } } as unknown as MediaCapturePage;
    const writeBytes = vi.fn();

    // Substring decoy: host is actually evil.example, only the QUERY STRING mentions
    // pbs.twimg.com — a naive substring-match allowlist would admit this.
    const out = await cacheRemoteMedia(
      win,
      'https://evil.example/beacon.png?y=pbs.twimg.com/media',
      'case-a',
      { writeBytes }
    );

    expect(out).toBeNull();
    expect(exec).not.toHaveBeenCalled();
    expect(writeBytes).not.toHaveBeenCalled();
  });

  it('an on-allowlist host resolves and caches — returns a local ref (no http) + sha256', async () => {
    const { cacheRemoteMedia } = await import('../src/main/x-listening/media');
    const win = mkWin(() => Promise.resolve(PNG_DATA_URI));
    const writeBytes = vi.fn(async () => {});

    const out = await cacheRemoteMedia(win, 'https://pbs.twimg.com/media/a.jpg', 'case-a', {
      writeBytes,
    });

    expect(out).not.toBeNull();
    expect(out!.sha256).toBe(PNG_SHA256);
    expect(out!.ref).toBe(`x-media/${PNG_SHA256}`);
    expect(out!.ref.startsWith('http')).toBe(false);
    expect(out!.ref.startsWith('data:')).toBe(false);
    expect(writeBytes).toHaveBeenCalledTimes(1);
    const [caseIdArg, refArg, bytesArg] = writeBytes.mock.calls[0];
    expect(caseIdArg).toBe('case-a');
    expect(refArg).toBe(`x-media/${PNG_SHA256}`);
    expect(Buffer.isBuffer(bytesArg)).toBe(true);
    expect((bytesArg as Buffer).equals(PNG_BYTES)).toBe(true);
  });

  it('sha256 is the byte-hash of the DECODED bytes, not of the data: string — the media evidence hash', async () => {
    const { cacheRemoteMedia } = await import('../src/main/x-listening/media');
    const win = mkWin(() => Promise.resolve(PNG_DATA_URI));
    const out = await cacheRemoteMedia(win, 'https://x.com/c.png', 'case-a', {
      writeBytes: vi.fn(async () => {}),
    });

    const notByteHash = createHash('sha256').update(PNG_DATA_URI).digest('hex');
    expect(out!.sha256).not.toBe(notByteHash);
    expect(out!.sha256).toBe(PNG_SHA256);
  });

  it('returns null and never writes when resolveMedia (the page fetch) fails', async () => {
    const { cacheRemoteMedia } = await import('../src/main/x-listening/media');
    const win = mkWin(() => Promise.resolve(null));
    const writeBytes = vi.fn();

    const out = await cacheRemoteMedia(win, 'https://pbs.twimg.com/media/a.jpg', 'case-a', {
      writeBytes,
    });

    expect(out).toBeNull();
    expect(writeBytes).not.toHaveBeenCalled();
  });

  it('returns null and never writes on a malformed data: URI', async () => {
    const { cacheRemoteMedia } = await import('../src/main/x-listening/media');
    const win = mkWin(() => Promise.resolve('data:image/png,not-base64-at-all'));
    const writeBytes = vi.fn();

    const out = await cacheRemoteMedia(win, 'https://pbs.twimg.com/media/a.jpg', 'case-a', {
      writeBytes,
    });

    expect(out).toBeNull();
    expect(writeBytes).not.toHaveBeenCalled();
  });

  it('never returns a remote http(s) result even if resolveMedia is overridden to hand one back', async () => {
    const { cacheRemoteMedia } = await import('../src/main/x-listening/media');
    const win = mkWin(() => Promise.resolve(PNG_DATA_URI));
    const out = await cacheRemoteMedia(win, 'https://pbs.twimg.com/media/a.jpg', 'case-a', {
      // A hostile/misbehaving resolveMedia handing back a raw remote URL instead of data: —
      // decodeDataUri must reject it (not `data:`), so no ref is ever minted from it.
      resolveMedia: async () => 'https://evil.example/beacon.png',
      writeBytes: vi.fn(async () => {}),
    });
    expect(out).toBeNull();
  });

  it('passes the X media host allowlist into resolveMedia explicitly', async () => {
    const { cacheRemoteMedia } = await import('../src/main/x-listening/media');
    const win = mkWin(() => Promise.resolve(PNG_DATA_URI));
    const resolveMedia = vi.fn(async () => PNG_DATA_URI);

    await cacheRemoteMedia(win, 'https://pbs.twimg.com/media/a.jpg', 'case-a', {
      resolveMedia,
      writeBytes: vi.fn(async () => {}),
    });

    expect(resolveMedia).toHaveBeenCalledWith(
      win,
      'https://pbs.twimg.com/media/a.jpg',
      expect.arrayContaining(['pbs.twimg.com', 'abs.twimg.com', 'x.com', 'twitter.com'])
    );
  });

  it('scopes the write to the caseId passed in — two cases never collide on the same ref', async () => {
    const { cacheRemoteMedia } = await import('../src/main/x-listening/media');
    const win = mkWin(() => Promise.resolve(PNG_DATA_URI));
    const writeBytes = vi.fn(async () => {});

    await cacheRemoteMedia(win, 'https://pbs.twimg.com/media/a.jpg', 'case-a', { writeBytes });
    await cacheRemoteMedia(win, 'https://pbs.twimg.com/media/a.jpg', 'case-b', { writeBytes });

    expect(writeBytes.mock.calls[0][0]).toBe('case-a');
    expect(writeBytes.mock.calls[1][0]).toBe('case-b');
  });
});

// ---- 2. production wiring: ciphertext at rest ---------------------------

describe('cacheRemoteMedia: production writeBytes (secure-fs)', () => {
  beforeEach(async () => {
    await mkdir(DATA, { recursive: true });
  });
  afterEach(async () => {
    await rm(DATA, { recursive: true, force: true });
  });

  it('writes the cached media bytes as CIPHERTEXT under scrapingCaseDir(\'x\', caseId)/x-media/<sha256>', async () => {
    const { cacheRemoteMedia } = await import('../src/main/x-listening/media');
    const { scrapingCaseDir } = await import('../src/main/storage/paths');

    const win = mkWin(() => Promise.resolve(PNG_DATA_URI));
    const out = await cacheRemoteMedia(win, 'https://pbs.twimg.com/media/a.jpg', 'case-enc');

    expect(out).not.toBeNull();
    expect(out!.ref).toBe(`x-media/${PNG_SHA256}`);

    const onDiskPath = join(scrapingCaseDir('x', 'case-enc'), 'x-media', PNG_SHA256);
    const onDisk = await readFile(onDiskPath);
    expect(onDisk.subarray(0, 4).toString()).toBe('ENCX');           // encrypted envelope
    expect(onDisk.includes(PNG_BYTES)).toBe(false);                  // plaintext bytes absent
    expect(onDisk.equals(PNG_BYTES)).toBe(false);                    // not a plaintext passthrough
  });

  it('the cached file reads back to the exact original bytes once decrypted (secure-fs round-trip)', async () => {
    const { cacheRemoteMedia } = await import('../src/main/x-listening/media');
    const { scrapingCaseDir } = await import('../src/main/storage/paths');
    const { secureReadFile } = await import('../src/main/storage/secure-fs');

    const win = mkWin(() => Promise.resolve(PNG_DATA_URI));
    await cacheRemoteMedia(win, 'https://pbs.twimg.com/media/a.jpg', 'case-enc3');

    const onDiskPath = join(scrapingCaseDir('x', 'case-enc3'), 'x-media', PNG_SHA256);
    const back = await secureReadFile(onDiskPath);
    expect(back.equals(PNG_BYTES)).toBe(true);
  });
});
