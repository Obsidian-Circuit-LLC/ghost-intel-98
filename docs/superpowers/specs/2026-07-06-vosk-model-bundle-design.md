# Vosk voice-input model bundle — design

**Date:** 2026-07-06
**Status:** approved (operator), ready for implementation plan
**Feature queue:** GhostExodus request #4 — voice INPUT out-of-box
**Version target:** folds into the next release build (v3.31.0 candidate)

## Problem

Talk-to-Q's push-to-talk voice **input** (offline STT via `vosk-browser`, WASM, in-renderer) has
been fully wired since v3.29.0 — the privileged `ga98model://` protocol, the `recognizer.ts` glue,
the mic audio graph, and the "needs a Vosk model" status banner all exist and work. But the feature
has never actually functioned in the shipped app because the one artifact it depends on —
`resources/vosk/model.tar.gz` — was left operator-supplied and is therefore absent from every
installer. `resources/vosk/` ships containing only `README-VOSK.txt`. GhostExodus's install shows
"Voice input needs a Vosk model in `resources/vosk/`."

This is a **build-time artifact problem, not a code problem.** No runtime code needs to change.

## Decision

Bundle the Apache-2.0 `vosk-model-small-en-us-0.15` (~40 MB) into `resources/vosk/model.tar.gz` at
build time, following the identical SHA-pinned / fail-closed / gitignored pattern already used for
the other six bundled resources (Tor, Piper, ML-KEM, Ollama runtime, embed model, TLE snapshot).
Operator confirmed the model choice and the bundle decision (2026-07-06). It is purely an
installer-size call (~875 MB → ~915 MB), not a licensing one — the model is Apache-2.0.

## Why this model, and why it works on every OS

