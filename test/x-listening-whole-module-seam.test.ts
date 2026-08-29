/**
 * Task 15/16 — whole-module seam: no `channels.xListening` channel is unreachable from the
 * renderer shell.
 *
 * This is a SOURCE-SCAN meta-test, not a re-render of every control (that behavioral coverage
 * already lives in x-listening-shell.test.tsx (Task 13), x-listening-tabs.test.tsx (Task 14),
 * and x-listening-tabs2.test.tsx (Task 15)). What THIS file catches that those can't: a future
 * channel added to `ipc-contracts.ts` that nobody ever wires a control to in
 * `XListeningModule.tsx` — the exact v3.24.2 "each side passes its own tests, the wired feature
 * is still dead" failure class, pinned as a standing invariant rather than a one-off assertion.
 *
 * Scope: EVERY `channels.xListening` key — the Phase-1 surface (session/capture/campaigns/
 * analysis/entities/presets/archive/demo/exports/media, Tasks 1-15) plus `saveNote`/
 * `readNotes`/`removeNote`. Task 16 retired the clearnet-only X1-X8 surface
 * (`connect`/`status`/`capture`/`captureThreadComments`/`captureFollowers`/`captureFollowing`/
 * `exportNetwork`/`runArchiveCycle(s)`/`exportItems`) wholesale from `ipc-contracts.ts` — every
 * surviving capture channel is Tor-safe, so there is no longer a "deliberately unused legacy"
 * carve-out to track: every key that exists must be reachable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { channels } from '../src/shared/ipc-contracts';

// The renderer "module" is the whole co-located surface under x-listening/ — the shell
// (XListeningModule.tsx) plus its extracted sub-components (PostCard.tsx renders the rich card and
// owns the `mediaRead` call, NetworkGraph.tsx the mind-map). A channel is reachable if ANY of these
// wires a control to it; scanning only the shell would falsely flag a channel that legitimately
// moved into a co-located component (Task I1 moved `mediaRead` into PostCard.tsx).
const MODULE_DIR = resolve(process.cwd(), 'src/renderer/modules/x-listening');
const MODULE_SOURCE = readdirSync(MODULE_DIR)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => readFileSync(resolve(MODULE_DIR, f), 'utf8'))
  .join('\n');

/** Every channel key that MUST be reachable from a control in XListeningModule.tsx, mapped to
 *  the exact `window.api.xListening.<method>` call the renderer makes for it. */
const REACHABLE_CHANNELS: ReadonlyArray<keyof typeof channels.xListening> = [
  // v3.72.3: read-only mutex status, polled by the "Waiting for <holder>…" indicator.
  'collectionStatus',
  // v3.72.4: operator-initiated display-picture fetch (Entity Index button).
  'fetchDisplayPictures',
  'openSession',
  'sessionStatus',
  'closeSession',
  'captureTimeline',
  'postsList',
  'campaignsList',
  'campaignsCreate',
  'campaignsSwitch',
  'campaignsUpdate',
  'campaignsDelete',
  'campaignsDuplicate',
  'campaignsMeta',
  'analysis',
  'health',
  'entities',
  'avatars',
  'presetsRead',
  'presetsSave',
  'presetsRemove',
  'presetsRun',
  'networksList',
  'archiveStatus',
  'archiveRun',
  'loadDemoData',
  'exportPostsToFile',
  'exportNetworkToFile',
  'exportNetworkJsonToFile',
  'mediaRead',
  'changeEvents',
  'verifyPost',
  'runLog',
  'networkEvents',
  'openInX',
  'captureNetwork',
  'removeSource',
  'saveNote',
  'updateNote',
  'readNotes',
  'removeNote',
  'getCollectionSettings',
  'saveCollectionSettings',
  'getImagePolicy',
  'setProfileImageMode',
  'scheduleStatus',
];

/**
 * PUSH channels (main → renderer) are reachable through a SUBSCRIBER, not a call of the same name,
 * so the orphan check needs their subscriber name. Keeping them here rather than exempting them
 * preserves the point of the check: a push channel nobody listens to is just as hollow as an
 * invoke channel nobody calls.
 */
const PUSH_CHANNELS: Partial<Record<keyof typeof channels.xListening, string>> = {
  sweepProgress: 'onSweepProgress',
};

/**
 * Channels whose control lives OUTSIDE XListeningModule.tsx, mapped to the file that calls them.
 * The reachability guarantee is the same — a channel must be driven by a real control — but the
 * control is not always in the module (the station launcher is in the module registry, because
 * choosing the station from the Access menu is what opens its standalone window).
 */
const REACHABLE_ELSEWHERE: Readonly<Record<string, string>> = {
  openStationWindow: 'src/renderer/modules/register-builtins.tsx',
};

describe('whole-module seam — every xListening channel is reachable from a real control', () => {
  it.each(Object.entries(REACHABLE_ELSEWHERE))(
    'window.api.xListening.%s(...) is called in %s',
    (key, file) => {
      expect(typeof channels.xListening[key as keyof typeof channels.xListening]).toBe('string');
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).toMatch(new RegExp(`window\\.api\\.xListening\\.${key}\\s*\\(`));
    }
  );

  it.each(REACHABLE_CHANNELS)('window.api.xListening.%s(...) is called somewhere in XListeningModule.tsx', (key) => {
    // Sanity: the channel constant itself must exist (catches a typo'd key in this very list).
    expect(typeof channels.xListening[key]).toBe('string');
    const callSite = new RegExp(`window\\.api\\.xListening\\.${key}\\s*\\(`);
    expect(MODULE_SOURCE).toMatch(callSite);
  });

  it.each(Object.entries(PUSH_CHANNELS))('push channel %s is subscribed via %s', (key, subscriber) => {
    expect(typeof channels.xListening[key as keyof typeof channels.xListening]).toBe('string');
    expect(MODULE_SOURCE).toMatch(new RegExp(`window\\.api\\.xListening\\.${subscriber}\\s*\\(`));
  });

  it('every channels.xListening key is reachable — none are orphaned', () => {
    const all = Object.keys(channels.xListening) as Array<keyof typeof channels.xListening>;
    const reachable = new Set<string>([
      ...REACHABLE_CHANNELS,
      ...Object.keys(PUSH_CHANNELS),
      ...Object.keys(REACHABLE_ELSEWHERE),
    ]);
    const orphaned = all.filter((k) => !reachable.has(k));
    // A failure here means a NEW channel was added to ipc-contracts.ts without wiring it into
    // the renderer (add it to REACHABLE_CHANNELS above once wired) — the exact "hollow channel"
    // class this test exists to catch.
    expect(orphaned).toEqual([]);
  });
});
