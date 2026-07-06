# Vosk Voice-Input Model Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle the Apache-2.0 `vosk-model-small-en-us-0.15` into `resources/vosk/model.tar.gz` at build time so Talk-to-Q voice input works out-of-box, via a SHA-pinned/fail-closed/gitignored fetch script matching the six other bundled-resource scripts.

**Architecture:** All changes are build-side or docs — **zero `src/` runtime changes** (the `ga98model://` protocol, `recognizer.ts`, the mic graph, and the status banner already exist and work). A new `scripts/fetch-vosk.mjs` downloads the pinned zip, verifies its SHA-256 fail-closed, and re-packs it into a deterministic `model/`-rooted gzipped tar. An afterPack guard fails the build if the artifact is missing/truncated. Docs record verified provenance + license.

**Tech Stack:** Node ESM build scripts (`.mjs`), CommonJS electron-builder afterPack hook (`.cjs`), GNU tar 1.35 + system `unzip`, vitest (node env), electron-builder `extraResources`.

## Global Constraints

- **Commit identity:** author `onna-bugeisha-dev-team <dev@onna-bugeisha.org>`. NEVER emit `Co-Authored-By`, `Signed-off-by`, `Claude-Session`, or any AI-identity trailer. Use `git -c commit.gpgsign=false -c user.name=... -c user.email=...`.
- **Never stage pre-existing dirty files:** `pnpm-lock.yaml`, `resources/satellites/active-snapshot.tle`, `native/dcs98-confine/Cargo.lock`, anything under `docs/superpowers/ideation/` or `resources/local-ai/`. `git add` only the exact files each task names.
- **Model identity (verified 2026-07-06):** `vosk-model-small-en-us-0.15`; URL `https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip`; SHA-256 `30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498`; size `41205931` bytes; License **Apache 2.0** (verified on the alphacephei models listing); "Copyright 2020 Alpha Cephei Inc" (model README).
- **Archive structure:** the produced tar MUST be rooted at a single directory named literally **`model/`** (vosk-browser's documented format), e.g. `model/am/final.mdl`. The upstream zip's top folder is `vosk-model-small-en-us-0.15/` — it MUST be renamed to `model`. This small model ships `graph/HCLr.fst` + `graph/Gr.fst` (lookahead split), **NOT** `HCLG.fst` — never assert `HCLG.fst`.
- **Determinism:** the tar is byte-reproducible (sorted entries, zeroed mtime/owner, `gzip -n`). Identical input → identical bytes.
- **No new egress / no telemetry:** the model is fetched at *build* time only; runtime serving is in-process via `ga98model://`. No new runtime dependency.
- **Verification reality:** `test/` is NOT in either `tsconfig.*.json` `include`, and this feature touches no `src/` files, so `pnpm typecheck` passes but covers nothing here. The real gates are `pnpm test` (vitest) + running `pnpm fetch:vosk` + the afterPack guard. Do not treat a green typecheck as coverage.
- **Cross-OS:** the model is OS-independent data (unpacked by vosk-browser WASM). `extraResources` already maps `resources/vosk → vosk`; no per-OS variants.

---

## File Structure

- `scripts/fetch-vosk.mjs` (new) — exports the pure `repackModelTar()` + `assertSha()` + model constants; runnable `main()` guarded so importing for tests does not download.
- `test/fetch-vosk-repack.test.ts` (new) — unit tests for `repackModelTar` (structure + determinism) and `assertSha`.
- `test/vosk-model-archive.test.ts` (new) — gated structural-parity test against the produced `resources/vosk/model.tar.gz`.
- `scripts/afterpack-verify.cjs` (modify) — add a cross-platform Vosk presence + size-floor guard; export the pure `sufficientVoskModel()` predicate.
- `test/afterpack-verify-vosk.test.ts` (new) — unit test for `sufficientVoskModel`.
- `package.json` (modify) — add `fetch:vosk` script; splice into `package` and `package:win`.
- `.gitignore` (modify) — ignore `resources/vosk/model.tar.gz`.
- `resources/vosk/README-VOSK.txt` (rewrite) + `resources/vosk/LICENSE-VOSK.txt` (new) — verified provenance + Apache-2.0.

---

## Task 1: Deterministic re-pack helper (the load-bearing core)

**Files:**
- Create: `scripts/fetch-vosk.mjs`
- Test: `test/fetch-vosk-repack.test.ts`

**Interfaces:**
- Produces:
  - `repackModelTar({ extractedDir: string, outFile: string }): void` — renames the extracted top folder to a sibling `model/`, then writes a deterministic gzipped tar rooted at `model/` to `outFile`. Throws on failure.
  - `assertSha(got: string, want: string, label?: string): void` — throws on mismatch, no-op on match.
  - Constants: `MODEL_NAME`, `MODEL_URL`, `MODEL_ZIP_SHA256`, `MODEL_ZIP_TOPDIR`, `OUT_FILE` (absolute path to `resources/vosk/model.tar.gz`).

- [ ] **Step 1: Write the failing test**

Create `test/fetch-vosk-repack.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { repackModelTar, assertSha } from '../scripts/fetch-vosk.mjs';

const MODEL_FILES = [
  'am/final.mdl', 'conf/mfcc.conf', 'conf/model.conf',
  'graph/HCLr.fst', 'graph/Gr.fst', 'graph/phones/word_boundary.int',
  'ivector/final.dubm', 'README'
];

const dirs: string[] = [];
function synthModel(): { extractedDir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'vosk-synth-'));
  dirs.push(root);
  const top = join(root, 'vosk-model-small-en-us-0.15');
  for (const rel of MODEL_FILES) {
    const f = join(top, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, `stub:${rel}`);
  }
  return { extractedDir: top, root };
}
const sha = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex');

afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('repackModelTar → model/-rooted deterministic tar', () => {
  it('re-roots every entry under model/ and drops the upstream folder name', () => {
    const { extractedDir, root } = synthModel();
    const out = join(root, 'model.tar.gz');
    repackModelTar({ extractedDir, outFile: out });
    const entries = execFileSync('tar', ['-tzf', out], { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(entries).toContain('model/am/final.mdl');
    expect(entries).toContain('model/graph/HCLr.fst');
    expect(entries.some((e) => e.startsWith('vosk-model-small-en-us-0.15/'))).toBe(false);
  });

  it('is byte-reproducible across independent runs (deterministic)', () => {
    const a = synthModel(); const outA = join(a.root, 'a.tar.gz');
    repackModelTar({ extractedDir: a.extractedDir, outFile: outA });
    const b = synthModel(); const outB = join(b.root, 'b.tar.gz');
    repackModelTar({ extractedDir: b.extractedDir, outFile: outB });
    expect(sha(outA)).toBe(sha(outB));
  });
});

describe('assertSha', () => {
  it('is a no-op when the hashes match', () => {
    expect(() => assertSha('abc', 'abc')).not.toThrow();
  });
  it('throws with both hashes on mismatch', () => {
    expect(() => assertSha('got1', 'want2', 'model.zip')).toThrow(/model\.zip[\s\S]*want2[\s\S]*got1/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/fetch-vosk-repack.test.ts`
Expected: FAIL — cannot resolve `../scripts/fetch-vosk.mjs` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `scripts/fetch-vosk.mjs` (helpers + constants only — no `main()` yet):

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/fetch-vosk-repack.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-vosk.mjs test/fetch-vosk-repack.test.ts
git -c commit.gpgsign=false -c user.name='onna-bugeisha-dev-team' -c user.email='dev@onna-bugeisha.org' \
  commit -m "feat(voice): deterministic model/-rooted Vosk re-pack helper + SHA guard"
```

---

## Task 2: Fetch orchestration + build wiring (produces the artifact)

**Files:**
- Modify: `scripts/fetch-vosk.mjs` (append `main()` + guarded invocation)
- Modify: `package.json` (add `fetch:vosk`; splice into `package` and `package:win`)
- Modify: `.gitignore` (ignore the produced artifact)

**Interfaces:**
- Consumes: `repackModelTar`, `assertSha`, `MODEL_URL`, `MODEL_ZIP_SHA256`, `MODEL_ZIP_TOPDIR`, `OUT_FILE` from Task 1.
- Produces: a runnable `pnpm fetch:vosk` that writes `resources/vosk/model.tar.gz` (idempotent, fail-closed).

- [ ] **Step 1: Extend the imports, then append the download helpers + `main()`**

First, replace the import block at the top of `scripts/fetch-vosk.mjs` (adding the download/hash deps `main()` and `sha256()` need):

```js
import { existsSync, mkdirSync, rmSync, renameSync, createWriteStream, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import https from 'node:https';
```

Then append to the end of `scripts/fetch-vosk.mjs`:

```js
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
  if (existsSync(OUT_FILE)) { console.log(`[fetch-vosk] present: ${OUT_FILE} (skipping)`); return; }
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  const work = join(root, `.vosk-dl-${process.pid}`);
  const zip = `${work}.zip`;
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
    process.exit(1);
  } finally {
    rmSync(zip, { force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 2: Verify the module still imports cleanly (no download on import)**

Run: `pnpm exec vitest run test/fetch-vosk-repack.test.ts`
Expected: PASS (4 tests) — the guarded `main()` must NOT fire during import (no network hit).

- [ ] **Step 3: Wire `package.json`**

In `package.json` `scripts`, add after the `"fetch:embed"` line:

```json
    "fetch:vosk": "node scripts/fetch-vosk.mjs",
```

Then in BOTH `"package"` and `"package:win"`, insert `pnpm fetch:vosk && ` immediately after `pnpm fetch:embed && `. Result (both lines):

```
"package": "pnpm fetch:tor && pnpm fetch:piper && pnpm fetch:mlkem && pnpm fetch:ollama && pnpm fetch:embed && pnpm fetch:vosk && pnpm fetch:tle-snapshot && pnpm build && electron-builder",
"package:win": "pnpm fetch:tor && pnpm fetch:piper && pnpm fetch:mlkem && pnpm fetch:ollama && pnpm fetch:embed && pnpm fetch:vosk && pnpm fetch:tle-snapshot && pnpm build && electron-builder --win --x64",
```

- [ ] **Step 4: Ignore the produced artifact**

Append to `.gitignore` under the bundled-resources section:

```
# Bundled Vosk speech model (build-fetched + verified; see scripts/fetch-vosk.mjs)
resources/vosk/model.tar.gz
```

- [ ] **Step 5: Run the fetch for real and verify the produced artifact**

Run:
```bash
pnpm fetch:vosk
tar -tzf resources/vosk/model.tar.gz | sort | head -20
ls -la resources/vosk/model.tar.gz
```
Expected: script prints `verified ✓` and `ready`; `tar -tzf` lists `model/`-rooted entries including `model/am/final.mdl`, `model/graph/HCLr.fst`, `model/conf/model.conf`; the `.tar.gz` is ~35–40 MB. Then re-run `pnpm fetch:vosk` and confirm it prints `present … (skipping)` (idempotent).

- [ ] **Step 6: Confirm the artifact is git-ignored**

Run: `git status --porcelain resources/vosk/model.tar.gz`
Expected: **empty output** (the file is ignored; it must NOT appear as untracked).

- [ ] **Step 7: Commit**

```bash
git add scripts/fetch-vosk.mjs package.json .gitignore
git -c commit.gpgsign=false -c user.name='onna-bugeisha-dev-team' -c user.email='dev@onna-bugeisha.org' \
  commit -m "feat(voice): fetch:vosk build step — download, verify, re-pack model.tar.gz"
```

---

## Task 3: Structural-parity test against the produced artifact

**Files:**
- Create: `test/vosk-model-archive.test.ts`

**Interfaces:**
- Consumes: the produced `resources/vosk/model.tar.gz` (from Task 2). Gated: skips cleanly when absent.

- [ ] **Step 1: Write the test**

Create `test/vosk-model-archive.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// The produced artifact must conform to vosk-browser's documented model/ layout. These are the
// documented model files that THIS model actually ships (small model = HCLr.fst + Gr.fst split,
// never a single HCLG.fst). Verified against the real zip contents 2026-07-06.
const MODEL = join(process.cwd(), 'resources', 'vosk', 'model.tar.gz');
const REQUIRED = [
  'model/am/final.mdl',
  'model/conf/mfcc.conf',
  'model/conf/model.conf',
  'model/graph/HCLr.fst',
  'model/graph/Gr.fst',
  'model/graph/phones/word_boundary.int',
  'model/ivector/final.dubm'
];

const suite = existsSync(MODEL) ? describe : describe.skip;

suite('bundled Vosk model archive conforms to vosk-browser model/ layout', () => {
  let entries: string[] = [];
  beforeAll(() => {
    entries = execFileSync('tar', ['-tzf', MODEL], { encoding: 'utf8' }).split('\n').filter(Boolean);
  });

  it('every documented model file is present under the model/ prefix', () => {
    for (const req of REQUIRED) expect(entries).toContain(req);
  });

  it('no entry retains the upstream vosk-model-small-en-us-0.15/ prefix', () => {
    expect(entries.some((e) => e.startsWith('vosk-model-small-en-us-0.15/'))).toBe(false);
  });

  it('does not (falsely) contain a single HCLG.fst — this model uses the lookahead split', () => {
    expect(entries).not.toContain('model/graph/HCLG.fst');
  });
});
```

- [ ] **Step 2: Run it (artifact present from Task 2)**

Run: `pnpm exec vitest run test/vosk-model-archive.test.ts`
Expected: PASS (3 tests) — because Task 2 produced the real artifact. (In a clean checkout without the artifact the suite would report as skipped, not failed.)

- [ ] **Step 3: Commit**

```bash
git add test/vosk-model-archive.test.ts
git -c commit.gpgsign=false -c user.name='onna-bugeisha-dev-team' -c user.email='dev@onna-bugeisha.org' \
  commit -m "test(voice): structural-parity guard for the bundled Vosk model archive"
```

---

## Task 4: afterPack build guard (never ship a missing/truncated model)

**Files:**
- Modify: `scripts/afterpack-verify.cjs`
- Create: `test/afterpack-verify-vosk.test.ts`

**Interfaces:**
- Produces: `sufficientVoskModel(bytes: number): boolean` and `VOSK_MODEL_MIN_BYTES` exported from `afterpack-verify.cjs`; the afterPack hook now asserts the Vosk model on **every** platform.

- [ ] **Step 1: Write the failing test**

Create `test/afterpack-verify-vosk.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sufficientVoskModel, VOSK_MODEL_MIN_BYTES } from '../scripts/afterpack-verify.cjs';

describe('sufficientVoskModel size-floor', () => {
  it('rejects an empty/truncated model', () => {
    expect(sufficientVoskModel(0)).toBe(false);
    expect(sufficientVoskModel(VOSK_MODEL_MIN_BYTES - 1)).toBe(false);
  });
  it('accepts a full-size model (floor inclusive)', () => {
    expect(sufficientVoskModel(VOSK_MODEL_MIN_BYTES)).toBe(true);
    expect(sufficientVoskModel(40 * 1024 * 1024)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/afterpack-verify-vosk.test.ts`
Expected: FAIL — `sufficientVoskModel` / `VOSK_MODEL_MIN_BYTES` are not exported.

- [ ] **Step 3: Modify `scripts/afterpack-verify.cjs`**

Add `statSync` to the fs require, insert the Vosk guard **above** the existing `win32` early-return, and export the predicate. The top of the file becomes:

```js
const { join } = require('node:path');
const { existsSync, readdirSync, statSync } = require('node:fs');

// The Vosk speech model is bundled on EVERY platform (OS-independent data unpacked by vosk-browser
// WASM), so it is guarded before the win32-only embedding-stack checks. 10 MB floor catches an
// empty/truncated artifact (the real model is ~35-40 MB).
const VOSK_MODEL_MIN_BYTES = 10 * 1024 * 1024;
function sufficientVoskModel(bytes) { return bytes >= VOSK_MODEL_MIN_BYTES; }

function assertVoskModel(appOutDir) {
  const f = join(appOutDir, 'resources', 'vosk', 'model.tar.gz');
  if (!existsSync(f)) {
    throw new Error(`[afterpack-verify] Vosk model MISSING in the package: ${f}\n  Voice input would be dead. Did 'pnpm fetch:vosk' run before packaging?`);
  }
  const size = statSync(f).size;
  if (!sufficientVoskModel(size)) {
    throw new Error(`[afterpack-verify] Vosk model too small (${size} bytes < ${VOSK_MODEL_MIN_BYTES} floor) — truncated/empty artifact would ship a dead voice feature.`);
  }
  console.log(`[afterpack-verify] Vosk speech model present (${size} bytes) ✓`);
}
```

Then, inside `module.exports = async function afterPack(context) {`, make the FIRST line:

```js
  assertVoskModel(context.appOutDir); // all platforms — the Vosk model is OS-independent
```

(leave the existing `if (context.electronPlatformName !== 'win32') return;` and embed-stack checks unchanged, immediately after).

Finally, at the very end of the file, add:

```js
module.exports.sufficientVoskModel = sufficientVoskModel;
module.exports.VOSK_MODEL_MIN_BYTES = VOSK_MODEL_MIN_BYTES;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/afterpack-verify-vosk.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/afterpack-verify.cjs test/afterpack-verify-vosk.test.ts
git -c commit.gpgsign=false -c user.name='onna-bugeisha-dev-team' -c user.email='dev@onna-bugeisha.org' \
  commit -m "feat(build): afterPack guard fails the build if the Vosk model is missing/truncated"
```

---

## Task 5: Verified provenance + license docs

**Files:**
- Modify: `resources/vosk/README-VOSK.txt`
- Create: `resources/vosk/LICENSE-VOSK.txt`

**Interfaces:** none (docs). Both files are tracked and ship via `extraResources`.

- [ ] **Step 1: Rewrite `resources/vosk/README-VOSK.txt`**

Replace its entire contents with:

```
Vosk offline speech model (bundled at build time)
=================================================

Talk-to-Q's voice INPUT uses Vosk for OFFLINE, on-device speech-to-text — chosen over Chromium's
built-in speech recognition because that one streams microphone audio to Google's cloud, which would
violate the no-cloud rule.

The model is bundled automatically by `scripts/fetch-vosk.mjs` (wired into `pnpm package` /
`pnpm package:win`). It is NOT committed to git — the fetch step downloads it, verifies its SHA-256
fail-closed, and re-packs it here as:

    resources/vosk/model.tar.gz

Provenance (verified 2026-07-06):
    Model:      vosk-model-small-en-us-0.15
    Source:     https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
    SHA-256:    30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498  (41,205,931 bytes)
    License:    Apache 2.0 (per the alphacephei models listing) — see LICENSE-VOSK.txt
    Copyright:  2020 Alpha Cephei Inc (from the model's bundled README)

Archive structure: vosk-browser loads a gzipped tar whose model files sit under a single top-level
`model/` directory (e.g. model/am/final.mdl, model/conf/model.conf, model/graph/HCLr.fst,
model/ivector/final.dubm). `fetch-vosk.mjs` renames the upstream `vosk-model-small-en-us-0.15/`
folder to `model/` and builds the tar deterministically (sorted entries, zeroed mtime/owner,
gzip -n). NOTE: this small model ships the lookahead graph split (HCLr.fst + Gr.fst), not a single
HCLG.fst.

This directory ships via electron-builder `extraResources` (-> resources/vosk in the packaged app,
every OS) and is served to the renderer by the in-app `ga98model://` protocol — no file leaves the
box. The afterPack guard (scripts/afterpack-verify.cjs) fails the build if model.tar.gz is missing or
truncated, so a dead voice feature can never ship.
```

- [ ] **Step 2: Create `resources/vosk/LICENSE-VOSK.txt`**

Write the attribution header followed by the verbatim Apache License 2.0 text:

```
vosk-model-small-en-us-0.15 — licensing
=======================================

The bundled Vosk speech model `vosk-model-small-en-us-0.15` is distributed under the Apache License
2.0, as listed on the official model index at https://alphacephei.com/vosk/models (verified
2026-07-06). The model's own bundled README states: "Copyright 2020 Alpha Cephei Inc".

The full Apache License 2.0 text follows.

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

   [... include the complete, unmodified Apache License 2.0 body verbatim,
   from "License" shall mean the terms and conditions ... through the end of
   the APPENDIX. Copy it verbatim from https://www.apache.org/licenses/LICENSE-2.0.txt;
   do not paraphrase or abbreviate. ...]
```

Fetch the canonical text with:
```bash
curl -sSL https://www.apache.org/licenses/LICENSE-2.0.txt
```
and paste the complete body in place of the bracketed note (the header above stays). Verify the file ends with the full APPENDIX ("END OF TERMS AND CONDITIONS" plus the "APPENDIX: How to apply…" section).

- [ ] **Step 3: Verify the docs**

Run:
```bash
grep -c "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498" resources/vosk/README-VOSK.txt
grep -c "END OF TERMS AND CONDITIONS" resources/vosk/LICENSE-VOSK.txt
```
Expected: each prints `1` (SHA present in README; full Apache body present in LICENSE).

- [ ] **Step 4: Commit**

```bash
git add resources/vosk/README-VOSK.txt resources/vosk/LICENSE-VOSK.txt
git -c commit.gpgsign=false -c user.name='onna-bugeisha-dev-team' -c user.email='dev@onna-bugeisha.org' \
  commit -m "docs(voice): bundled Vosk model provenance + verified Apache-2.0 license"
```

---

## Final Verification (whole branch, before merge)

- [ ] `pnpm fetch:vosk` produces `resources/vosk/model.tar.gz`; `tar -tzf` shows a `model/`-rooted tree.
- [ ] `pnpm test` — full suite green (new suites: fetch-vosk-repack, vosk-model-archive, afterpack-verify-vosk; the archive suite RUNS, not skips, because the artifact is present).
- [ ] `pnpm typecheck` — passes (no `src/` changes; treated as a no-op smoke check here, not coverage).
- [ ] `git status --porcelain` shows NO `resources/vosk/model.tar.gz` (git-ignored) and none of the pre-existing dirty files staged.
- [ ] afterPack guard sanity: it throws when the model is absent (temporarily rename the artifact, run a package build or unit-invoke `assertVoskModel`, restore).
- [ ] **Runtime confirmation is out-of-band:** the live `createModel` load + real-mic transcription are confirmed only in the shipped Electron app on GhostExodus's Windows box — CI proves documented-contract conformance, not the WASM runtime load (see spec § Honest verification limits).
