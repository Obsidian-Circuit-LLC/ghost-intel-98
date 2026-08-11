/**
 * Task 15 — whole-module seam: no `channels.xListening` (Phase-1 Tor-default surface) channel
 * is unreachable from the renderer shell.
 *
 * This is a SOURCE-SCAN meta-test, not a re-render of every control (that behavioral coverage
 * already lives in x-listening-shell.test.tsx (Task 13), x-listening-tabs.test.tsx (Task 14),
 * and x-listening-tabs2.test.tsx (Task 15)). What THIS file catches that those can't: a future
 * channel added to `ipc-contracts.ts` that nobody ever wires a control to in
 * `XListeningModule.tsx` — the exact v3.24.2 "each side passes its own tests, the wired feature
 * is still dead" failure class, pinned as a standing invariant rather than a one-off assertion.
 *
 * Scope: the NEW Phase-1 surface (session/capture/campaigns/analysis/entities/presets/archive/
 * demo/exports/media, Tasks 1-15) PLUS `saveNote`/`readNotes`/`removeNote` (textually grouped
 * with the retiring X1-X8 block in ipc-contracts.ts, but reused here — notes are pure,
 * namespace-agnostic store ops with no Tor/clearnet trust-boundary distinction, so the SAME
 * channel names serve the new Notes tab). Deliberately EXCLUDES the rest of the retiring X1-X8
 * surface (`connect`/`status`/`capture`/`captureThreadComments`/`captureFollowers`/
 * `captureFollowing`/`exportNetwork`/`runArchiveCycle(s)`/`exportItems`) — those are the
 * clearnet-only legacy channels Task 16 deletes; this shell deliberately never calls them
 * (see the module's own header comment), so their absence here is not a gap.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { channels } from '../src/shared/ipc-contracts';

const MODULE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/renderer/modules/x-listening/XListeningModule.tsx'),
  'utf8',
);

/** Every channel key that MUST be reachable from a control in XListeningModule.tsx, mapped to
 *  the exact `window.api.xListening.<method>` call the renderer makes for it. */
const REACHABLE_CHANNELS: ReadonlyArray<keyof typeof channels.xListening> = [
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
  'analysis',
  'health',
  'entities',
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
  'mediaRead',
  'saveNote',
  'readNotes',
  'removeNote',
];

/** The retiring X1-X8 clearnet-only channels this shell deliberately never calls (Task 16
 *  deletes the backend surface once the whole branch is verified). Asserted ABSENT below so a
 *  regression that reintroduces a clearnet-only call path is caught immediately, not just at
 *  Task 16 retirement time. */
const DELIBERATELY_UNUSED_LEGACY_CHANNELS: ReadonlyArray<keyof typeof channels.xListening> = [
  'connect',
  'status',
  'capture',
  'captureThreadComments',
  'captureFollowers',
  'captureFollowing',
  'exportNetwork',
  'runArchiveCycle',
  'runArchiveCycles',
  'exportItems',
];

describe('whole-module seam — every Phase-1 xListening channel is reachable from a real control', () => {
  it.each(REACHABLE_CHANNELS)('window.api.xListening.%s(...) is called somewhere in XListeningModule.tsx', (key) => {
    // Sanity: the channel constant itself must exist (catches a typo'd key in this very list).
    expect(typeof channels.xListening[key]).toBe('string');
    const callSite = new RegExp(`window\\.api\\.xListening\\.${key}\\s*\\(`);
    expect(MODULE_SOURCE).toMatch(callSite);
  });

  it('every channels.xListening key is accounted for — either reachable, or a documented deliberate exclusion', () => {
    const all = Object.keys(channels.xListening) as Array<keyof typeof channels.xListening>;
    const accounted = new Set([...REACHABLE_CHANNELS, ...DELIBERATELY_UNUSED_LEGACY_CHANNELS]);
    const orphaned = all.filter((k) => !accounted.has(k));
    // A failure here means a NEW channel was added to ipc-contracts.ts without either wiring it
    // into the renderer (add it to REACHABLE_CHANNELS above once wired) or explicitly excluding
    // it (DELIBERATELY_UNUSED_LEGACY_CHANNELS) — the exact "hollow channel" class this test
    // exists to catch.
    expect(orphaned).toEqual([]);
  });
});

describe('whole-module seam — the retiring X1-X8 surface stays deliberately unused here', () => {
  it.each(DELIBERATELY_UNUSED_LEGACY_CHANNELS)(
    'window.api.xListening.%s(...) is NOT called from XListeningModule.tsx (clearnet-only, Task 16 removes it)',
    (key) => {
      const callSite = new RegExp(`window\\.api\\.xListening\\.${key}\\s*\\(`);
      expect(MODULE_SOURCE).not.toMatch(callSite);
    },
  );
});
