# User-Supplied Piper Voices — Design

**Date:** 2026-06-21
**Surface:** Ghost Intel 98 core app (`/dcs98`) — Piper TTS (main) + AI assistant TTS controls (renderer)
**Status:** Approved for planning

## Goal

Let the user add their own Piper TTS voices by dropping a `<name>.onnx` + `<name>.onnx.json` pair
into a folder, then pick one in the AI assistant's TTS controls — instead of being limited to the
single bundled public-domain voice. (This is also the charter-clean way to use a third-party/Jarvis
voice locally without bundling anything copyrighted into the installer.)

## Context (grounding facts)

- `src/main/services/piper-tts.ts` `resolvePaths()` (~:55-83) scans `resources/piper/<platform>/`,
  hash-gates the binary (verify-before-exec), and discovers the **first** `*.onnx` with its
  `.onnx.json` sidecar — a single implicit voice. `synthesize(text, rate)` (~:102-146) spawns the
  binary against that one model; the renderer passes only text + rate (no voice id).
- `src/main/services/piper-core.ts` `buildPiperArgs(modelPath, lengthScale, output)` already takes
  the model path as a parameter — per-voice synthesis is a small change.
- IPC `tts: { piperStatus, synthesize, cancel }` (`ipc-contracts.ts`); handlers in `register.ts`
  (~:325-331); preload bridge + `api.d.ts` (~:215-219).
- Settings (`shared/types.ts` ~:372-379): `ttsEnabled`, `ttsVoiceUri` (Web-Speech only),
  `ttsRate`, `ttsEngine: 'auto'|'system'|'piper'`. No per-Piper-voice selection today.
- TTS controls live in `AiAssistantModule.tsx` (~:516-556): an engine `<select>` and a Web-Speech
  voice `<select>`; when Piper is active it shows only a "🧠 offline neural" label.
- `dataRoot()` = `app.getPath('userData')/GhostAccess98`. Existing extensible-asset pattern:
  `sounds/` folder + `sounds.openFolder` IPC via shell reveal.
- A Piper voice on disk = exactly `<name>.onnx` + `<name>.onnx.json` (the sidecar carries sample
  rate / phoneme config). No content validation exists today; the model is passed straight to piper.

## Architecture

### Folder

`<dataRoot>/voices/` — flat; the user drops `<name>.onnx` + `<name>.onnx.json` pairs in. `.onnx`
models are platform-agnostic (only the bundled piper *binary* is per-platform), so no platform
subdir. Created on demand by the reveal action.

### Main — `src/main/services/piper-voices.ts` (new, pure-ish over injected fs/dir)

- `userVoicesDir(): string` → `join(dataRoot(), 'voices')`.
- `listUserVoices(deps): Promise<{ id: string; name: string }[]>` → `readdir` the voices dir;
  for each `*.onnx` whose `<onnx>.json` sibling also exists **and parses as JSON**, emit
  `{ id: <onnxFilename>, name: <onnxFilename without .onnx> }`. A lone `.onnx`, a missing or
  bad-JSON sidecar, or a missing dir → that entry skipped / `[]`. Sorted by name. Never throws.
- `resolveUserModelPath(voiceId, deps): Promise<string | null>` → **traversal-safe**: returns a
  path ONLY if `voiceId` exactly matches a basename discovered by `listUserVoices` (so the path is
  one *we* constructed via `join(userVoicesDir(), discoveredName)`), never `join(dir, rawInput)`.
  Unknown id, `null`/empty, or any `../`/absolute/dangerous input → `null`.

### Main — `src/main/services/piper-tts.ts` (modify)

- Split resolution: keep the cached binary + hash gate; resolve the **model per call**.
  `synthesize(text, rate, voiceId?)` → `const model = (voiceId ? await resolveUserModelPath(voiceId)
  : null) ?? bundledModel`. A selected-but-missing/invalid voice silently uses the bundled model.
