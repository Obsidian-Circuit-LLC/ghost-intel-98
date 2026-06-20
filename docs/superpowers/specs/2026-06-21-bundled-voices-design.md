# Bundled Character Voices — Design

**Date:** 2026-06-21
**Surface:** Ghost Intel 98 core app (`/dcs98`) — Piper TTS bundling + voice enumeration
**Status:** Approved for planning

## Goal

Ship four additional Piper voices in the installer — **Jarvis, HAL 9000, GLaDOS, Wheatley** — alongside
the existing public-domain default, and make them selectable in the assistant's voice picker. Builds on
the v3.16.1 user-voices machinery (which only enumerated *user* voices); this adds **bundled** voice
enumeration with an explicit default.

## Operator decisions (locked)

- Voices: **Jarvis** (jgkawell/jarvis, MIT), **HAL 9000** (campwill/HAL-9000-Piper-TTS, Apache-2.0),
  **GLaDOS** (csukuangfj/vits-piper-en_US-glados-high, no declared license), **Wheatley**
  (davet2001/wheatley1, no declared license). Federation Computer **dropped** (no fetchable model).
- **LJ Speech stays the default** voice (public-domain) — the character voices are opt-in selections.
- Installer grows ~508 MB → **~846 MB** (+338 MB).
- **Copyright posture (recorded, operator's accepted legal call):** all four are studio-character-derived
  (the reason rhasspy declined to host Jarvis); GLaDOS and Wheatley additionally carry **no declared
  upstream license**. This is the operator's informed decision as the LLC's authority; the default
  shipped voice remains public-domain to keep the out-of-box experience clean.

## Context (grounding facts)

- `scripts/fetch-piper.mjs` fetches ONE voice (`en_US-ljspeech-high`) + the binary into
  `resources/piper/win-x64/`, each SHA-256-pinned, fail-closed.
- `piper-tts.ts` `resolvePaths()` caches `{binary, model}` where `model` = the **first** `.onnx` in
  that dir — ambiguous once multiple voices are present.
- v3.16.1 added `piper-voices.ts` (`listUserVoices`, `resolveUserModelPath` over `<dataRoot>/voices/`),
  the `ai.piperVoice` setting, `tts.listVoices` (currently returns only USER voices), and the assistant
  voice picker (`(bundled neural)` + user voices) + `📁 Voices` reveal.
- A Piper voice = `<name>.onnx` + `<name>.onnx.json`. Verified upstream model files:
  - Jarvis: `…/jarvis/medium/jarvis-medium.onnx` (+ `.json`) — 60.6 MB
  - HAL: `campwill/HAL-9000-Piper-TTS/…/hal.onnx` (+ `.json`) — 60.6 MB
  - Wheatley: `davet2001/wheatley1/…/wheatley1.onnx` (+ `.json`) — 108.9 MB
  - GLaDOS: `csukuangfj/vits-piper-en_US-glados-high/…/en_US-glados-high.onnx` (+ `.json`) — 108.4 MB

## Architecture

### 1. `scripts/fetch-piper.mjs` — multi-voice fetch (generalize)

Replace the single `VOICE`/`MODEL_URL`/`CONFIG_URL` with a `VOICES` array, each entry
`{ id, modelUrl, modelSha, configUrl, configSha }`. The first entry is `en_US-ljspeech-high` (default,
public-domain, existing pins, unchanged). Add the four character voices, each model + config
SHA-256-pinned and fail-closed (identical verify-then-keep / mismatch-aborts logic, looped). The
idempotency check becomes "all voices present"; each is dropped into `resources/piper/win-x64/` as
`<filename>.onnx` + `.onnx.json`. SHAs are computed once during implementation (download → hash → pin).
`resources/piper/README-PIPER.txt` provenance is updated to list all five voices + their declared
licenses + the character-copyright note.

### 2. `piper-voices.ts` — bundled enumeration + default (extend)

- `bundledVoicesDir(): string` → `resources/piper/<platform>/` (mirror `piper-tts.ts`'s `piperDir`).
- `DEFAULT_BUNDLED_ID = 'en_US-ljspeech-high.onnx'`.
- `BUNDLED_NAMES: Record<string,string>` — friendly labels:
  `{ 'en_US-ljspeech-high.onnx':'Bundled neural (LJ Speech)', 'jarvis-medium.onnx':'Jarvis',
     'hal.onnx':'HAL 9000', 'wheatley1.onnx':'Wheatley', 'en_US-glados-high.onnx':'GLaDOS' }`
  (each filename → display name; unknown → filename-without-`.onnx`, same fallback as user voices).
- `listBundledVoices(deps?)` — same scan/validate as `listUserVoices` but over `bundledVoicesDir()`,
  applying `BUNDLED_NAMES`. **Excludes** the default id (it's surfaced separately as the picker's
  "default" option).
- `resolveBundledModelPath(voiceId, deps?)` — traversal-safe scan-match over the bundled dir (returns
  a path only for a scanned basename, else `null`), reusing the v3.16.1 pattern.
- The shared `VoicesDeps` interface and the dep-injection style carry over for testability.

### 3. `piper-tts.ts` — pinned default + bundled-or-user resolution (modify)

- `resolvePaths()` resolves + caches the **binary** (hash gate unchanged) and the **default model** by
  the pinned `DEFAULT_BUNDLED_ID` (fallback to the first `.onnx` only if the pinned default is absent,
  for resilience).
- `synthesize(text, rate, voiceId?)` resolution order:
  `resolveBundledModelPath(voiceId) ?? resolveUserModelPath(voiceId) ?? defaultModel`. A missing/invalid
  id silently uses the default. (Bundled checked before user so a bundled id is authoritative.)

### 4. IPC `tts.listVoices` — merge bundled + user (modify handler)

The existing `tts.listVoices` handler returns `[...await listBundledVoices(), ...await listUserVoices()]`
(bundled character voices first, then user voices). Channel/preload/api types are unchanged (still
`{ id, name }[]`).

### 5. Renderer — minimal

The picker already maps `listVoices()` into the dropdown, so the four bundled voices appear with no
new wiring. Only tweak: the default `<option value="">` label becomes `🧠 Bundled neural (LJ Speech)`
for clarity. (`piperVoice: null`/`''` → default; any id → that voice, exactly as v3.16.1.)

## Data flow

`fetch-piper.mjs` (build) → 5 voices in `resources/piper/win-x64/`. Runtime: picker → `tts.listVoices`
(bundled-extra + user) → user picks → `ai.piperVoice = id` → `speakAuto` → `synthesize(voiceId)` →
`resolveBundledModelPath(id) ?? resolveUserModelPath(id) ?? default` → piper spawns with that model.

## Error / edge handling

- Unknown/`../`/absolute/`null` `voiceId` → both resolvers return `null` → default model (never throws).
- A voice whose files failed to fetch → not in `resources/`, so not listed, not selectable.
- Pinned default missing (shouldn't happen) → first-`.onnx` fallback keeps TTS working.
- Bundled id and a user voice id colliding → bundled wins (resolution order); harmless.

## Testing (vitest node env, pure-ish over injected dirs)

Extend `test/piper-voices.test.ts`:
- `listBundledVoices`: returns valid pairs with friendly names; **excludes** the default id; applies
  the name map; ignores lone/bad-JSON entries; missing dir → `[]`.
- `resolveBundledModelPath`: resolves a known bundled id; returns `null` for traversal/absolute/unknown
  (the security assertions, same as the user-voice resolver).
- (Resolution-order — bundled-before-user — is covered by the `piper-tts` wiring; verified by typecheck
  + manual smoke since it composes the two tested resolvers.)

`fetch-piper.mjs` is a build script (not unit-tested); its correctness is the fail-closed SHA gate +
the actual build producing all five voices, confirmed in the release build.

## Charter / invariants

- The piper **binary keeps its verify-before-exec SHA gate**; every bundled voice model is SHA-256
  pinned in `fetch-piper.mjs` (fail-closed) so a tampered/wrong model never ships.
- No network at runtime, no telemetry, no new egress host; voices are fetched only at **build time**
  from pinned URLs.
- Renderer-untrusted boundary preserved: voice-id → path resolution is traversal-safe (bundled + user).
- The **default** shipped voice stays public-domain. Character voices are opt-in. Copyright caveat is
  the operator's recorded, accepted decision.
- Core change → `feat/bundled-voices` → v3.16.2 release.

## Out of scope

- Federation Computer (no fetchable model). Real-person voices (Trump/Eminem/Carlin — publicity-rights
  tier, excluded). Per-voice rate/pitch tuning; an in-app voice downloader.
