/**
 * Jukebox library store. Persists remembered folder roots, indexed track metadata,
 * and saved internet-radio stations under dataRoot (secure-fs → vault-encrypted at
 * rest when login is enabled). The indexer walks the roots and parses embedded tags
 * with music-metadata (loaded via dynamic import — it is ESM-only and the main
 * process bundles to CJS, so a static import would not survive externalization).
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { dataRoot } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';
import type { MediaLibrarySnapshot, MediaStation, MediaTrack } from '@shared/post-mvp-types';

const file = (): string => join(dataRoot(), 'media-library.json');
const artDir = (): string => join(dataRoot(), 'media-art');
const EMPTY: MediaLibrarySnapshot = { roots: [], tracks: [], stations: [] };
const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus']);

async function read(): Promise<MediaLibrarySnapshot> {
  try {
    return { ...EMPTY, ...(JSON.parse(await secureReadText(file())) as Partial<MediaLibrarySnapshot>) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY };
    return { ...EMPTY };
  }
}

async function write(s: MediaLibrarySnapshot): Promise<void> {
  await secureWriteFile(file(), JSON.stringify(s, null, 2));
}

/** Test helper: reset the on-disk library to empty. */
export async function _resetForTest(): Promise<void> { await write({ ...EMPTY, tracks: [], stations: [], roots: [] }); }

export async function getSnapshot(): Promise<MediaLibrarySnapshot> { return read(); }
export async function getLibraryRoots(): Promise<string[]> { return (await read()).roots; }

export async function addRoot(root: string): Promise<MediaLibrarySnapshot> {
  const s = await read();
  if (!s.roots.includes(root)) s.roots.push(root);
  await write(s);
  return s;
}

export async function removeRoot(root: string): Promise<MediaLibrarySnapshot> {
  const s = await read();
  s.roots = s.roots.filter((r) => r !== root);
  s.tracks = s.tracks.filter((t) => !t.path.startsWith(root));
  await write(s);
  return s;
}

export async function upsertStation(input: { id?: string; label: string; url: string }): Promise<MediaStation> {
  const s = await read();
  const station: MediaStation = { id: input.id ?? randomUUID(), label: input.label, url: input.url };
  const i = s.stations.findIndex((x) => x.id === station.id);
  if (i >= 0) s.stations[i] = station; else s.stations.push(station);
  await write(s);
  return station;
}

export async function deleteStation(id: string): Promise<void> {
  const s = await read();
  s.stations = s.stations.filter((x) => x.id !== id);
  await write(s);
}

export async function setTracks(tracks: MediaTrack[]): Promise<void> {
  const s = await read();
  s.tracks = tracks;
  await write(s);
}

function extOf(name: string): string { return name.slice(name.lastIndexOf('.') + 1).toLowerCase(); }

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: import('node:fs').Dirent[];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && AUDIO_EXT.has(extOf(e.name))) yield full;
  }
}

// music-metadata is ESM-only; cache the dynamically-imported parser.
let parseFileFn: ((p: string, opts?: { duration?: boolean }) => Promise<{
  common: { title?: string; artist?: string; album?: string; picture?: { data: Uint8Array }[] };
  format: { duration?: number };
}>) | null = null;
async function getParseFile(): Promise<NonNullable<typeof parseFileFn>> {
  if (!parseFileFn) { const mm = await import('music-metadata'); parseFileFn = mm.parseFile as NonNullable<typeof parseFileFn>; }
  return parseFileFn;
}

/** Re-walk every root, parsing new or changed files (by mtime+size). Unchanged
 *  entries are reused. Unreadable tags degrade to a filename-only track. */
export async function refresh(): Promise<MediaLibrarySnapshot> {
  const s = await read();
  const prev = new Map(s.tracks.map((t) => [t.path, t]));
  const next: MediaTrack[] = [];
  for (const root of s.roots) {
    for await (const path of walk(root)) {
      const st = await stat(path);
      const old = prev.get(path);
      if (old && old.mtime === st.mtimeMs && old.size === st.size) { next.push(old); continue; }
      const track: MediaTrack = { path, mtime: st.mtimeMs, size: st.size };
      try {
        const parseFile = await getParseFile();
        const meta = await parseFile(path, { duration: true });
        track.title = meta.common.title;
        track.artist = meta.common.artist;
        track.album = meta.common.album;
        track.durationMs = meta.format.duration ? Math.round(meta.format.duration * 1000) : undefined;
        const pic = meta.common.picture?.[0];
        if (pic) {
          await mkdir(artDir(), { recursive: true });
          const ref = `${Math.round(st.mtimeMs).toString(36)}-${st.size.toString(36)}.img`;
          await writeFile(join(artDir(), ref), pic.data);
          track.artRef = ref;
        }
      } catch { /* unreadable/unsupported tags — keep the filename-only entry */ }
      next.push(track);
    }
  }
  s.tracks = next;
  await write(s);
  return s;
}
