import { describe, it, expect } from 'vitest';
import { mergeSettings } from '../src/main/storage/json-fs';
import { defaultSettings } from '../src/shared/types';
import { DEFAULT_SEARXNG_ONION } from '../src/main/services/web-search/searxng';

/**
 * Task 3 (multi-engine search): a persisted settings.json written by a build that
 * predates the search-engine picker has an `ai` block with no `searchEngine` and no
 * `searxngOnion` field. mergeSettings deep-merges `ai` via `{ ...base.ai, ...patch.ai }`,
 * so both new fields must be restored from defaults on upgrade while every existing
 * `ai` field the user persisted is preserved.
 */
describe('mergeSettings — ai.searchEngine / ai.searxngOnion survive an old on-disk ai block', () => {
  it('restores searchEngine/searxngOnion defaults when the persisted ai block predates them', () => {
    // Simulate a pre-picker settings.json: ai present, but no searchEngine/searxngOnion.
    const onDisk = {
      ai: {
        provider: 'ollama',
        endpoint: 'http://localhost:11434',
        model: 'qwen3-abliterated:4b',
        webSearch: true,
        webSearchClearnet: false,
      },
    } as unknown as Partial<typeof defaultSettings>;

    const merged = mergeSettings(defaultSettings, onDisk);

    // The two new fields must NOT be undefined — they fall back to defaults.
    expect(merged.ai.searchEngine).toBe('ddg');
    expect(merged.ai.searxngOnion).toBe(DEFAULT_SEARXNG_ONION);
    // The default onion is the operator's verified pinned instance.
    expect(merged.ai.searxngOnion.endsWith('.onion')).toBe(true);
    // The user's persisted ai fields are preserved.
    expect(merged.ai.provider).toBe('ollama');
    expect(merged.ai.webSearch).toBe(true);
    expect(merged.ai.webSearchClearnet).toBe(false);
  });

  it('keeps an operator-overridden searchEngine/searxngOnion, restoring untouched ai defaults', () => {
    const onDisk = {
      ai: {
        searchEngine: 'searxng',
        searxngOnion: 'http://exampleoperatoroverrideabcdefghijklmnopqrstuvwxyz234567.onion',
      },
    } as unknown as Partial<typeof defaultSettings>;

    const merged = mergeSettings(defaultSettings, onDisk);

    expect(merged.ai.searchEngine).toBe('searxng');                       // override kept
    expect(merged.ai.searxngOnion).toBe('http://exampleoperatoroverrideabcdefghijklmnopqrstuvwxyz234567.onion');
    // Untouched ai defaults are restored.
    expect(merged.ai.provider).toBe(defaultSettings.ai.provider);
    expect(merged.ai.webSearch).toBe(defaultSettings.ai.webSearch);
  });

  it('defaultSettings.ai ships the picker fields with the pinned onion', () => {
    expect(defaultSettings.ai.searchEngine).toBe('ddg');
    expect(defaultSettings.ai.searxngOnion).toBe(DEFAULT_SEARXNG_ONION);
  });
});
