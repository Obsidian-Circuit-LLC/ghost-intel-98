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
  reference. **Correct the archive-structure guidance** to match the empirically verified structure
  (the current text's "files at the archive root" instruction conflicts with upstream and is
  resolved by the verification below — the README must state whichever structure the load test
  proves correct, not a guess).
- **Add the upstream Apache-2.0 `LICENSE`** text alongside the README (`resources/vosk/LICENSE-VOSK`
  or equivalent), included verbatim from the model distribution — accurate attribution, not a
  paraphrase.

## Archive structure — the load-bearing invariant

**This is the single highest-risk detail.** If the tar's internal structure is wrong, `createModel`
fails and voice input is dead — a failure mock-based tests cannot see.

Two candidate structures, and the two docs disagree:

- **Upstream `vosk-browser` README ("Model format")**: the tar is "a gzipped tar archive of a model
  folder," listing paths as `model/am/final.mdl`, `model/conf/model.conf`, `model/graph/HCLG.fst`,
  etc. — i.e. a single top-level `model/` directory.
- **Our internal `README-VOSK.txt`** (pre-existing, unverified): instructs flattening "such that the
  model files are at the archive root, not nested under the folder name." **This contradicts
  upstream and is suspected wrong.**

**Resolution — verify empirically against the real artifact, trust neither doc.** `vosk-browser`'s
`createModel(url)` resolves its promise only when the model loads with the correct internal
structure, and a `KaldiRecognizer` fed a canned PCM/WAV buffer emits a transcript — **none of this
requires a microphone.** A headless-Chromium (Playwright) test loads the *actually produced*
`model.tar.gz` over a local URL, awaits `createModel`, feeds a short bundled speech sample, and
asserts a non-empty result. The implementer determines the correct structure by making this test
pass (default to the upstream `model/`-prefixed layout; if `createModel` rejects, try root), then
pins that structure in `fetch-vosk.mjs` and documents it in the README. This converts the scariest
risk from "hope it works on GhostExodus's box" into a CI-verifiable fact.

## Testing

- **Re-pack helper (unit, node):** given a synthetic extracted directory, the produced tar's entries
  match the verified structure (correct prefix, model files present, deterministic byte output on
  repeated runs).
- **afterPack size-floor (unit, node):** the predicate rejects a missing file and an under-floor
  file, accepts an over-floor file.
- **Headless model-load (Playwright, gated):** the produced `model.tar.gz` loads in real Chromium
  via `createModel`, and a canned audio sample yields a non-empty transcript. This is the
  authoritative archive-structure verification. It requires the built artifact present, so it is
  skipped (with a clear message) when `resources/vosk/model.tar.gz` is absent, mirroring how other
  artifact-dependent tests degrade.

### Honest verification limits

Headless CI proves the model **loads and transcribes canned audio** — i.e. the archive structure and
the WASM path are correct. It does **not** exercise a live microphone or the `getUserMedia` →
`AudioContext` → `ScriptProcessor` capture graph; that path remains verifiable only in a real browser
with a mic on the operator's / GhostExodus's Windows box, exactly as `recognizer.ts` already
documents for itself. The spec does not claim otherwise.

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
