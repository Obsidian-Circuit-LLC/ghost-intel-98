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
