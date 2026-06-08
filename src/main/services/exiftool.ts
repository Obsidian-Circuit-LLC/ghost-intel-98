/**
 * ExifTool integration. Runs the bundled (operator-supplied) ExifTool over a case attachment and
 * returns its grouped tag set, for the case-detail metadata panel. The attachment is encrypted at
 * rest, so we decrypt it to a short-lived temp file, run ExifTool, then delete the temp. ExifTool is
 * optional: if the binary isn't present, this returns { available: false } and the UI hides the
 * section (no hard dependency). No network — pure local spawn.
 */
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { caseAttachmentsDir } from '../storage/paths';
import { secureReadFile } from '../storage/secure-fs';

const RUN_TIMEOUT_MS = 15_000;
const MAX_OUT = 8 * 1024 * 1024;

function platformDir(): string {
  if (process.platform === 'win32') return 'win-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  return 'linux-x64';
}
function binPath(): string | null {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
  const p = join(base, 'exiftool', platformDir(), process.platform === 'win32' ? 'exiftool.exe' : 'exiftool');
  return existsSync(p) ? p : null;
}

export function exifAvailable(): boolean {
  return binPath() !== null;
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'ignore'] }); // no shell, arg array → no injection
    const chunks: Buffer[] = [];
    let len = 0;
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } reject(new Error('ExifTool timed out')); }, RUN_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => {
      len += d.length;
      if (len > MAX_OUT) { try { child.kill('SIGKILL'); } catch { /* gone */ } clearTimeout(timer); reject(new Error('ExifTool output too large')); return; }
      chunks.push(d);
    });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(Buffer.concat(chunks).toString('utf8')); else reject(new Error(`ExifTool exited ${code}`)); });
  });
}

export interface ExifResult { available: boolean; tags?: Record<string, unknown> }

/** Read grouped ExifTool tags for a case attachment. Decrypts to a temp file (deleted in finally). */
export async function readExif(caseId: string, fileName: string): Promise<ExifResult> {
  const bin = binPath();
  if (!bin) return { available: false };
  const src = join(caseAttachmentsDir(caseId), fileName);
  const bytes = await secureReadFile(src); // throws if vault locked
  const tmp = join(app.getPath('temp'), `ga98-exif-${randomUUID().slice(0, 8)}${extname(fileName)}`);
  await writeFile(tmp, bytes);
  try {
    const out = await run(bin, ['-json', '-G1', '-a', '-s', '-api', 'largefilesupport=1', tmp]);
    const arr = JSON.parse(out) as Record<string, unknown>[];
    const tags = Array.isArray(arr) && arr[0] ? { ...arr[0] } : {};
    delete tags['SourceFile'];
    return { available: true, tags };
  } finally {
    await unlink(tmp).catch(() => { /* best-effort cleanup */ });
  }
}
