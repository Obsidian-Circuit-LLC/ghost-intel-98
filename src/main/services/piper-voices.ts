/**
 * User-supplied Piper voices. The user drops a `<name>.onnx` + `<name>.onnx.json` pair into
 * <dataRoot>/voices/; this module scans + validates them and resolves a chosen voice id to a model
 * path. The renderer is untrusted, so resolveUserModelPath is TRAVERSAL-SAFE: it accepts an id only
 * when it exactly matches a basename we discovered by scanning the dir, and joins that discovered
 * name — never raw renderer input. fs deps are injected for unit testing; realVoicesDeps() wires the
 * vault path + node:fs (evaluated per-call, so dataRoot()/Electron is never touched at import time).
 */
import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { dataRoot } from '../storage/paths';

export interface VoicesDeps {
  dir: string;
  readdir(path: string): Promise<string[]>;
  readText(path: string): Promise<string>;
}

export function userVoicesDir(): string {
  return join(dataRoot(), 'voices');
}

export function realVoicesDeps(): VoicesDeps {
  const dir = userVoicesDir();
  return { dir, readdir: (p) => readdir(p), readText: (p) => readFile(p, 'utf8') };
}

/** Scan the voices dir for complete, JSON-valid voice pairs. Missing/unreadable dir → []. Never
 *  throws. id = the `.onnx` filename; name = that filename without the `.onnx` extension. */
export async function listUserVoices(deps: VoicesDeps = realVoicesDeps()): Promise<{ id: string; name: string }[]> {
  let entries: string[];
  try { entries = await deps.readdir(deps.dir); }
  catch { return []; }
  const set = new Set(entries);
  const out: { id: string; name: string }[] = [];
  for (const e of entries) {
    if (!e.endsWith('.onnx')) continue;
    if (!set.has(`${e}.json`)) continue;
    try { JSON.parse(await deps.readText(join(deps.dir, `${e}.json`))); }
    catch { continue; } // unreadable / non-JSON sidecar → skip
    out.push({ id: e, name: e.slice(0, -'.onnx'.length) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve a chosen voice id to a model path, or null. Traversal-safe: only ids that match a
 *  scanned basename resolve (to a path WE construct); anything else (unknown, '', '../…', absolute)
 *  → null, so the caller falls back to the bundled voice. */
export async function resolveUserModelPath(voiceId: string | null | undefined, deps: VoicesDeps = realVoicesDeps()): Promise<string | null> {
  if (!voiceId) return null;
  const hit = (await listUserVoices(deps)).find((v) => v.id === voiceId);
  return hit ? join(deps.dir, hit.id) : null;
}