`vosk-model-small-en-us-0.15` is the small English acoustic model from alphacephei
(https://alphacephei.com/vosk/models), Apache-2.0 licensed. It is chosen over the ~1.8 GB
`vosk-model-en-us-0.22` because the small model is licence-clean, adequate for command/dictation
STT, and negligible against the existing installer footprint.

Crucially, unlike `piper.exe` / `ollama.exe` (win-x64 **native binaries** that require per-OS
variants), the Vosk model is **pure data** unpacked and executed by `vosk-browser`'s WASM inside the
renderer. The *same* `model.tar.gz` works byte-for-byte on Windows, Linux, and macOS with zero
per-OS variants. This directly answers the operator's earlier "will it work baked in on other OS's?"
question: yes, unconditionally. The existing `extraResources` mapping (`resources/vosk → vosk`) is
already OS-agnostic.

## Architecture

Five changes, all build-side or docs. No renderer/main runtime code changes.

### 1. `scripts/fetch-vosk.mjs` (new)

Mirrors `scripts/fetch-piper.mjs`. Responsibilities, in order:

1. **Idempotency guard.** If `resources/vosk/model.tar.gz` already exists, log and exit 0.
2. **Download** `vosk-model-small-en-us-0.15.zip` from
   `https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip` to a PID-scoped temp file,
   following redirects (same `download()` helper shape as `fetch-piper.mjs`).
3. **Verify** the download against a **pinned SHA-256**, computed by downloading + hashing the real
   artifact when the script is authored (host is reachable from the build environment, so no
   fixture-capture round-trip is needed). **Fail-closed:** any mismatch deletes the download and
   exits non-zero, so a tampered/wrong artifact never ships.
4. **Re-pack** into `resources/vosk/model.tar.gz`:
   - Unzip the archive. The upstream zip nests everything under a single top-level directory
     `vosk-model-small-en-us-0.15/` containing `am/ conf/ graph/ ivector/ README ...`.
   - Produce a gzipped tar with the internal structure `vosk-browser` requires (see
     **§ Archive structure — the load-bearing invariant** below).
   - Build the tar **deterministically**: entries sorted by path, fixed mtime (0 / epoch), fixed
     uid/gid (0), fixed mode bits. Identical input → bit-identical `model.tar.gz`. This satisfies the
     charter's build-determinism commitment and lets the afterPack / CI checks reason about a stable
     artifact.
5. On any exception, remove the temp file and exit non-zero.

The re-pack transform (given an extracted model directory, emit a correctly-structured tar buffer)
is factored into a **pure, exported helper** so it is unit-testable without network.

### 2. `package.json` wiring

- Add script: `"fetch:vosk": "node scripts/fetch-vosk.mjs"`.
- Splice `pnpm fetch:vosk` into **both** the `package` and `package:win` chains (alongside the other
  `fetch:*` steps, before `pnpm build && electron-builder`).
- `build.extraResources` already contains `{ "from": "resources/vosk", "to": "vosk" }` — no change.

### 3. `.gitignore`

Add `resources/vosk/model.tar.gz` (keep `README-VOSK.txt` and the license file tracked). The 40 MB
fetched artifact never enters git, consistent with `resources/piper/win-x64/` and
`resources/local-ai/models/`.

### 4. `scripts/afterpack-verify.cjs` — build-fails-if-missing guard

The offline-embedding stack shipped **broken three times** because nothing checked the packaged
artifact. The Vosk model gets the same guard so it can never silently ship absent or truncated:

- Add a Vosk check that runs for **every** platform. Place it **above** the existing
  `if (context.electronPlatformName !== 'win32') return;` early-return, because the Vosk model is
  bundled on all platforms (unlike the win-only Ollama runtime).
- Assert `resources/vosk/model.tar.gz` exists in `context.appOutDir` **and** its size exceeds a sane
  floor (10 MB) so an empty/truncated file fails the build loudly rather than shipping a dead
  feature.
- The size-floor predicate is factored into a small pure helper for unit testing.

### 5. Docs + license

- **Rewrite `resources/vosk/README-VOSK.txt`** from "operator-supplied" to "bundled at build time,"
  recording provenance: model name, source URL, pinned SHA-256, Apache-2.0, and the fetch-script
  reference. **Correct the archive-structure guidance**: replace the current (wrong) "files at the
  archive root" instruction with the documented `model/`-rooted structure the re-pack now produces.
- **Add the upstream Apache-2.0 `LICENSE`** text alongside the README (`resources/vosk/LICENSE-VOSK`
  or equivalent), included verbatim from the model distribution — accurate attribution, not a
  paraphrase.

## Archive structure — the load-bearing invariant

**This is the single highest-risk detail.** If the tar's internal structure is wrong, `createModel`
fails and voice input is dead — a failure mock-based tests cannot see.

Two candidate structures, and the two docs disagree:

- **Upstream `vosk-browser` README ("Model format")**: the tar is "a gzipped tar archive of a model
  folder," listing paths as `model/am/final.mdl`, `model/conf/model.conf`, `model/graph/…`, etc. —
  i.e. a single top-level directory named literally `model/`. The `createModel('model.tar.gz')`
  example reinforces this convention.
- **Our internal `README-VOSK.txt`** (pre-existing, unverified): instructs flattening "such that the
  model files are at the archive root, not nested under the folder name." **This contradicts
  upstream and is wrong — it must be corrected.**

**Resolution — follow vosk-browser's documented contract; verify the artifact against it
structurally.** The originally-specified headless-Chromium load-test is **not achievable in this
project**: Playwright is not a dependency, and the repo's "headless" tests run on jsdom, which cannot
execute vosk-browser's WASM Web Worker. Rather than bolt a ~150 MB Chromium dev-dependency onto the
repo for a single test, the structure is fixed to vosk-browser's **documented** format — a top-level
directory named literally **`model/`** — and the re-pack renames the upstream
`vosk-model-small-en-us-0.15/` root to `model/`, producing entries `model/am/final.mdl`,
`model/conf/mfcc.conf`, `model/conf/model.conf`, `model/graph/HCLr.fst`, `model/graph/Gr.fst`,
`model/graph/phones/word_boundary.int`, `model/ivector/final.dubm`, … A **structural-parity test**
(pure, CI-runnable, no browser) lists the produced `model.tar.gz` and asserts the documented model
files are present under the `model/` prefix. This matches the library's published contract exactly
and proves the produced artifact conforms to it.

**Verified model contents (real, inspected 2026-07-06).** The upstream zip's top-level directory is
`vosk-model-small-en-us-0.15/`, containing `am/final.mdl`, `conf/{mfcc,model}.conf`,
`graph/{HCLr,Gr}.fst` + `graph/disambig_tid.int` + `graph/phones/word_boundary.int`, and
`ivector/{final.dubm,final.ie,final.mat,global_cmvn.stats,online_cmvn.conf,splice.conf}`, plus a
`README`. **Note:** this small model ships the lookahead graph split (`HCLr.fst` + `Gr.fst`), **not** a
single `HCLG.fst` — the parity test must assert the files that actually exist, never `HCLG.fst`.
**Pinned SHA-256** of `vosk-model-small-en-us-0.15.zip`:
`30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498` (41,205,931 bytes).

## Testing

- **Re-pack helper (unit, node):** given a synthetic extracted directory (whose top folder is named
  like the upstream `vosk-model-small-en-us-0.15/`), the produced tar's entries are re-rooted under
  `model/` — asserting `model/am/final.mdl` etc. are present and that **no** entry retains the
  original `vosk-model-small-en-us-0.15/` prefix. Also asserts deterministic byte output on repeated
  runs (identical input → identical tar bytes).
- **Structural-parity against the documented contract (unit, node, gated):** list the *produced*
  `resources/vosk/model.tar.gz` and assert every documented, actually-present model file exists under
  the `model/` prefix (`model/am/final.mdl`, `model/conf/mfcc.conf`, `model/conf/model.conf`,
  `model/graph/HCLr.fst`, `model/graph/Gr.fst`, `model/graph/phones/word_boundary.int`,
  `model/ivector/final.dubm`). This is the authoritative structure check. It requires the built
  artifact, so it is skipped with a clear message when `model.tar.gz` is absent (mirroring how other
  artifact-dependent tests degrade).
- **afterPack size-floor (unit, node):** the predicate rejects a missing file and an under-floor
  file, accepts an over-floor file.

### Honest verification limits

CI proves the produced artifact **conforms to vosk-browser's documented model format** (correct
`model/`-rooted structure, all required files present, deterministic bytes). It does **not** execute
the model in vosk-browser's WASM runtime — Playwright is not available and jsdom cannot run the WASM
Web Worker, and adding a Chromium harness for one test is out of scope (YAGNI). The final runtime
links — `createModel` actually loading this tar, and the live `getUserMedia` → `AudioContext` →
`ScriptProcessor` mic-capture graph — are confirmed only in the shipped Electron app on the
operator's / GhostExodus's Windows box, exactly as `recognizer.ts` already documents for itself. The
spec does not claim headless CI covers the runtime load; it claims (and proves) documented-contract
conformance.

## Charter compliance

- **No new egress.** The model is fetched at *build* time only; at runtime it is served entirely
  in-process via `ga98model://` — no file or request leaves the box. No telemetry.
- **Determinism.** Pinned SHA-256 + reproducible tar → a fixed, verifiable artifact.
- **No fabricated claims.** The Apache-2.0 license is stated because the model *is* Apache-2.0 per
  alphacephei; the upstream LICENSE ships verbatim. The archive structure is *verified*, not
  asserted from a doc that we've shown to be internally contradictory.

## Out of scope (YAGNI)

- No renderer changes. Once `model.tar.gz` exists, `status().installed` becomes true and the "needs a
  Vosk model" banner correctly becomes a dormant graceful-degradation fallback.
- No larger model tier, no model picker, no runtime download/update mechanism.
- No change to the mic/audio-graph code in `recognizer.ts`.
