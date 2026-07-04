#!/usr/bin/env node
/**
 * Fetch + verify the bundled Ollama runtime (Windows x86_64, CPU-only) that serves the offline
 * embedding model (nomic-embed-text) via the dedicated embed runtime (src/main/services/memory/
 * embed-runtime.ts, port 11435). This is the runtime `fetch-embed.mjs` always assumed existed:
 * without ollama.exe in resources/local-ai, `embedBundled()` is false, the 11435 runtime never
 * starts, embeddings fall back to the user's own Ollama (which lacks the model), and memory indexes
 * 0 chunks with an "HTTP 404 — is nomic-embed-text present?" error. Bundling the binary here closes
 * that gap.
 *
 * CPU-ONLY: Ollama's Windows zip is ~2 GB compressed / ~4 GB extracted, almost all of it GPU runners
 * (lib/ollama/cuda_v12, cuda_v13, vulkan — cuda_v12/ggml-cuda.dll alone is 1.67 GB). Embeddings run
 * on CPU, so we extract ONLY ollama.exe + lib/ollama/ggml-base.dll + lib/ollama/ggml-cpu-*.dll
 * (~43 MB total); Ollama selects the right CPU-feature runner (haswell/skylakex/…) at load time.
 *
 * Idempotent: if ollama.exe is already in place, does nothing. FAIL-CLOSED: any SHA-256 mismatch
 * deletes the download and exits non-zero, so a tampered/wrong binary never lands in the installer.
 *
 * Pinned 2026-07-04 — bump VERSION + SHA256 together, re-verifying against the release's official
 * sha256sum.txt (https://github.com/ollama/ollama/releases/download/v<VERSION>/sha256sum.txt).
 */
import { createWriteStream, existsSync, mkdirSync, rmSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const VERSION = '0.13.5';
const FILE = 'ollama-windows-amd64.zip';
const URL = `https://github.com/ollama/ollama/releases/download/v${VERSION}/${FILE}`;
const SHA256 = '086ca4e303ab44b232246f5d268e3b4f05e5d91856e4ac645c3e2f8268ea20a8';

// CPU-only extraction set (unzip include-patterns). Everything else in the zip — cuda_v12, cuda_v13,
// vulkan — is intentionally left out.
const EXTRACT = ['ollama.exe', 'lib/ollama/ggml-base.dll', 'lib/ollama/ggml-cpu-*.dll'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'resources', 'local-ai');
const marker = join(outDir, 'ollama.exe');

if (existsSync(marker)) {
  console.log(`[fetch-ollama] present: ${marker} (skipping)`);
  process.exit(0);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const f = createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          f.close();
          download(res.headers.location, dest).then(resolve, reject);
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

// Allow reusing a pre-downloaded zip (CI cache / local dev) via OLLAMA_ZIP to avoid a ~2 GB re-fetch.
const cached = process.env.OLLAMA_ZIP && existsSync(process.env.OLLAMA_ZIP) ? process.env.OLLAMA_ZIP : null;
const tmp = cached ?? join(root, `.ollama-dl-${process.pid}.zip`);

try {
  if (cached) {
    console.log(`[fetch-ollama] using cached zip: ${cached}`);
  } else {
    console.log(`[fetch-ollama] downloading ${URL} (~2 GB; CPU-only ~43 MB is extracted) …`);
    await download(URL, tmp);
  }
  const got = await sha256(tmp);
  if (got !== SHA256) {
    if (!cached) rmSync(tmp, { force: true });
    throw new Error(`[fetch-ollama] SHA-256 mismatch: got ${got}, expected ${SHA256}`);
  }
  mkdirSync(outDir, { recursive: true });
  // Selective CPU-only extraction; -o overwrites, patterns limit what's unpacked.
  execFileSync('unzip', ['-o', tmp, ...EXTRACT, '-d', outDir], { stdio: 'inherit' });
  if (!existsSync(marker)) throw new Error(`[fetch-ollama] extraction did not produce ${marker}`);
  console.log(`[fetch-ollama] bundled CPU-only Ollama ${VERSION} → ${outDir}`);
} finally {
  if (!cached) rmSync(tmp, { force: true });
}
