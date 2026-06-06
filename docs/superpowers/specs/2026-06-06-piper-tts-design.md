# DCS98 — Piper TTS design

Status: **approved (brainstorm), pending spec review** — 2026-06-06.

## Goal

Give the app a guaranteed high-quality, fully-offline neural voice that ships WITH
the installer, so TTS quality no longer depends on what voices the user's OS happens
to have installed (and never risks a cloud voice). Piper becomes a **selectable
engine** alongside the existing Web Speech path; when Piper is present it is the
default, with Web Speech retained as fallback and for users who prefer an OS voice.

Decisions locked in the brainstorm:
- **Augment, not replace** — engine selector; Piper default when available, Web
  Speech fallback.
- **Bundle both** the Piper binary and one voice model in the installer (turnkey,
  air-gap friendly, zero runtime/first-run network).
- **High** quality voice tier (fidelity prioritized; slower synth → mitigated by
  sentence-chunked streaming, below).

## Non-goals

- Replacing or removing the Web Speech path.
- STT / voice input changes (the Vosk path is untouched).
- Any network egress. Piper is strictly local; the model is bundled, so there is no
  download flow at all.
- Multiple bundled voices / voice switching UI (one bundled voice for v1; YAGNI).

## Architecture

### Engine abstraction (renderer)
- New setting `ai.ttsEngine: 'system' | 'piper'` (default chosen at runtime: `piper`
  if available, else `system`).
- `src/renderer/audio/tts.ts` gains a dispatcher: `'system'` → the existing Web
  Speech `speak()` (unchanged); `'piper'` → the new Piper player. The public
  `speak()/cancelSpeech()/isSpeaking()` seam keeps the same shape so the AI assistant
  and the hands-free voice loop don't care which engine is active.

### Main-process sidecar (`src/main/services/piper-tts.ts`)
- Locates the bundled binary + voice model: `app.isPackaged ? process.resourcesPath
  : join(app.getAppPath(), 'resources')` + `piper/<platform>/`.
- **Verify-before-exec:** SHA-256-checks the binary against a pinned hash before the
  first spawn (same posture as the Tor bundle). Mismatch → unavailable, fail-closed.
- Synthesis: spawn `piper --model <voice>.onnx [--length_scale N]`, write the text to
  stdin, read a WAV stream from stdout. **No network, binds nothing.** One short-lived
  process per chunk; killed on cancel.
- `piperStatus()` → `{ available: boolean }` (binary + model present and verified).

### IPC
- `channels.tts.synthesize(text) → ArrayBuffer` (WAV bytes). Arg validated: bound
  length, strip control chars (new `ensureTtsText`).
- `channels.tts.piperStatus() → { available: boolean }`.
- Handlers via `safeHandle`. Not GATE_EXEMPT (consistent default; the AI assistant
  already runs behind unlock). Stateless text→audio; touches no case data or secrets.

### Renderer playback (`src/renderer/audio/piper.ts`)
- An `AudioContext`-backed queue that decodes + plays returned WAV buffers in order.
- `cancel()` stops playback and clears the queue (and the dispatcher tells main to
  kill any in-flight synth via a fresh `synthesize` superseding / an abort).

## Data flow + latency (sentence-chunked streaming)

High-quality synth of a long reply whole would delay first audio by seconds. So:
1. On AI reply complete (or for a hands-free turn), the renderer splits the text into
   sentence chunks: split on `.!?` + newline boundaries, coalescing to a max chunk
   length and never exceeding the utterance cap.
2. Pipeline: for each chunk, `tts.synthesize(chunk)` → WAV → enqueue to the player.
   Chunk N plays while chunk N+1 synthesizes → delay-to-first-audio ≈ one short
   sentence rather than the whole reply.
3. `cancelSpeech()` aborts the pipeline, clears the queue, and kills the in-flight
   Piper process.

Rate: the existing `ai.ttsRate` (0.5–2.0) maps to Piper `length_scale ≈ 1/rate`
(higher rate → shorter length_scale → faster speech), clamped to Piper's sane range.

## Packaging

- `package.json` `extraResources` adds `{ from: 'resources/piper', to: 'piper' }`.
- `scripts/fetch-piper.mjs`: pinned Piper release version + **SHA-256 fail-closed**
  verification + extraction into `resources/piper/<platform>/` (mirrors
  `scripts/fetch-tor.mjs`); run as a `package:win` pre-step. Binaries `.gitignore`d;
  a `README-PIPER.txt` records provenance + the pinned version/hash.
- **Voice model + license:** the exact voice is selected from `rhasspy/piper-voices`
  (High tier) and its license is **verified against the HuggingFace model card
  (primary source)** and recorded here before bundling. No license is asserted from
  memory. Acceptance constraint: the bundled voice's license must permit
  redistribution within the app (CC0 / public-domain / permissive preferred; a CC-BY
  voice is acceptable only with proper attribution shipped in-app + NOTICE).

  > **OPEN (resolve in plan/impl, blocking the bundle step):** pick the specific High
  > voice, fetch its `MODEL_CARD`, record voice id + license + attribution text here.

## Error handling

- Binary/model missing or SHA mismatch → `available:false` → UI hides Piper, engine
  resolves to `system`.
- `speak()` requested with `engine:'piper'` but unavailable → fall back to `system`;
  surface the reason once (toast), don't fail silently.
- Synth timeout / nonzero exit / malformed WAV → stop the pipeline, surface once.
- A new `speak()` cancels the prior utterance (kills in-flight process, clears queue).

## Components

**New:** `src/main/services/piper-tts.ts`, `src/renderer/audio/piper.ts`,
`scripts/fetch-piper.mjs`, `resources/piper/` (bundled, operator/CI-supplied).
**Modify:** `src/renderer/audio/tts.ts` (engine dispatcher), `src/shared/types.ts`
(`ai.ttsEngine` + default), `src/shared/ipc-contracts.ts` (tts channels),
`src/main/ipc/register.ts` (handlers + `ensureTtsText`), `src/preload/index.ts` +
`api.d.ts` (tts surface), `src/renderer/modules/ai-assistant/AiAssistantModule.tsx`
(engine selector beside the existing voice/rate controls),
`src/renderer/voice/conversation.ts` (hands-free loop via the dispatcher),
`package.json` (extraResources + fetch step), `src/main/security/validate.ts`
(`ensureTtsText`).

## Testing

Pure/deterministic units (paths injected, no real spawn — mirrors the chat codec
tests):
- sentence-chunker: boundary splitting, max-length coalescing, cap enforcement,
  no-empty-chunk.
- Piper arg-builder: model path + length_scale from rate.
- rate → length_scale mapping (clamping, inversion).
- WAV-header sanity check (reject non-RIFF / truncated).
- SHA-256 verify (match / mismatch → unavailable).

Integration (manual / Xvfb smoke, gated out of the fast suite): real spawn produces
playable audio; engine selector switches paths; cancel kills synth; fallback to
system when the binary is absent.

## Verification floor

`pnpm typecheck` + `pnpm test` green (new unit tests); manual Electron-under-Xvfb
smoke of a spoken reply via Piper + a cancel + a fallback-to-system; voice license
verified against primary source and recorded above; then ship behind the existing
opt-in TTS toggle.
