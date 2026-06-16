Ghost Intel 98 — Bundled Piper TTS (offline neural text-to-speech)
=========================================================

The binary and voice model under resources/piper/win-x64/ are NOT committed to the
repository. They are fetched + SHA-256-verified at build time by scripts/fetch-piper.mjs
(run automatically by `pnpm package` / `pnpm package:win`). Fail-closed: a hash
mismatch aborts the build.

Pinned 2026-06-06.

BINARY
------
  Project:  rhasspy/piper  (https://github.com/rhasspy/piper)
  Release:  2023.11.14-2
  Asset:    piper_windows_amd64.zip
  URL:      https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip
  SHA-256 (zip):       f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea
  SHA-256 (piper.exe): 96f3da3811151580073e40bb4dd20eb0fb8115f5f5f76e2fb54282b3edfa5c1f
  License:  MIT (Piper engine)

  The runtime additionally re-verifies piper.exe against the piper.exe hash above
  before the first spawn (verify-before-exec), in src/main/services/piper-tts.ts.

VOICE MODEL
-----------
  Voice:    en_US-ljspeech-high  (US English, female, single speaker; 22,050 Hz)
  Source:   rhasspy/piper-voices (https://huggingface.co/rhasspy/piper-voices)
  Path:     en/en_US/ljspeech/high/
  Files:    en_US-ljspeech-high.onnx, en_US-ljspeech-high.onnx.json
  SHA-256 (.onnx):      5d4f08ba6a2a48c44592eed3ce56bf85e9de3dd4e20df90541ae68a8310c029a
  SHA-256 (.onnx.json): 7e1f4634af596d83cca997fb7a931ba80b70f8a316a2655ee69c55365e0ace14

  Dataset:  LJ Speech (https://keithito.com/LJ-Speech-Dataset/)
  License:  PUBLIC DOMAIN  (per the model card; the LJ Speech dataset is public
            domain in the USA and likely elsewhere). No attribution obligation —
            chosen specifically so the voice can be redistributed in the installer
            with zero licensing encumbrance, consistent with the project's
            CC0/permissive preference.

  Verified against the primary-source model card 2026-06-06:
  https://huggingface.co/rhasspy/piper-voices/raw/main/en/en_US/ljspeech/high/MODEL_CARD

NO RUNTIME EGRESS
-----------------
  Piper synthesizes entirely on-device (text in via stdin, WAV out via stdout). It
  makes no network calls, and because the model is bundled there is no download path
  at runtime. This is consistent with the project's no-cloud / no-telemetry charter.

BUMPING
-------
  Update PIPER_VERSION / VOICE and ALL the SHA-256 constants together in
  scripts/fetch-piper.mjs (and the piper.exe hash in src/main/services/piper-tts.ts),
  re-verifying each artifact against its source.
