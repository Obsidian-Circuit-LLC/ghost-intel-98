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
    const prefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
    if (real === realRoot || real.startsWith(prefix)) return true;
  }
  return false;
}

/** Realpaths the user authorized this session via "Open files…" / "Load playlist…".
 *  Lets ad-hoc files outside the remembered roots play, without widening the roots. */
export const adHocAllowlist = new Set<string>();

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg'
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
    const roots = await getLibraryRoots();
    if (!isAuthorizedMediaPath(p, roots, adHocAllowlist)) return new Response('forbidden', { status: 403 });

    let size: number;
    try { size = statSync(p).size; } catch { return new Response('not found', { status: 404 }); }

    const range = request.headers.get('range');
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) {
        return new Response('range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
      return new Response(Readable.toWeb(createReadStream(p, { start, end })) as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': mimeFor(p),
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes'
        }
      });
    }
    return new Response(Readable.toWeb(createReadStream(p)) as ReadableStream, {
      status: 200,
      headers: { 'Content-Type': mimeFor(p), 'Content-Length': String(size), 'Accept-Ranges': 'bytes' }
    });
  });
}
