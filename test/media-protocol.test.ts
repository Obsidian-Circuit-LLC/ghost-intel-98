import { describe, it, expect } from 'vitest';
import { realpathSync, mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAuthorizedMediaPath } from '../src/main/media/protocol';

describe('ga98media path confinement', () => {
  // realpathSync the tmp roots: macOS /tmp is itself a symlink, so the predicate's
  // realpath of a child would otherwise never match an un-resolved root string.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ga98-lib-')));
  const inside = join(root, 'song.mp3'); writeFileSync(inside, 'x');
  const sub = join(root, 'sub'); mkdirSync(sub);
  const nested = join(sub, 'a.flac'); writeFileSync(nested, 'x');

  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'ga98-out-')));
  const secret = join(outside, 'secret.mp3'); writeFileSync(secret, 'x');

  const evil = join(root, 'link.mp3'); symlinkSync(secret, evil); // symlink escaping the root

  it('accepts files inside a remembered root (including nested)', () => {
    expect(isAuthorizedMediaPath(inside, [root], new Set())).toBe(true);
    expect(isAuthorizedMediaPath(nested, [root], new Set())).toBe(true);
  });

  it('rejects files outside every root and not allowlisted', () => {
    expect(isAuthorizedMediaPath(secret, [root], new Set())).toBe(false);
  });

  it('rejects a symlink that resolves outside the root', () => {
    expect(isAuthorizedMediaPath(evil, [root], new Set())).toBe(false);
  });

  it('rejects traversal even when the string is prefixed by a root', () => {
    expect(isAuthorizedMediaPath(join(root, '..'), [root], new Set())).toBe(false);
  });

  it('rejects a sibling root whose name shares a prefix (no substring escape)', () => {
    const twin = realpathSync(mkdtempSync(join(tmpdir(), 'ga98-lib-'))); // different dir
    const f = join(twin, 'x.mp3'); writeFileSync(f, 'x');
    // `twin` is NOT `root`; even if string-prefixed, membership must use a path boundary.
    expect(isAuthorizedMediaPath(f, [root], new Set())).toBe(false);
  });

  it('accepts an explicitly allowlisted ad-hoc file (by realpath)', () => {
    expect(isAuthorizedMediaPath(secret, [root], new Set([realpathSync(secret)]))).toBe(true);
  });

  it('returns false for a non-existent path (fail closed)', () => {
    expect(isAuthorizedMediaPath(join(root, 'nope.mp3'), [root], new Set())).toBe(false);
  });
});
