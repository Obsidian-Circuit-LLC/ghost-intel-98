import { createHash } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';

export interface DownloadProgress { receivedBytes: number; totalBytes: number | null; }

/** Stream `url` to `dest`, verifying sha256. The ONLY network-egress site in the local-AI feature.
 *  On any failure (HTTP error, hash mismatch) the partial file is removed and the call rejects. */
export async function downloadVerified(
  url: string,
  dest: string,
  expectedSha256: string,
  onProgress: (p: DownloadProgress) => void
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`);
  const totalBytes = res.headers.get('content-length') ? Number(res.headers.get('content-length')) : null;
  const part = `${dest}.part`;
  const hash = createHash('sha256');
  const out = createWriteStream(part);
  let received = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.byteLength;
      await new Promise<void>((resolve, reject) => out.write(value, (e) => (e ? reject(e) : resolve())));
      onProgress({ receivedBytes: received, totalBytes });
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error) => (e ? reject(e) : resolve())));
    const got = hash.digest('hex');
    if (got !== expectedSha256.toLowerCase()) throw new Error(`sha256 mismatch (expected ${expectedSha256}, got ${got}).`);
    await rename(part, dest);
  } catch (err) {
    out.destroy();
    await rm(part, { force: true });
    throw err;
  }
}
