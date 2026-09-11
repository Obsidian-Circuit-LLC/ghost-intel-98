/**
 * External Apps — `app.json` manifest parsing.
 *
 * A manifest is untrusted input: it sits in a user-writable drop folder, so a malicious or simply
 * broken file must never crash the scan (`ok: false` + a readable reason, never a throw) and must
 * never point outside the folder it was found in ("../../evil.exe", an absolute system path). Both
 * `executable` and `workingDirectory` are resolved and re-checked against the folder they came
 * from — the one thing this module exists to enforce.
 */
import { extname, resolve, sep } from 'node:path';
import type { ExternalProgramManifest } from '@shared/external-programs/types';

export type ManifestResult =
  | { ok: true; manifest: ExternalProgramManifest; executableAbsPath: string }
  | { ok: false; error: string };

const ALLOWED_EXTENSIONS = new Set(['.exe', '.bat', '.cmd']);

/** Resolve `rel` against `folderAbsPath` and refuse anything that lands outside it — the ONLY
 *  traversal check in this module; every path field routes through here. */
function resolveWithinFolder(folderAbsPath: string, rel: string): string | null {
  const base = resolve(folderAbsPath);
  const resolved = resolve(base, rel);
  if (resolved === base) return resolved;
  if (!resolved.startsWith(base + sep)) return null;
  return resolved;
}

export function parseManifest(json: string, folderAbsPath: string): ManifestResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'app.json is not valid JSON' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'app.json must be a JSON object' };
  }
  const o = data as Record<string, unknown>;

  if (typeof o.executable !== 'string' || !o.executable.trim()) {
    return { ok: false, error: 'app.json is missing a string "executable" field' };
  }
  const executableAbsPath = resolveWithinFolder(folderAbsPath, o.executable);
  if (!executableAbsPath) {
    return { ok: false, error: `"executable" (${o.executable}) escapes its own folder` };
  }
  const ext = extname(executableAbsPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: `"executable" must end in .exe, .bat or .cmd (got "${ext || o.executable}")` };
  }

  const manifest: ExternalProgramManifest = { executable: o.executable };
  if (typeof o.name === 'string' && o.name.trim()) manifest.name = o.name.trim();
  if (typeof o.icon === 'string' && o.icon.trim()) manifest.icon = o.icon;
  if (typeof o.category === 'string' && o.category.trim()) manifest.category = o.category.trim();
  if (typeof o.description === 'string' && o.description.trim()) manifest.description = o.description.trim();
  if (Array.isArray(o.arguments) && o.arguments.every((a) => typeof a === 'string')) {
    manifest.arguments = o.arguments as string[];
  }
  if (typeof o.workingDirectory === 'string' && o.workingDirectory.trim()) {
    if (!resolveWithinFolder(folderAbsPath, o.workingDirectory)) {
      return { ok: false, error: `"workingDirectory" (${o.workingDirectory}) escapes its own folder` };
    }
    manifest.workingDirectory = o.workingDirectory;
  }

  return { ok: true, manifest, executableAbsPath };
}
