#!/usr/bin/env node
/**
 * Fetch + verify the bundled Piper TTS binary (Windows amd64) and one PUBLIC-DOMAIN voice model for
 * the DCS98 offline neural-TTS engine.
 *
 * Idempotent: if both are in place it does nothing. Otherwise it downloads the PINNED release binary
 * and the PINNED voice model, verifies each against its SHA-256, extracts the binary, flattens it
 * into resources/piper/win-x64/, and drops the voice model alongside it. FAIL-CLOSED: any hash
 * mismatch deletes the download and exits non-zero, so a tampered/wrong artifact never ships.
 *
 * Pinned 2026-06-06 — bump VERSION/MODEL + the SHA-256s together, re-verifying the new artifacts.
 *
 * Provenance + license: see resources/piper/README-PIPER.txt. The voice is en_US-ljspeech-high,
 * trained on the LJ Speech dataset (PUBLIC DOMAIN — no attribution obligation).
 */
import { createWriteStream, existsSync, mkdirSync, rmSync, createReadStream, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const PIPER_VERSION = '2023.11.14-2';
const BINARY_URL = `https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_windows_amd64.zip`;
const BINARY_SHA256 = 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea';

const VOICE = 'en_US-ljspeech-high';
const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/high';
const MODEL_URL = `${VOICE_BASE}/${VOICE}.onnx`;
const MODEL_SHA256 = '5d4f08ba6a2a48c44592eed3ce56bf85e9de3dd4e20df90541ae68a8310c029a';
const CONFIG_URL = `${VOICE_BASE}/${VOICE}.onnx.json`;
const CONFIG_SHA256 = '7e1f4634af596d83cca997fb7a931ba80b70f8a316a2655ee69c55365e0ace14';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'resources', 'piper', 'win-x64');
const binMarker = join(outDir, 'piper.exe');
const modelMarker = join(outDir, `${VOICE}.onnx`);
const configMarker = `${modelMarker}.json`;

if (existsSync(binMarker) && existsSync(modelMarker) && existsSync(configMarker)) {
  console.log(`[fetch-piper] present: ${binMarker} + ${VOICE} (skipping)`);
  process.exit(0);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const f = createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          f.close();
          // Resolve relative redirect Locations against the current URL (HF serves small
          // non-LFS files via a relative redirect; absolute URLs pass through unchanged).
          const next = new URL(res.headers.location, url).toString();
          download(next, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          f.close();
          reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
          return;
        }
        res.pipe(f);
        f.on('finish', () => f.close(resolve));
      })
      .on('error', (e) => { f.close(); reject(e); });
  });
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

async function fetchVerify(url, dest, want) {
  console.log(`[fetch-piper] downloading ${url}`);
  await download(url, dest);
  const got = await sha256(dest);
  if (got !== want) {
    rmSync(dest, { force: true });
    console.error(`[fetch-piper] SHA-256 MISMATCH for ${url}\n  want ${want}\n  got  ${got}\n  aborting (fail-closed)`);
    process.exit(1);
  }
  console.log(`[fetch-piper] verified ✓ ${dest}`);
}

const tmpZip = join(root, `.piper-dl-${process.pid}.zip`);
try {
  mkdirSync(outDir, { recursive: true });

  // 1) binary
  await fetchVerify(BINARY_URL, tmpZip, BINARY_SHA256);
  execFileSync('unzip', ['-o', '-q', tmpZip, '-d', outDir], { stdio: 'inherit' });
  rmSync(tmpZip, { force: true });
  // the zip nests everything under a top-level piper/ dir — flatten it into outDir
  const nested = join(outDir, 'piper');
  if (existsSync(nested)) {
    for (const entry of readdirSync(nested)) renameSync(join(nested, entry), join(outDir, entry));
    rmdirSync(nested);
  }
  if (!existsSync(binMarker)) {
    console.error('[fetch-piper] extraction did not produce piper.exe — aborting');
    process.exit(1);
  }

  // 2) voice model + config (placed alongside the binary; piper-tts.ts discovers the *.onnx)
  await fetchVerify(MODEL_URL, modelMarker, MODEL_SHA256);
  await fetchVerify(CONFIG_URL, `${modelMarker}.json`, CONFIG_SHA256);

  console.log(`[fetch-piper] ready: ${binMarker} + ${VOICE} (public-domain LJ Speech voice)`);
} catch (e) {
  rmSync(tmpZip, { force: true });
  console.error(`[fetch-piper] failed: ${e.message}`);
  process.exit(1);
}