- `piperStatus()` unchanged (binary+bundled presence). Add `listVoices()` delegating to
  `listUserVoices`, and `revealVoicesFolder()` = `mkdir -p <voices>` then `shell.openPath(dir)`.

### IPC + preload + api.d.ts

- Extend `tts.synthesize` to carry an optional `voiceId` (validated in the handler — pass through to
  `synthesize`; the trust gate is `resolveUserModelPath`, not the channel).
- Add `tts.listVoices: 'tts:listVoices'` and `tts.revealVoicesFolder: 'tts:revealVoicesFolder'`.
- Preload bridge + `api.d.ts`: `listVoices(): Promise<{id,name}[]>`,
  `revealVoicesFolder(): Promise<void>`, and `synthesize(text, rate?, voiceId?)`.

### Setting

`ai.piperVoice: string | null` (default `null` = bundled). Stored as the chosen voice `id`
(`.onnx` filename).

### Renderer

- `src/renderer/audio/piper.ts` — the synth path reads `ai.piperVoice` from settings and passes it
  as the new `voiceId` arg to `window.api.tts.synthesize`.
- `AiAssistantModule.tsx` TTS controls — when `ttsEnabled` and Piper is the active engine
  (`ttsEngine` `piper` or `auto` with piper available), render a **voice `<select>`**:
  `(bundled neural)` (value `''` → `piperVoice: null`) plus one option per `listVoices()` entry
  (value = `id`), writing `ai.piperVoice`. Beside it a **"📁 Voices folder"** button calling
  `revealVoicesFolder()`. Load the list on mount (and refresh after reveal). If the list is empty,
  just show the bundled option (+ the folder button so the user knows where to add voices).

## Data flow

Settings `piperVoice` → `audio/piper.ts` synth → `tts:synthesize(text, rate, voiceId)` →
`resolveUserModelPath(voiceId)` (traversal-safe, else bundled) → piper spawned with that model.
Picker: `tts:listVoices` populates the dropdown; `tts:revealVoicesFolder` opens the folder.

## Error / edge handling

- `voiceId` unknown / deleted / traversal / absolute → `resolveUserModelPath` returns `null` →
  bundled model used (no throw, no leak).
- Voices dir absent → `listVoices` returns `[]`; reveal `mkdir`s it first.
- Lone `.onnx` or bad-JSON sidecar → not listed (and not selectable), so never synthesized.
- No bundled voice AND no usable user voice → `piperStatus` stays `available:false` (today's path).

## Testing (vitest node env, pure-ish over a temp dir)

`test/piper-voices.test.ts`:
- `listUserVoices`: returns a complete `.onnx`+`.onnx.json` pair; **ignores** a lone `.onnx`, a
  pair whose `.onnx.json` is invalid JSON, and a missing dir (→ `[]`); result sorted by name.
- `resolveUserModelPath`: returns the user path for a valid discovered id; **returns `null` for a
  path-traversal id (`../../etc/passwd`), an absolute path, an unknown id, and `null`/empty** (the
  security assertions).

The IPC glue, the `synthesize` voiceId plumbing, the settings field, and the renderer dropdown +
reveal button are thin wiring — verified by `pnpm typecheck` + the operator's manual smoke (no React
render harness in this repo).

## Charter / invariants

- No network, no telemetry, no new egress host. User voices are local files the user supplies, so
  **nothing copyrighted is bundled** — the Jarvis-voice copyright concern doesn't ship.
- Renderer is untrusted: voice-id → model-path resolution is **traversal-safe in the main process**.
- The bundled binary keeps its verify-before-exec SHA gate; user models are user-chosen data.
- Core change → lands on `feat/user-voices` for the operator (folds into a later release, e.g. v3.16.1).

## Out of scope

- An in-app "Import voice…" file-picker that copies files into the folder (folder + reveal button
  ships now; picker is a possible later add).
- Downloading/fetching voices from any catalog (no network); per-voice speaker selection within a
  multi-speaker model; bundling any specific third-party voice.
