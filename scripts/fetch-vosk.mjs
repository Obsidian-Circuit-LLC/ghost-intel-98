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
import { existsSync, rmSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * zeroed mtime/owner, gzip -n (no gz timestamp). GNU tar required (the build box ships GNU tar 1.35).
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
    '--use-compress-program=gzip -n',
    '-C', parent,
    '-cf', outFile,
    'model'
  ], { stdio: 'pipe' });
}
