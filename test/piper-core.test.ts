import { describe, it, expect } from 'vitest';
import { rateToLengthScale, buildPiperArgs, isValidWavHeader, sha256Hex, verifySha256 } from '../src/main/services/piper-core';
import { chunkText, MAX_TTS_CHARS } from '../src/renderer/audio/piper-core';

describe('piper-core (main) — pure helpers', () => {
  it('maps rate → length_scale as the clamped inverse', () => {
    expect(rateToLengthScale(1)).toBe(1);
    expect(rateToLengthScale(2)).toBe(0.5);
    expect(rateToLengthScale(0.5)).toBe(2);
    expect(rateToLengthScale(undefined)).toBe(1);
    expect(rateToLengthScale(NaN)).toBe(1);
    // out-of-band rates clamp into [0.5, 2]
    expect(rateToLengthScale(10)).toBe(0.5);
    expect(rateToLengthScale(0.01)).toBe(2);
  });

  it('builds piper args with stdin text + WAV output target', () => {
    // Default (kept for back-compat) streams to stdout.
    expect(buildPiperArgs('/m/voice.onnx', 1)).toEqual(['--model', '/m/voice.onnx', '--length_scale', '1', '--output_file', '-']);
    // The sidecar passes a seekable file path so the WAV gets correct length headers (no playback static).
    expect(buildPiperArgs('/m/voice.onnx', 1, '/tmp/out.wav')).toEqual(['--model', '/m/voice.onnx', '--length_scale', '1', '--output_file', '/tmp/out.wav']);
    expect(buildPiperArgs('/m/voice.onnx', 0.5)).toContain('0.5');
    expect(() => buildPiperArgs('', 1)).toThrow();
  });

  it('validates a RIFF/WAVE header and rejects garbage/truncation', () => {
    const hdr = new Uint8Array(44);
    hdr.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    hdr.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
    expect(isValidWavHeader(hdr)).toBe(true);
    expect(isValidWavHeader(new Uint8Array(10))).toBe(false); // too short
    const wrong = new Uint8Array(44); // all zero, no RIFF
    expect(isValidWavHeader(wrong)).toBe(false);
  });

  it('verifies SHA-256 (match + mismatch, case-insensitive)', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const h = sha256Hex(data);
    expect(verifySha256(data, h)).toBe(true);
    expect(verifySha256(data, h.toUpperCase())).toBe(true);
    expect(verifySha256(data, '00'.repeat(32))).toBe(false);
  });
});

describe('piper-core (renderer) — chunkText', () => {
  it('returns no chunks for empty / whitespace input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('keeps a short reply as a single chunk', () => {
    expect(chunkText('Hello there.')).toEqual(['Hello there.']);
  });

  it('splits on sentence boundaries and coalesces up to maxLen', () => {
    const out = chunkText('One. Two. Three.', 10);
    // 'One.' (4) + ' Two.' -> 'One. Two.' is 9 ≤ 10; '+ Three.' would exceed → new chunk
    expect(out).toEqual(['One. Two.', 'Three.']);
  });

  it('treats newlines as boundaries (separate when coalescing would exceed maxLen)', () => {
    expect(chunkText('Line one\nLine two', 8)).toEqual(['Line one', 'Line two']);
    // with generous maxLen, short newline-separated pieces coalesce (intended)
    expect(chunkText('Line one\nLine two', 100)).toEqual(['Line one Line two']);
  });

  it('hard-splits a single over-long sentence', () => {
    const long = 'a'.repeat(25);
    const out = chunkText(long, 10);
    expect(out).toEqual(['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)]);
  });

  it('bounds total input to MAX_TTS_CHARS', () => {
    const huge = `${'a'.repeat(MAX_TTS_CHARS + 500)}.`;
    const out = chunkText(huge, 1000);
    const total = out.join('').length;
    expect(total).toBeLessThanOrEqual(MAX_TTS_CHARS);
  });

  it('preserves order', () => {
    const out = chunkText('First sentence here. Second one now. Third and last.', 25);
    expect(out[0].startsWith('First')).toBe(true);
    expect(out[out.length - 1].includes('Third')).toBe(true);
  });
});
