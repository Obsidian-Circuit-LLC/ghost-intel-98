import { describe, it, expect } from 'vitest';
import { defaultSettings } from '../src/shared/types';
import { mergeSettings } from '../src/main/storage/json-fs';

describe('media.eq + media.jukeboxMode settings', () => {
  it('defaults: EQ off/flat, jukeboxMode strip', () => {
    expect(defaultSettings.media.jukeboxMode).toBe('strip');
    expect(defaultSettings.media.eq).toEqual({ enabled: false, gains: new Array(10).fill(0), preset: 'Flat' });
  });
  it('a legacy settings blob without eq/jukeboxMode upgrades with defaults, keeping siblings', () => {
    const legacy = { ...defaultSettings, media: { streamingEnabled: true, visualizer: false, jukeboxExpanded: true } } as any;
    const m = mergeSettings(defaultSettings, legacy);
    expect(m.media.streamingEnabled).toBe(true);         // sibling preserved
    expect(m.media.jukeboxMode).toBe('strip');           // default filled
    expect(m.media.eq.preset).toBe('Flat');              // default filled
  });
  it('a partial eq patch deep-merges (does not drop gains/preset)', () => {
    const m = mergeSettings(defaultSettings, { media: { eq: { enabled: true } } } as any);
    expect(m.media.eq.enabled).toBe(true);
    expect(m.media.eq.gains).toHaveLength(10);
    expect(m.media.eq.preset).toBe('Flat');
  });
});
