/**
 * Bookmarks dashboard store — an offline, start.me-style board of categorized links.
 *
 * Persisted under dataRoot via secure-fs (vault-encrypted at rest when login is enabled), like
 * case data: a user's link graph is OpSec-sensitive and shouldn't sit in plaintext. The board is
 * also exported/imported as a portable .ghostbookmarks file for sharing between users.
 *
 * The ONLY network egress this module can do is favicon fetching, gated behind the board's
 * `networkEnabled` flag (off by default) and re-guarded against SSRF on every redirect hop —
 * mirroring the GeoINT source fetch posture.
 */

import { join } from 'node:path';
import { dataRoot } from './paths';
import { secureReadText, secureWriteFile } from './secure-fs';
import { isPublicHttpUrl } from '../security/validate';
import type { BookmarkBoard } from '@shared/post-mvp-types';

const EMPTY: BookmarkBoard = { categories: [], networkEnabled: false };
const boardFile = (): string => join(dataRoot(), 'bookmarks-board.json');
const MAX_FAVICON_BYTES = 256 * 1024;

export async function read(): Promise<BookmarkBoard> {
  try {
    const parsed = JSON.parse(await secureReadText(boardFile())) as Partial<BookmarkBoard>;
    return { categories: parsed.categories ?? [], networkEnabled: parsed.networkEnabled === true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY };
    return { ...EMPTY };
  }
}

/** Persist a board (already validated/clamped at the IPC boundary by ensureBookmarkBoard). */
export async function write(board: BookmarkBoard): Promise<void> {
  await secureWriteFile(boardFile(), JSON.stringify(board, null, 2));
}

export async function _resetForTest(): Promise<void> { await write({ ...EMPTY }); }

/** Fetch following redirects manually, re-validating each hop against the public-URL guard so a
 *  site can't 30x-redirect us inward (SSRF / cloud metadata). */
async function safeFetch(url: string, maxHops = 4): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < maxHops; hop += 1) {
    if (!isPublicHttpUrl(current)) throw new Error('refusing to fetch a non-public URL');
    // Bound each hop with a timeout so a slow/never-responding host can't hang the main process.
    const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

/**
 * Fetch a site's favicon and return it as a data: URI, or null. Network egress: only runs when
 * the persisted board has networkEnabled=true (the egress gate). SSRF-guarded, image-only,
 * size-capped. Never throws — returns null on any failure so the UI degrades to a glyph/emoji.
 */
export async function fetchFavicon(pageUrl: string): Promise<string | null> {
  const board = await read();
  if (!board.networkEnabled) return null;
  if (!isPublicHttpUrl(pageUrl)) return null;
  let origin: string;
  try { origin = new URL(pageUrl).origin; } catch { return null; }
  try {
    const res = await safeFetch(`${origin}/favicon.ico`);
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    // Raster images only — exclude svg (script/remote-ref carrier) to match the board validator.
    if (!ct.startsWith('image/') || ct.includes('svg')) return null;
    // Reject up front if the server declares an oversized body, so we don't buffer it at all.
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_FAVICON_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_FAVICON_BYTES) return null;
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
