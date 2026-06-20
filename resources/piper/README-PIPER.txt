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

VOICE MODELS
------------
Five voices are bundled. The first (en_US-ljspeech-high) is the public-domain default used unless
the user selects a character voice. The remaining four are studio-character-derived voices bundled
per operator decision; they carry the copyright notices listed below.

  [1] en_US-ljspeech-high  (US English, female, single speaker; 22,050 Hz)  — DEFAULT
  Source:   rhasspy/piper-voices (https://huggingface.co/rhasspy/piper-voices)
  Path:     en/en_US/ljspeech/high/
  Files:    en_US-ljspeech-high.onnx, en_US-ljspeech-high.onnx.json
  SHA-256 (.onnx):      5d4f08ba6a2a48c44592eed3ce56bf85e9de3dd4e20df90541ae68a8310c029a
  SHA-256 (.onnx.json): 7e1f4634af596d83cca997fb7a931ba80b70f8a316a2655ee69c55365e0ace14
  Dataset:  LJ Speech (https://keithito.com/LJ-Speech-Dataset/)
  License:  PUBLIC DOMAIN  (per the model card; the LJ Speech dataset is public domain in the USA
            and likely elsewhere). No attribution obligation — chosen specifically so the voice can
            be redistributed in the installer with zero licensing encumbrance.
  Verified against primary-source model card 2026-06-06:
  https://huggingface.co/rhasspy/piper-voices/raw/main/en/en_US/ljspeech/high/MODEL_CARD

  [2] jarvis-medium  (British English male; character voice)
  Source:   jgkawell/jarvis (https://huggingface.co/jgkawell/jarvis)
  Path:     en/en_GB/jarvis/medium/
  Files:    jarvis-medium.onnx, jarvis-medium.onnx.json
  SHA-256 (.onnx):      3f6534bd4050931b4c7d16ef777bafa2d90eb1e7baa8af9358623ffe609506da
  SHA-256 (.onnx.json): f2c2d77f64ed6e771fc7d2defa59cd47d6bd03c3e7602c732d63ea46954f2553
  License:  MIT (per repository; model is studio-character-derived)
  Pinned:   2026-06-21

  [3] hal  (HAL 9000; character voice)
  Source:   campwill/HAL-9000-Piper-TTS (https://huggingface.co/campwill/HAL-9000-Piper-TTS)
  Files:    hal.onnx, hal.onnx.json
  SHA-256 (.onnx):      0e08c82dc027bc72b8b839324801709e205e8c201ccae171b92e37a664d94361
  SHA-256 (.onnx.json): cb6f82c03fc9e6db1f3b6978b9601bab9854f92c40d3a0681501944b8c26745e
  License:  Apache-2.0 (per repository; model is studio-character-derived)
  Pinned:   2026-06-21

  [4] wheatley1  (Wheatley from Portal 2; character voice)
  Source:   davet2001/wheatley1 (https://huggingface.co/davet2001/wheatley1)
  Files:    wheatley1.onnx, wheatley1.onnx.json
  SHA-256 (.onnx):      cb8c1e88856de3d0d052ee4596f99b7cabb12be48538bad2f98ba7bd086df882
  SHA-256 (.onnx.json): 99409ff9380b6cb3b1e01cc2009e2151ff5168784897294132d35029bd84fabf
  License:  No declared upstream license in repository at time of pinning (2026-06-21).
            Bundled per operator decision.
  Pinned:   2026-06-21

  [5] en_US-glados-high  (GLaDOS from Portal; character voice)
  Source:   csukuangfj/vits-piper-en_US-glados-high
            (https://huggingface.co/csukuangfj/vits-piper-en_US-glados-high)
  Files:    en_US-glados-high.onnx, en_US-glados-high.onnx.json
  SHA-256 (.onnx):      eb89e52ec68d16c3763cccee6b381bb0adc72a2c2dbe41b011f5702f780302e4
  SHA-256 (.onnx.json): f83744ff6aa6138ebade1357b65b3f8456bc00b9edb913ab78674eb323ca32d0
  License:  No declared upstream license in repository at time of pinning (2026-06-21).
            Bundled per operator decision.
  Pinned:   2026-06-21

NO RUNTIME EGRESS
-----------------
  Piper synthesizes entirely on-device (text in via stdin, WAV out via stdout). It
  makes no network calls, and because the model is bundled there is no download path
  at runtime. This is consistent with the project's no-cloud / no-telemetry charter.

BUMPING
-------
  Update PIPER_VERSION and/or the VOICES array SHA-256 constants together in
  scripts/fetch-piper.mjs (and the piper.exe hash in src/main/services/piper-tts.ts),
  re-verifying each artifact against its source. Update this README to match.
