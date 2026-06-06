/**
 * Piper TTS — pure, deterministic helpers (no electron, no fs, no spawn) so they're fully unit-
 * testable. The impure sidecar (piper-tts.ts) composes these with process spawning + path/electron
 * concerns. Keeping the decisions here mirrors the chat stack's pure-codec/impure-shell split.
 */
import { createHash } from 'node:crypto';

/** Piper's `length_scale` controls duration: >1 slows speech, <1 speeds it. The app's TTS rate runs
 *  0.5–2.0 with 1.0 = normal (Web Speech semantics), so length_scale is the inverse, clamped to a
 *  sane range so an out-of-band rate can't produce absurd audio. */
export function rateToLengthScale(rate: number | undefined): number {
  const r = typeof rate === 'number' && Number.isFinite(rate) ? rate : 1;
  const clampedRate = Math.min(2, Math.max(0.5, r));
  const lengthScale = 1 / clampedRate;
  // 1/[0.5..2] = [2..0.5]; clamp defensively in case the formula ever changes.
  return Math.min(2, Math.max(0.5, lengthScale));
}

/** Build the Piper CLI args for synthesizing to a WAV stream on stdout. Text is fed via stdin (not an
 *  arg) so it never lands in the process table. `--output_file -` writes WAV to stdout. */
export function buildPiperArgs(modelPath: string, lengthScale: number): string[] {
  if (!modelPath) throw new Error('piper: model path required');
  const ls = Number.isFinite(lengthScale) ? lengthScale : 1;
  return ['--model', modelPath, '--length_scale', String(ls), '--output_file', '-'];
}

/** Minimal RIFF/WAVE header sanity check — rejects a non-WAV / truncated blob before the renderer
 *  hands it to the audio decoder. Not a full parser; just enough to fail closed on garbage. */
export function isValidWavHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 44) return false; // smallest canonical WAV header
  // 'RIFF' .... 'WAVE'
  return (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45 // WAVE
  );
}

/** Verify a binary's SHA-256 against a pinned lowercase-hex digest (verify-before-exec). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function verifySha256(bytes: Uint8Array, expectedHex: string): boolean {
  return sha256Hex(bytes) === expectedHex.toLowerCase();
}
