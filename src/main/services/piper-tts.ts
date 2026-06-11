/**
 * Piper TTS sidecar (main process) — synthesizes text → WAV entirely OFFLINE by spawning the bundled
 * Piper binary. No network, binds nothing; the voice model is bundled so there is no download path.
 * EVERYTHING here is local: text in (stdin), WAV out (stdout). Pure decisions live in piper-core.ts.
 *
 * Resource layout (populated by scripts/fetch-piper.mjs, shipped via extraResources):
 *   resources/piper/<platform>/piper(.exe)
 *   resources/piper/<platform>/<voice>.onnx  (+ <voice>.onnx.json)
 */
import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { buildPiperArgs, rateToLengthScale, isValidWavHeader, verifySha256 } from './piper-core';

/** Pinned SHA-256 of the bundled binary (lowercase hex) — verify-before-exec. This is the hash of
 *  the Windows `piper.exe` from rhasspy/piper 2023.11.14-2 (piper_windows_amd64.zip). On non-Windows
 *  dev hosts the binary differs, so the gate only applies to the win32 binary; other platforms (used
 *  for manual dev smoke only) skip it. Bump together with scripts/fetch-piper.mjs. */
const PINNED_BINARY_SHA256 = process.platform === 'win32'
  ? '96f3da3811151580073e40bb4dd20eb0fb8115f5f5f76e2fb54282b3edfa5c1f'
  : '';

/** Per-chunk synthesis timeout — bounds a wedged process. High-quality synth of one sentence-sized
 *  chunk is well under this. */
const SYNTH_TIMEOUT_MS = 30_000;
const MAX_SYNTH_BYTES = 32 * 1024 * 1024; // reject a runaway/oversized synthesized WAV

interface Resolved {
  binary: string;
  model: string;
}
let resolved: Resolved | null = null;
let resolveTried = false;
const active = new Set<ChildProcess>();

function platformDir(): string {
  if (process.platform === 'win32') return 'win-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  return 'linux-x64';
}
function piperDir(): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  return join(base, 'piper', platformDir());
}
function binaryName(): string {
  return process.platform === 'win32' ? 'piper.exe' : 'piper';
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

/** Resolve + verify the binary and discover the bundled voice model (first *.onnx with its .json
 *  sidecar). Cached. Returns null if anything is missing or the binary fails the hash gate. */
async function resolvePaths(): Promise<Resolved | null> {
  if (resolved) return resolved;
  if (resolveTried) return null;
  resolveTried = true;
  const dir = piperDir();
  const binary = join(dir, binaryName());
  if (!(await exists(binary))) return null;
  if (PINNED_BINARY_SHA256) {
    try {
      const bytes = new Uint8Array(await readFile(binary));
      if (!verifySha256(bytes, PINNED_BINARY_SHA256)) return null; // verify-before-exec, fail-closed
    } catch {
      return null;
    }
  }
  let model: string | null = null;
  try {
    const entries = await readdir(dir);
    const onnx = entries.find((e) => e.endsWith('.onnx'));
    if (onnx && entries.includes(`${onnx}.json`)) model = join(dir, onnx);
  } catch {
    return null;
  }
  if (!model) return null;
  resolved = { binary, model };
  return resolved;
}

/** True if a usable Piper binary + voice model are present (and the binary passes the hash gate). */
export async function piperAvailable(): Promise<boolean> {
  return (await resolvePaths()) !== null;
}
export function piperStatus(): Promise<{ available: boolean }> {
  return piperAvailable().then((available) => ({ available }));
}

/** Synthesize one (already-chunked) text into WAV bytes. Throws if Piper is unavailable, the process
 *  fails/times out, or the output isn't a valid WAV.
 *
 *  Piper writes to a real (SEEKABLE) temp file via `--output_file <path>`, NOT to stdout. When Piper
 *  streams a WAV to a non-seekable pipe (`--output_file -`) it can't seek back to patch the RIFF /
 *  `data` chunk length fields, so they're left wrong; the renderer's Web Audio decoder then reads past
 *  the real PCM and lays static OVER the (still-intelligible) voice. A seekable file gets correct
 *  headers — the same path that sounds clean when you run Piper natively to a `.wav`. The temp file is
 *  read once and deleted immediately on every exit path (success, error, timeout, cancel). */
export async function synthesize(text: string, rate?: number): Promise<Uint8Array> {
  const r = await resolvePaths();
  if (!r) throw new Error('Piper voice is not installed.');
  const tmp = join(app.getPath('temp'), `ga98-piper-${randomUUID().slice(0, 8)}.wav`);
  const args = buildPiperArgs(r.model, rateToLengthScale(rate), tmp);

  return await new Promise<Uint8Array>((resolve_, reject) => {
    const child = spawn(r.binary, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    active.add(child);
    let settled = false;
    const cleanupTmp = (): void => { void unlink(tmp).catch(() => { /* never written, or already gone */ }); };
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active.delete(child);
      cleanupTmp();
      fn();
    };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } done(() => reject(new Error('Piper synthesis timed out'))); }, SYNTH_TIMEOUT_MS);

    child.on('error', (err) => done(() => reject(err)));
    child.on('close', (code) => {
      // Read the produced WAV BEFORE settling (done() deletes the temp file). A SIGKILL'd/failed
      // run never reaches the read.
      void (async () => {
        if (settled) return;
        if (code !== 0) { done(() => reject(new Error(`Piper exited with code ${code ?? 'null'}`))); return; }
        let bytes: Uint8Array;
        try {
          const buf = await readFile(tmp);
          if (buf.length > MAX_SYNTH_BYTES) { done(() => reject(new Error('Piper output too large'))); return; }
          bytes = new Uint8Array(buf);
        } catch (err) {
          done(() => reject(err instanceof Error ? err : new Error('Piper output unreadable')));
          return;
        }
        if (!isValidWavHeader(bytes)) { done(() => reject(new Error('Piper produced invalid audio'))); return; }
        done(() => resolve_(bytes));
      })();
    });

    child.stdin.on('error', () => { /* broken pipe if the child died — handled via close/error */ });
    child.stdin.end(text, 'utf8');
  });
}

/** Kill any in-flight synthesis (renderer cancel / shutdown). */
export function cancelActive(): void {
  for (const c of active) { try { c.kill('SIGKILL'); } catch { /* already gone */ } }
  active.clear();
}
