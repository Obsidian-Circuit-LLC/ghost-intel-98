#!/usr/bin/env node
/**
 * Fetch + verify the bundled Tor Expert Bundle (Windows x86_64) for the DCS98 chat module.
 *
 * Idempotent: if the binary is already in place, it does nothing. Otherwise it downloads the PINNED
 * release, verifies its SHA-256 against the value the Tor Project's GPG-signed sums file published,
 * and extracts it into resources/tor/win-x64/. FAIL-CLOSED: any hash mismatch deletes the download
 * and exits non-zero, so a tampered/wrong binary never lands in the installer.
 *
 * Pinned 2026-06-06 — bump VERSION + SHA256 together, re-verifying against the Tor Project's
 * signed sha256sums-signed-build.txt (see resources/tor/README-TOR.txt).
 */
import { createWriteStream, existsSync, mkdirSync, rmSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const VERSION = '15.0.15';
const FILE = `tor-expert-bundle-windows-x86_64-${VERSION}.tar.gz`;
const URL = `https://archive.torproject.org/tor-package-archive/torbrowser/${VERSION}/${FILE}`;
const SHA256 = '8d3daf579192f3f128c0f42553dd994c640501b4b98682216d807c88004f7a96';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'resources', 'tor', 'win-x64');
const marker = join(outDir, 'tor', 'tor.exe');

if (existsSync(marker)) {
  console.log(`[fetch-tor] present: ${marker} (skipping)`);
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
      .on('error', (e) => {
        f.close();
        reject(e);
      });
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

const tmp = join(root, `.tor-dl-${process.pid}.tar.gz`);
try {
  console.log(`[fetch-tor] downloading ${URL}`);
  await download(URL, tmp);
  const got = await sha256(tmp);
  if (got !== SHA256) {
    rmSync(tmp, { force: true });
    console.error(`[fetch-tor] SHA-256 MISMATCH\n  want ${SHA256}\n  got  ${got}\n  aborting (fail-closed)`);
    process.exit(1);
  }
  console.log('[fetch-tor] SHA-256 verified ✓');
  mkdirSync(outDir, { recursive: true });
  execFileSync('tar', ['xzf', tmp, '-C', outDir], { stdio: 'inherit' });
  rmSync(tmp, { force: true });
  if (!existsSync(marker)) {
    console.error('[fetch-tor] extraction did not produce tor/tor.exe — aborting');
    process.exit(1);
  }
  console.log(`[fetch-tor] ready: ${marker}`);
} catch (e) {
  rmSync(tmp, { force: true });
  console.error(`[fetch-tor] failed: ${e.message}`);
  process.exit(1);
}
