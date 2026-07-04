import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// json-fs → paths.ts imports electron's `app`; mock getPath to a temp userData dir so
// settingsStore.read() reads/writes <tmp>/GhostAccess98/settings.json. Mirrors the pattern
// used by the other store tests (e.g. case-category.test.ts).
const TMP = '/tmp/ga98-settings-upgrade-guard';
vi.mock('electron', () => ({ app: { getPath: () => TMP } }));

// imported AFTER the mock (vitest hoists vi.mock above imports)
import { settingsStore } from '../src/main/storage/json-fs';
import { defaultSettings } from '../src/shared/types';

const DATA_ROOT = join(TMP, 'GhostAccess98');
const SETTINGS_FILE = join(DATA_ROOT, 'settings.json');

function writeOnDiskSettings(obj: unknown): void {
  mkdirSync(DATA_ROOT, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(obj), 'utf8');
}

/** Top-level keys whose default value is a plain (non-array) object — the nested settings
 *  blocks that mergeSettings must deep-merge against defaults so an older saved file that
 *  predates a sub-field heals instead of dropping it. Dynamic Records (plugins,
 *  caseCategoryCollapsed) are plain objects too, but their default is {} so they pass the
 *  completeness check trivially — no special-casing needed. */
function nestedObjectKeys(): (keyof typeof defaultSettings)[] {
  return (Object.keys(defaultSettings) as (keyof typeof defaultSettings)[]).filter((k) => {
    const v = defaultSettings[k];
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  });
}

beforeEach(() => {
  rmSync(DATA_ROOT, { recursive: true, force: true });
});

describe('settings upgrade guard — a frozen pre-v3.23.0 settings.json heals through read()', () => {
  it('restores searchlight.scorer and the same-class chat/offensive/x blocks, preserving user values', async () => {
    // Load the committed frozen fixture (a real older-schema file). Strip the doc-only _comment.
    const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/settings-pre-v3.23.0.json'), 'utf8'));
    delete fixture._comment;
    writeOnDiskSettings(fixture);

    const s = await settingsStore.read();

    // The reported regression: scorer was undefined → the sweep IPC handler threw. It must
    // now be the full default scorer block, with the user's persisted toggle preserved.
    expect(s.searchlight.scorer).toEqual(defaultSettings.searchlight.scorer);
    expect(s.searchlight.networkEnabled).toBe(true);          // user value from the fixture
    expect(s.searchlight.torConcurrency).toBe(8);             // user value from the fixture

    // Same-class blocks the fixture carried as stale subsets must regain their newer fields.
    expect(s.chat.networkEnabled).toBe(defaultSettings.chat.networkEnabled);
    expect(s.offensive.confirmMode).toBe('per-session');                                  // kept
    expect(s.offensive.requireSignedAuthorization).toBe(defaultSettings.offensive.requireSignedAuthorization); // healed
    expect(s.x.networkEnabled).toBe(false);                                               // kept
    expect(s.x.clearnetAcknowledged).toBe(defaultSettings.x.clearnetAcknowledged);        // healed
  });
});

describe('settings upgrade guard — geoint.cctvResolveHosts (Tor-only host resolution toggle)', () => {
  it('upgrades an old geoint block with no cctvResolveHosts to the default (true)', async () => {
    // A settings.json persisted before cctvResolveHosts existed: geoint present, field absent.
    writeOnDiskSettings({ geoint: { networkEnabled: true, cctvOverTor: true } });

    const s = await settingsStore.read();

    expect(s.geoint.cctvResolveHosts).toBe(true);          // healed to default
    expect(s.geoint.cctvOverTor).toBe(true);               // pre-existing user value kept
    expect(s.geoint.networkEnabled).toBe(true);            // pre-existing user value kept
  });

  it('preserves a stored cctvResolveHosts=false across the merge (not clobbered by the default)', async () => {
    writeOnDiskSettings({ geoint: { cctvResolveHosts: false } });

    const s = await settingsStore.read();

    expect(s.geoint.cctvResolveHosts).toBe(false);         // user opt-out survives
  });
});

describe('settings upgrade guard — ai.webSearchClearnet (opt-in clearnet fallback)', () => {
  it('upgrades an old ai block with no webSearchClearnet to the default (false)', async () => {
    // A settings.json persisted before webSearchClearnet existed: ai present, field absent.
    writeOnDiskSettings({ ai: { webSearch: true } });

    const s = await settingsStore.read();

    expect(s.ai.webSearchClearnet).toBe(false);   // healed to default (off)
    expect(s.ai.webSearch).toBe(true);            // pre-existing user value kept
  });

  it('preserves a stored webSearchClearnet=true across the merge (not clobbered by the default)', async () => {
    writeOnDiskSettings({ ai: { webSearchClearnet: true } });

    const s = await settingsStore.read();

    expect(s.ai.webSearchClearnet).toBe(true);    // user opt-in survives
  });
});

describe('settings upgrade guard — completeness: every nested block survives a stale on-disk block', () => {
  it('keeps all default sub-fields for EVERY nested settings object (catches a future block left out of the merge)', async () => {
    // Synthesize the worst case for every nested block at once: present-but-empty, simulating
    // a saved file that predates ALL of that block's current sub-fields. Any nested object the
    // merge forgets is replaced wholesale by {} and loses its defaults — failing this test.
    const stale: Record<string, unknown> = {};
    for (const k of nestedObjectKeys()) stale[k] = {};
    writeOnDiskSettings(stale);

    const merged = (await settingsStore.read()) as unknown as Record<string, unknown>;

    for (const k of nestedObjectKeys()) {
      // An empty on-disk block must merge back to the full default block.
      expect(merged[k], `nested settings block "${String(k)}" lost its defaults on upgrade — add it to mergeSettings`)
        .toEqual(defaultSettings[k]);
    }
  });
});
