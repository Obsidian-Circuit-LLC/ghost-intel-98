import { describe, it, expect } from 'vitest';
import { pickFormat } from '../src/main/media/library';

describe('pickFormat', () => {
  it('maps mp3 format (no bitsPerSample)', () => {
    const f = pickFormat({ bitrate: 320000, sampleRate: 44100, numberOfChannels: 2, codec: 'MPEG 1 Layer 3' });
    expect(f).toEqual({ bitrate: 320000, sampleRate: 44100, channels: 2, codec: 'MPEG 1 Layer 3' });
    expect('bitsPerSample' in f).toBe(false); // never fabricate a bit-depth
  });
  it('includes bitsPerSample when the container declares it (flac/wav)', () => {
    const f = pickFormat({ bitrate: 900000, sampleRate: 48000, numberOfChannels: 2, bitsPerSample: 16, codec: 'FLAC' });
    expect(f.bitsPerSample).toBe(16);
  });
  it('drops undefined fields entirely', () => {
    expect(pickFormat({})).toEqual({});
  });
});
