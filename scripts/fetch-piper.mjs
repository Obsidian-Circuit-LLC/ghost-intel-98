#!/usr/bin/env node
/**
 * Fetch + verify the bundled Piper TTS binary (Windows amd64) and character voice models for the
 * Ghost Intel 98 offline neural-TTS engine.
 *
 * Idempotent: if the binary and all voices are in place it does nothing. Otherwise it downloads the
 * PINNED release binary and PINNED voice models, verifies each against its SHA-256, extracts the
 * binary, flattens it into resources/piper/win-x64/, and drops the voice models alongside it.
 * FAIL-CLOSED: any hash mismatch deletes the download and exits non-zero, so a tampered/wrong
 * artifact never ships.
 *
 * Pinned 2026-06-06 (binary + ljspeech); 2026-06-21 (Jarvis, HAL, Wheatley, GLaDOS) — bump
 * VERSION/VOICES + the SHA-256s together, re-verifying the new artifacts.
 *
 * Provenance + license: see resources/piper/README-PIPER.txt.
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

// Each voice ships as <onnx>.onnx + <onnx>.onnx.json in resources/piper/win-x64/. The first is the
// public-domain default; the rest are opt-in character voices (studio-copyright; see README-PIPER.txt).
const VOICES = [
  {
    onnx: 'en_US-ljspeech-high.onnx',
    modelUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/high/en_US-ljspeech-high.onnx',
    modelSha: '5d4f08ba6a2a48c44592eed3ce56bf85e9de3dd4e20df90541ae68a8310c029a',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/high/en_US-ljspeech-high.onnx.json',
    configSha: '7e1f4634af596d83cca997fb7a931ba80b70f8a316a2655ee69c55365e0ace14'
  },
  {
    onnx: 'jarvis-medium.onnx',
    modelUrl: 'https://huggingface.co/jgkawell/jarvis/resolve/main/en/en_GB/jarvis/medium/jarvis-medium.onnx',
    modelSha: '3f6534bd4050931b4c7d16ef777bafa2d90eb1e7baa8af9358623ffe609506da',
    configUrl: 'https://huggingface.co/jgkawell/jarvis/resolve/main/en/en_GB/jarvis/medium/jarvis-medium.onnx.json',
    configSha: 'f2c2d77f64ed6e771fc7d2defa59cd47d6bd03c3e7602c732d63ea46954f2553'
  },
  {
    onnx: 'hal.onnx',
    modelUrl: 'https://huggingface.co/campwill/HAL-9000-Piper-TTS/resolve/main/hal.onnx',
    modelSha: '0e08c82dc027bc72b8b839324801709e205e8c201ccae171b92e37a664d94361',
    configUrl: 'https://huggingface.co/campwill/HAL-9000-Piper-TTS/resolve/main/hal.onnx.json',
    configSha: 'cb6f82c03fc9e6db1f3b6978b9601bab9854f92c40d3a0681501944b8c26745e'
  },
  {
    onnx: 'wheatley1.onnx',
    modelUrl: 'https://huggingface.co/davet2001/wheatley1/resolve/main/wheatley1.onnx',
    modelSha: 'cb8c1e88856de3d0d052ee4596f99b7cabb12be48538bad2f98ba7bd086df882',
    configUrl: 'https://huggingface.co/davet2001/wheatley1/resolve/main/wheatley1.onnx.json',
    configSha: '99409ff9380b6cb3b1e01cc2009e2151ff5168784897294132d35029bd84fabf'
  },
  {
    onnx: 'en_US-glados-high.onnx',
    modelUrl: 'https://huggingface.co/csukuangfj/vits-piper-en_US-glados-high/resolve/main/en_US-glados-high.onnx',
    modelSha: 'eb89e52ec68d16c3763cccee6b381bb0adc72a2c2dbe41b011f5702f780302e4',
    configUrl: 'https://huggingface.co/csukuangfj/vits-piper-en_US-glados-high/resolve/main/en_US-glados-high.onnx.json',
    configSha: 'f83744ff6aa6138ebade1357b65b3f8456bc00b9edb913ab78674eb323ca32d0'
  }
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'resources', 'piper', 'win-x64');
const binMarker = join(outDir, 'piper.exe');

const haveAllVoices = VOICES.every((v) => existsSync(join(outDir, v.onnx)) && existsSync(join(outDir, `${v.onnx}.json`)));
if (existsSync(binMarker) && haveAllVoices) {
  console.log(`[fetch-piper] present: binary + ${VOICES.length} voice(s) (skipping)`);
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

  // 1) binary (skip if already extracted)
  if (!existsSync(binMarker)) {
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
  }

  // 2) voice models + configs (placed alongside the binary; piper-tts.ts discovers the *.onnx)
  for (const v of VOICES) {
    const model = join(outDir, v.onnx);
    await fetchVerify(v.modelUrl, model, v.modelSha);
    await fetchVerify(v.configUrl, `${model}.json`, v.configSha);
  }
  console.log(`[fetch-piper] ready: ${binMarker} + ${VOICES.length} voice(s)`);
} catch (e) {
  rmSync(tmpZip, { force: true });
  console.error(`[fetch-piper] failed: ${e.message}`);
  process.exit(1);
}
