#!/usr/bin/env node
/**
 * Fetch + verify + re-pack the bundled Vosk speech model (offline STT for Talk-to-Q voice input).
 *
 * Downloads the PINNED vosk-model-small-en-us-0.15 zip, verifies its SHA-256 (FAIL-CLOSED), and
 * re-packs it into resources/vosk/model.tar.gz in the model/-rooted layout vosk-browser's loader
 * documents. Deterministic tar: sorted entries, zeroed mtime/owner, gzip -n → byte-reproducible.
 *
 * Idempotent: if resources/vosk/model.tar.gz already exists it does nothing.
 * License: Apache 2.0 (verified on the alphacephei models listing); see resources/vosk/LICENSE-VOSK.txt.
 * Pinned 2026-07-06 — bump MODEL_* together and re-verify if the model rotates.
 */
import { existsSync, mkdirSync, rmSync, renameSync, createWriteStream, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import https from 'node:https';

export const MODEL_NAME = 'vosk-model-small-en-us-0.15';
export const MODEL_URL = `https://alphacephei.com/vosk/models/${MODEL_NAME}.zip`;
export const MODEL_ZIP_SHA256 = '30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498';
export const MODEL_ZIP_TOPDIR = MODEL_NAME; // the upstream zip nests everything under this folder

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_FILE = join(root, 'resources', 'vosk', 'model.tar.gz');

/** Throw on SHA mismatch; no-op on match. Pure. */
export function assertSha(got, want, label = 'artifact') {
  if (got !== want) {
    throw new Error(`SHA-256 mismatch for ${label}\n  want ${want}\n  got  ${got}`);
  }
}

/**
 * Re-pack an extracted Vosk model directory into a deterministic, model/-rooted gzipped tar.
 * vosk-browser expects a single top-level `model/` folder; the upstream zip nests under
 * MODEL_ZIP_TOPDIR, so we rename that folder to `model` then tar it. Determinism: --sort=name,
 * zeroed mtime/owner, gzip -n (no gz timestamp), and --mode='go+u,go-w' to normalize group/other
 * permission bits (which vary by extracting host's unzip version/umask) so identical input bytes
 * always produce an identical tar regardless of which box ran the extraction. GNU tar required
 * (the build box ships GNU tar 1.35).
 */
export function repackModelTar({ extractedDir, outFile }) {
  const parent = dirname(extractedDir);
  const modelDir = join(parent, 'model');
  if (existsSync(modelDir)) rmSync(modelDir, { recursive: true, force: true });
  renameSync(extractedDir, modelDir);
  rmSync(outFile, { force: true });
  execFileSync('tar', [
    '--sort=name',
    '--mtime=@0',
    '--owner=0', '--group=0', '--numeric-owner',
    '--mode=go+u,go-w',
    '--use-compress-program=gzip -n',
    '-C', parent,
    '-cf', outFile,
    'model'
  ], { stdio: 'pipe' });
}

/**
 * True if `file` is a well-formed gzipped tar containing the model/ layout (cheap structural
 * check, not a full content hash). Used to decide whether an existing OUT_FILE is trustworthy
 * enough to skip re-fetching, or is a corrupt/truncated leftover (e.g. from an interrupted prior
 * run) that must be discarded and re-fetched. Fail-closed: any error (unreadable, not a tar,
 * missing the expected root) is treated as invalid.
 */
export function isValidModelArchive(file) {
  try {
    const listing = execFileSync('tar', ['-tzf', file], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const entries = listing.split('\n').filter(Boolean);
    return entries.includes('model/conf/model.conf');
  } catch {
    return false;
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const f = createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        f.close();
        download(new URL(res.headers.location, url).toString(), dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { f.close(); reject(new Error(`HTTP ${res.statusCode} fetching ${url}`)); return; }
      res.pipe(f);
      f.on('finish', () => f.close(resolve));
    }).on('error', (e) => { f.close(); reject(e); });
  });
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function main() {
  if (existsSync(OUT_FILE)) {
    if (isValidModelArchive(OUT_FILE)) {
      console.log(`[fetch-vosk] present: ${OUT_FILE} (skipping)`);
      return;
    }
    console.warn(`[fetch-vosk] existing ${OUT_FILE} failed integrity check — discarding and re-fetching`);
    rmSync(OUT_FILE, { force: true });
  }
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  const work = join(root, `.vosk-dl-${process.pid}`);
  const zip = `${work}.zip`;
  // `finally` must run BEFORE the process exits so the temp zip + work dir are always cleaned up,
  // even on failure — process.exit() inside a catch block would skip a pending finally, so the
  // exit is deferred to after the try/catch/finally completes.
  let failed = null;
  try {
    mkdirSync(work, { recursive: true });
    console.log(`[fetch-vosk] downloading ${MODEL_URL}`);
    await download(MODEL_URL, zip);
    assertSha(await sha256(zip), MODEL_ZIP_SHA256, `${MODEL_NAME}.zip`);
    console.log('[fetch-vosk] verified ✓ (SHA-256)');
    execFileSync('unzip', ['-q', zip, '-d', work], { stdio: 'inherit' });
    repackModelTar({ extractedDir: join(work, MODEL_ZIP_TOPDIR), outFile: OUT_FILE });
    if (!existsSync(OUT_FILE)) throw new Error('re-pack did not produce model.tar.gz');
    console.log(`[fetch-vosk] ready: ${OUT_FILE}`);
  } catch (e) {
    rmSync(OUT_FILE, { force: true });
    console.error(`[fetch-vosk] failed: ${e.message}`);
    failed = e;
  } finally {
    rmSync(zip, { force: true });
    rmSync(work, { recursive: true, force: true });
  }
  if (failed) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
