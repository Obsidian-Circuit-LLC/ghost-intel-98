#!/usr/bin/env node
/*
 * Verify the bundled ML-KEM-1024 helper binaries before packaging. Unlike fetch-tor / fetch-piper,
 * the helper is BUILT (it links AWS-LC), not downloaded — see tools/mlkem-helper/build.sh and
 * resources/mlkem/README-MLKEM.txt. This script:
 *   - computes the SHA-256 of each present per-platform helper and prints it (for pinning);
 *   - FAILS CLOSED (exit 1) if a binary is present but its pinned hash doesn't match;
 *   - WARNS (does not fail) if a platform's helper is absent — that platform's build will ship
 *     without ML-KEM and chat will fail closed at runtime there until the binary is supplied.
 *
 * Pin a hash by filling PINNED[platform] once the per-platform binary is built in CI. The runtime
 * client (src/main/services/mlkem-sidecar.ts) enforces the same pin before spawning.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORMS = [
  { dir: 'linux-x64', bin: 'mlkem-helper' },
  { dir: 'win-x64', bin: 'mlkem-helper.exe' },
  { dir: 'mac-x64', bin: 'mlkem-helper' },
  { dir: 'mac-arm64', bin: 'mlkem-helper' }
];

// Fill these once binaries are built + reviewed in CI (lowercase hex). Empty = unpinned (printed only).
const PINNED = {
  'linux-x64': '028cd33a7fbcc03999683b77e653c17e33fd43da4c89ef9f9aaa2c79927a75c3',
  'win-x64': 'b955444d5f06d5beb4c3d5f4135d8ad4c2c14f8f8ccd91d3f3127f2a7a945b31',
  'mac-x64': '',
  'mac-arm64': ''
};

let failed = false;
let present = 0;
for (const { dir, bin } of PLATFORMS) {
  const p = join(root, 'resources', 'mlkem', dir, bin);
  if (!existsSync(p)) {
    console.warn(`[fetch-mlkem] WARN: ${dir} helper absent (${p}) — that build will lack ML-KEM (chat fails closed there).`);
    continue;
  }
  present += 1;
  const got = createHash('sha256').update(readFileSync(p)).digest('hex');
  const want = (PINNED[dir] || '').toLowerCase();
  if (want && got !== want) {
    console.error(`[fetch-mlkem] SHA-256 MISMATCH for ${dir}: got ${got}, want ${want} — aborting (fail-closed).`);
    failed = true;
  } else {
    console.log(`[fetch-mlkem] ${dir}: ${got}${want ? ' (pinned ✓)' : ' (unpinned — pin this in PINNED + the sidecar)'}`);
  }
}

if (present === 0) console.warn('[fetch-mlkem] WARN: no ML-KEM helper binaries present at all. See resources/mlkem/README-MLKEM.txt.');
if (failed) process.exit(1);
