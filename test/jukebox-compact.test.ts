// test/jukebox-compact.test.ts
import { describe, it, expect } from 'vitest';
import { defaultSettings } from '../src/shared/types';
import { mergeSettings } from '../src/main/storage/json-fs';
import { jukeboxWindowHeight, JUKEBOX_COMPACT_H, JUKEBOX_EXPANDED_H } from '../src/renderer/modules/media/jukebox-window';

describe('jukeboxExpanded setting', () => {
  it('defaults to false (compact)', () => {
    expect(defaultSettings.media.jukeboxExpanded).toBe(false);
  });
  it('survives an upgrade from a settings file that predates it', () => {
    const legacy = { ...defaultSettings, media: { streamingEnabled: true, visualizer: false } } as any;
    const merged = mergeSettings(defaultSettings, legacy);
    expect(merged.media.jukeboxExpanded).toBe(false);      // default filled in
    expect(merged.media.streamingEnabled).toBe(true);      // legacy value preserved
  });
  it('ai.webSearchClearnetMode defaults to "fallback" and survives merge', () => {
    expect(defaultSettings.ai.webSearchClearnetMode).toBe('fallback');
    const legacy = { ...defaultSettings, ai: { ...defaultSettings.ai } } as any;
    delete legacy.ai.webSearchClearnetMode;
    expect(mergeSettings(defaultSettings, legacy).ai.webSearchClearnetMode).toBe('fallback');
  });
});

describe('jukebox window height (fits the frame to the mode)', () => {
  it('compact is shorter than expanded so no empty slab is left below the deck', () => {
    expect(jukeboxWindowHeight(true)).toBe(JUKEBOX_COMPACT_H);
    expect(jukeboxWindowHeight(false)).toBe(JUKEBOX_EXPANDED_H);
    expect(JUKEBOX_COMPACT_H).toBeLessThan(JUKEBOX_EXPANDED_H);
  });
  it('registration default height matches the compact height (fresh window opens deck-sized)', () => {
    expect(JUKEBOX_COMPACT_H).toBe(270);
  });
});
