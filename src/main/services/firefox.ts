/**
 * Firefox Portable launcher.
 *
 * The operator chose to replace the in-app <webview> browser with a bundled Firefox
 * Portable (full swap). This service is the ONLY place a browser process is spawned, and
 * it is deliberately narrow:
 *
 *  - It spawns ONLY the bundled executable resolved from the app's resources dir. A
 *    renderer-supplied path is never accepted — the renderer can pass a URL, nothing more.
 *  - The URL is validated (http/https only) before launch and passed as a single argv
 *    element with `shell: false`, so there is no shell-interpolation / argument-injection
 *    surface.
 *  - The child is detached + unref'd so closing Ghost Intel 98 doesn't kill the browser.
 *
 * The Firefox Portable payload itself is NOT vendored into the repo (a ~90 MB third-party
 * binary is a distribution/BOM decision for the operator). Drop it into `resources/firefox/`
 * and it ships via electron-builder's extraResources. Until then `status()` reports
 * `installed: false` and the UI shows setup guidance instead of failing opaquely.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app, shell } from 'electron';
import { validateExternalUrl, ValidationError } from '../security/validate';

/** Base dir that holds the bundled `firefox/` payload: resourcesPath when packaged,
 *  the project `resources/` dir in dev. */
function resourcesBase(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
}

/** Candidate executable layouts across the common Firefox Portable / platform shapes.
 *  Checked in order; the first that exists wins. All are RELATIVE to resourcesBase()/firefox. */
const CANDIDATES = [
  'FirefoxPortable.exe',
  'firefox.exe',
  join('App', 'Firefox64', 'firefox.exe'),
  join('App', 'Firefox', 'firefox.exe'),
  join('Firefox.app', 'Contents', 'MacOS', 'firefox'), // macOS
  'firefox' // Linux
];

/** Absolute path to the bundled Firefox executable, or null if no payload is present. */
export function resolveExecutable(): string | null {
  const root = join(resourcesBase(), 'firefox');
  for (const rel of CANDIDATES) {
    const abs = join(root, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}

/** The directory the Firefox Portable payload must live in (resources/firefox/). */
export function firefoxDir(): string {
  return join(resourcesBase(), 'firefox');
}

/**
 * Open the resources/firefox/ folder in the OS file manager so the user can drop the Firefox
 * Portable files into the right place without hunting for the path. Creates the folder first
 * (best-effort — when packaged it may sit under a read-only install dir needing elevation, in
 * which case we open the parent resources/ dir instead). Returns the path that was opened.
 */
export async function revealFirefoxDir(): Promise<string> {
  const dir = firefoxDir();
  try { await mkdir(dir, { recursive: true }); } catch { /* read-only install dir (Program Files) */ }
  const target = existsSync(dir) ? dir : resourcesBase();
  const err = await shell.openPath(target);
  if (err) throw new Error(err);
  return target;
}

export interface FirefoxStatus {
  installed: boolean;
  /** Absolute path to the resolved executable, or null. Surfaced so the UI can show it. */
  path: string | null;
  /** The folder the payload belongs in — shown in the UI's setup guidance. */
  dir: string;
}

export function status(): FirefoxStatus {
  const path = resolveExecutable();
  return { installed: path !== null, path, dir: firefoxDir() };
}

/**
 * Launch the bundled Firefox with `rawUrl`. Throws synchronously (ValidationError) on a
 * bad/non-http(s) URL or a plain Error when no payload is bundled. The returned promise
 * rejects if the process fails to spawn (e.g. a corrupt/partial payload) and resolves only
 * once the child has actually spawned — so the caller can avoid claiming success / recording
 * history for a launch that never happened (red-team M1).
 */
export function launch(rawUrl: string): Promise<void> {
  const url = validateExternalUrl(rawUrl); // http/https (or mailto) only; rejects file:/js:
  if (!/^https?:\/\//i.test(url)) {
    throw new ValidationError('Only http(s) URLs can be opened in Firefox');
  }
  const exe = resolveExecutable();
  if (!exe) {
    throw new Error(
      "Firefox Portable isn't installed yet. Add the Firefox Portable files to resources/firefox/ and rebuild."
    );
  }
  return new Promise<void>((resolve, reject) => {
    // shell:false (default) + URL as a single argv element ⇒ no shell-injection surface.
    const child = spawn(exe, [url], { detached: true, stdio: 'ignore' });
    let settled = false;
    child.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
    child.on('spawn', () => { if (!settled) { settled = true; child.unref(); resolve(); } });
  });
}
