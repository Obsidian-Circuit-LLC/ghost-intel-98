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
import { app } from 'electron';
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

/** Shared scan: complete, JSON-valid `<name>.onnx`+`.onnx.json` pairs in deps.dir, mapped to
 *  {id,name} via nameOf, optionally excluding one id, sorted by name. Missing dir → []. Never throws. */
async function scanVoices(deps: VoicesDeps, nameOf: (file: string) => string, excludeId?: string): Promise<{ id: string; name: string }[]> {
  let entries: string[];
  try { entries = await deps.readdir(deps.dir); }
  catch { return []; }
  const set = new Set(entries);
  const out: { id: string; name: string }[] = [];
  for (const e of entries) {
    if (!e.endsWith('.onnx')) continue;
    if (excludeId && e === excludeId) continue;
    if (!set.has(`${e}.json`)) continue;
    try { JSON.parse(await deps.readText(join(deps.dir, `${e}.json`))); }
    catch { continue; }
    out.push({ id: e, name: nameOf(e) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const stripOnnx = (file: string): string => file.slice(0, -'.onnx'.length);

export async function listUserVoices(deps: VoicesDeps = realVoicesDeps()): Promise<{ id: string; name: string }[]> {
  return scanVoices(deps, stripOnnx);
}

export async function resolveUserModelPath(voiceId: string | null | undefined, deps: VoicesDeps = realVoicesDeps()): Promise<string | null> {
  if (!voiceId) return null;
  const hit = (await listUserVoices(deps)).find((v) => v.id === voiceId);
  return hit ? join(deps.dir, hit.id) : null;
}

// ---- Bundled voices (shipped in resources/piper/<platform>/) ----

/** The default shipped voice (public-domain). Selected when piperVoice is null/''. */
export const DEFAULT_BUNDLED_ID = 'en_US-ljspeech-high.onnx';

/** Friendly display names for the bundled voices; unknown ids fall back to the filename. */
const BUNDLED_NAMES: Record<string, string> = {
  'en_US-ljspeech-high.onnx': 'Bundled neural (LJ Speech)',
  'jarvis-medium.onnx': 'Jarvis',
  'hal.onnx': 'HAL 9000',
  'wheatley1.onnx': 'Wheatley',
  'en_US-glados-high.onnx': 'GLaDOS'
};

function platformDir(): string {
  if (process.platform === 'win32') return 'win-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  return 'linux-x64';
}
export function bundledVoicesDir(): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  return join(base, 'piper', platformDir());
}
function realBundledDeps(): VoicesDeps {
  const dir = bundledVoicesDir();
  return { dir, readdir: (p) => readdir(p), readText: (p) => readFile(p, 'utf8') };
}

/** Bundled voices for the picker — friendly names, the default EXCLUDED (it's the picker's default
 *  option). Same validation/traversal posture as user voices. */
export async function listBundledVoices(deps: VoicesDeps = realBundledDeps()): Promise<{ id: string; name: string }[]> {
  return scanVoices(deps, (f) => BUNDLED_NAMES[f] ?? stripOnnx(f), DEFAULT_BUNDLED_ID);
}

/** Resolve a bundled voice id (incl. the default id) to a path, or null. Traversal-safe: scans the
 *  bundled dir and only joins an id that matches a scanned basename. */
export async function resolveBundledModelPath(voiceId: string | null | undefined, deps: VoicesDeps = realBundledDeps()): Promise<string | null> {
  if (!voiceId) return null;
  const all = await scanVoices(deps, stripOnnx); // no exclude — the default id must resolve too
  return all.some((v) => v.id === voiceId) ? join(deps.dir, voiceId) : null;
}
