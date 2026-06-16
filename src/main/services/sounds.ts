/**
 * User-replaceable sounds. The "You've got mail" chime lives in a user-writable folder
 * (`<userData>/sounds/`) so anyone can swap it for their own jingle — the shipped default is a small
 * synthesized placeholder; users just overwrite the file. The folder is seeded from the bundled
 * default (resources/sounds, shipped via electron-builder extraResources) on first use. The renderer
 * loads the bytes over IPC and plays them via a blob URL (media-src already permits blob:).
 *
 * Security: the filename is a fixed constant (no path comes from the renderer), so there is no path
 * traversal surface; openSoundsFolder opens only the app-managed sounds directory. A size cap bounds
 * the base64 the renderer will receive so a pathologically large replacement file can't be marshalled
 * across IPC — over the cap we return null and the renderer falls back to its bundled chime.
 */
import { app, shell } from 'electron';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const MAIL_CHIME = 'mail-notify.wav';
// Upper bound on a user chime we will marshal over IPC as base64 (8 MB). Comfortably fits any sane
// jingle; rejects an accidental multi-hundred-MB drop.
const MAX_CHIME_BYTES = 8 * 1024 * 1024;

// SHA-256 of every PRIOR shipped default chime. ensureMailChime re-seeds the current default over a
// userData copy whose hash is in this set — fixing installs that seeded an OLD default and would
// otherwise keep it forever (ensureMailChime only ever copied when the file was ABSENT). A user's own
// custom chime hashes to NONE of these, so it is never touched. Self-limiting: once overwritten to the
// current good default (not in this set), it is left alone on every future launch.
//   - de26a67…: the original 9.9KB synth placeholder (beta.11 seed)
//   - b0479d1…: calm_male.wav at 192kHz WAVE_FORMAT_EXTENSIBLE (beta.12+) — did not decode in the
//               renderer <audio>, so the chime was silent; replaced by a 44.1kHz 16-bit PCM re-encode.
const STALE_DEFAULT_HASHES = new Set([
  'de26a6726130fedd92a220dce0246b8f0d1ab3b1b040ec56800f99903259a679',
  'b0479d199a4341839ae14fa1aff318ce2be5ee09150bcff2afeb6b72774dea16'
]);

/** User-writable sounds folder. */
export function soundsDir(): string {
  return join(app.getPath('userData'), 'sounds');
}

/** Bundled defaults: process.resourcesPath in production, repo resources/ in dev. */
function resourceSoundsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'sounds') : join(app.getAppPath(), 'resources', 'sounds');
}

/**
 * Ensure the sounds folder exists and the mail chime is present, seeding from the bundled default if
 * the user has not placed one. Returns the absolute chime path (which may still be absent if seeding
 * failed). Best-effort: never throws.
 */
export async function ensureMailChime(): Promise<string> {
  const dir = soundsDir();
  const dest = join(dir, MAIL_CHIME);
  const src = join(resourceSoundsDir(), MAIL_CHIME);
  try {
    await fs.mkdir(dir, { recursive: true });
    let existing: Buffer | null = null;
    try { existing = await fs.readFile(dest); } catch { existing = null; }
    if (existing === null) {
      // Absent — seed from the bundled default.
      try { await fs.copyFile(src, dest); } catch { /* seed best-effort */ }
    } else {
      // Present — replace ONLY if it's an unmodified prior default (a known-stale hash). A user's own
      // chime is left untouched. This repairs installs stuck on the old non-decoding 192kHz default.
      const hash = createHash('sha256').update(existing).digest('hex');
      if (STALE_DEFAULT_HASHES.has(hash)) {
        try { await fs.copyFile(src, dest); } catch { /* best-effort */ }
      }
    }
  } catch { /* never throw to a caller */ }
  return dest;
}

/**
 * Read the mail chime as base64 (+ mime). Returns null when it cannot be read or exceeds the size
 * cap, so the renderer falls back to its bundled asset.
 */
export async function readMailChime(): Promise<{ base64: string; mime: string } | null> {
  try {
    const path = await ensureMailChime();
    const stat = await fs.stat(path);
    if (stat.size > MAX_CHIME_BYTES) return null;
    const buf = await fs.readFile(path);
    return { base64: buf.toString('base64'), mime: 'audio/wav' };
  } catch {
    return null;
  }
}

/** Open the sounds folder in the OS file manager so the user can drop in their own chime. */
export async function openSoundsFolder(): Promise<void> {
  await ensureMailChime();
  const err = await shell.openPath(soundsDir());
  if (err) throw new Error(err);
}
