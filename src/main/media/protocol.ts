/**
 * ga98media:// — privileged custom protocol for local audio playback.
 *
 * SECURITY: this is the only bridge between a renderer-supplied URL and the
 * filesystem. `isAuthorizedMediaPath` is the gate: a path is served only if its
 * realpath (symlinks resolved) lives inside a remembered library root OR is in the
 * session ad-hoc allowlist. Everything else fails closed. The handler (added in a
 * later task) calls this before opening any stream.
 */

import { createReadStream, realpathSync, statSync } from 'node:fs';
import { sep } from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { getLibraryRoots } from './library';
import { isEncryptedFile } from '../storage/secure-fs';
import * as vault from '../services/vault';

/**
 * True iff `candidate` resolves (realpath, following symlinks) to a path that is
 * inside one of `roots`, OR whose realpath is present in `allowlist`. Any error
 * (missing file, unreadable root) results in `false` — fail closed.
 */
export function isAuthorizedMediaPath(candidate: string, roots: string[], allowlist: Set<string>): boolean {
  let real: string;
  try { real = realpathSync(candidate); } catch { return false; }
  if (allowlist.has(real)) return true;
  for (const root of roots) {
    let realRoot: string;
    try { realRoot = realpathSync(root); } catch { continue; }
    // Reject empty / filesystem-root roots: a '' or '/' entry (corruption / bad migration)
    // would make every path "inside" a root → universal authorization (red-team H2).
    if (realRoot.length <= 1) continue;
    const prefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
    if (real === realRoot || real.startsWith(prefix)) return true;
  }
  return false;
}

/** Realpaths the user authorized this session via "Open files…" / "Load playlist…".
 *  Lets ad-hoc files outside the remembered roots play, without widening the roots. */
export const adHocAllowlist = new Set<string>();

const MIME: Record<string, string> = {
  // audio
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  // video — streamed for the in-app doc viewer (large case-attachment playback)
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
  mov: 'video/quicktime', mkv: 'video/x-matroska'
};
function mimeFor(p: string): string {
  return MIME[p.slice(p.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
}

/** Decode ga98media://track/<encodeURIComponent(absPath)> → absolute path. */
function pathFromRequest(url: string): string | null {
  try { return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')); }
  catch { return null; }
}

/** Register the ga98media:// handler. Call once, after app is ready. Streams local
 *  audio with HTTP range support, but only for authorized paths (fail closed). */
export function registerMediaProtocol(): void {
  protocol.handle('ga98media', async (request) => {
    const p = pathFromRequest(request.url);
    if (!p) return new Response('bad request', { status: 400 });
    // Resolve to a realpath ONCE and authorize + stat + stream that same path, so a symlink
    // swapped between check and open can't redirect the read (TOCTOU hardening, red-team L6).
    let real: string;
    try { real = realpathSync(p); } catch { return new Response('not found', { status: 404 }); }
    const roots = await getLibraryRoots();
    if (!isAuthorizedMediaPath(real, roots, adHocAllowlist)) return new Response('forbidden', { status: 403 });

    // Defence-in-depth (red-team C1): this protocol is registered at app level, NOT behind the
    // IPC vault gate, and streams raw bytes. So enforce the vault state HERE too — refuse while
    // enabled-but-locked, and never stream an encrypted blob (whole-file GCM ⇒ ciphertext).
    if (vault.isEnabledCached() && !vault.isUnlocked()) return new Response('locked', { status: 403 });
    try { if (await isEncryptedFile(real)) return new Response('forbidden', { status: 403 }); }
    catch { return new Response('not found', { status: 404 }); }

    let size: number;
    try { size = statSync(real).size; } catch { return new Response('not found', { status: 404 }); }

    const range = request.headers.get('range');
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (m) {
      let start: number;
      let end: number;
      if (m[1] === '' && m[2] !== '') {
        // Suffix range `bytes=-N` ⇒ the last N bytes (HTTP semantics).
        const n = parseInt(m[2], 10);
        start = Math.max(0, size - n);
        end = size - 1;
      } else {
        start = m[1] ? parseInt(m[1], 10) : 0;
        end = m[2] ? parseInt(m[2], 10) : size - 1;
      }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) {
        return new Response('range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
      return new Response(Readable.toWeb(createReadStream(real, { start, end })) as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': mimeFor(real),
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes'
        }
      });
    }
    return new Response(Readable.toWeb(createReadStream(real)) as ReadableStream, {
      status: 200,
      headers: { 'Content-Type': mimeFor(real), 'Content-Length': String(size), 'Accept-Ranges': 'bytes' }
    });
  });
}
