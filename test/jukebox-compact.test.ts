// test/jukebox-compact.test.ts
import { describe, it, expect } from 'vitest';
import { defaultSettings } from '../src/shared/types';
import { mergeSettings } from '../src/main/storage/json-fs';

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
