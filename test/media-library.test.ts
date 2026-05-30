import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// dataRoot() resolves from app.getPath('userData'); point it at a temp dir.
const DATA = mkdtempSync(join(tmpdir(), 'ga98-media-'));
vi.mock('electron', () => ({ app: { getPath: () => DATA } }));

import * as lib from '../src/main/media/library';

beforeEach(async () => { await lib._resetForTest(); });

describe('media library store', () => {
  it('starts empty and persists roots', async () => {
    expect((await lib.getSnapshot()).roots).toEqual([]);
    const music = mkdtempSync(join(tmpdir(), 'ga98-music-'));
    await lib.addRoot(music);
    expect(await lib.getLibraryRoots()).toContain(music);
  });

  it('upserts and deletes stations', async () => {
    const s = await lib.upsertStation({ label: 'SomaFM', url: 'http://ice.somafm.com/groovesalad' });
    expect(s.id).toBeTruthy();
    expect((await lib.getSnapshot()).stations).toHaveLength(1);
    await lib.deleteStation(s.id);
    expect((await lib.getSnapshot()).stations).toHaveLength(0);
  });

  it('indexes audio files in a root, ignores non-audio, degrades gracefully on bad tags', async () => {
    const music = mkdtempSync(join(tmpdir(), 'ga98-music-'));
    mkdirSync(join(music, 'sub'));
    writeFileSync(join(music, 'a.mp3'), 'not-a-real-mp3');       // parse fails → filename entry
    writeFileSync(join(music, 'sub', 'b.flac'), 'nope');         // nested, indexed
    writeFileSync(join(music, 'notes.txt'), 'ignore me');        // non-audio, skipped
    await lib.addRoot(music);
    const snap = await lib.refresh();
    const paths = snap.tracks.map((t) => t.path).sort();
    expect(paths).toEqual([join(music, 'a.mp3'), join(music, 'sub', 'b.flac')].sort());
    expect(snap.tracks.every((t) => t.title === undefined)).toBe(true); // junk files → no tags, no crash
  });

  it('removeRoot purges that root\'s tracks', async () => {
    const music = mkdtempSync(join(tmpdir(), 'ga98-music-'));
    writeFileSync(join(music, 'a.mp3'), 'x');
    await lib.addRoot(music);
    await lib.refresh();
    expect((await lib.getSnapshot()).tracks).toHaveLength(1);
    await lib.removeRoot(music);
    const snap = await lib.getSnapshot();
    expect(snap.roots).toHaveLength(0);
    expect(snap.tracks).toHaveLength(0);
  });

  it('reuses unchanged entries on re-index (mtime+size match)', async () => {
    const music = mkdtempSync(join(tmpdir(), 'ga98-music-'));
    const f = join(music, 'a.mp3');
    writeFileSync(f, 'x');
    utimesSync(f, new Date('2020-01-01'), new Date('2020-01-01'));
    await lib.addRoot(music);
    const first = await lib.refresh();
    const second = await lib.refresh();
    expect(second.tracks).toEqual(first.tracks);
  });
});
