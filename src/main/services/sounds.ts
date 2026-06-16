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
import { join } from 'node:path';

const MAIL_CHIME = 'mail-notify.wav';
// Upper bound on a user chime we will marshal over IPC as base64 (8 MB). Comfortably fits any sane
// jingle; rejects an accidental multi-hundred-MB drop.
const MAX_CHIME_BYTES = 8 * 1024 * 1024;

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
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.access(dest);
  } catch {
    // Not present — seed from the bundled default (best-effort).
    try { await fs.copyFile(join(resourceSoundsDir(), MAIL_CHIME), dest); } catch { /* seed best-effort */ }
  }
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
