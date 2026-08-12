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
  'changeEvents',
  'verifyPost',
  'runLog',
  'openInX',
  'saveNote',
  'readNotes',
  'removeNote',
];

describe('whole-module seam — every xListening channel is reachable from a real control', () => {
  it.each(REACHABLE_CHANNELS)('window.api.xListening.%s(...) is called somewhere in XListeningModule.tsx', (key) => {
    // Sanity: the channel constant itself must exist (catches a typo'd key in this very list).
    expect(typeof channels.xListening[key]).toBe('string');
    const callSite = new RegExp(`window\\.api\\.xListening\\.${key}\\s*\\(`);
    expect(MODULE_SOURCE).toMatch(callSite);
  });

  it('every channels.xListening key is reachable — none are orphaned', () => {
    const all = Object.keys(channels.xListening) as Array<keyof typeof channels.xListening>;
    const reachable = new Set(REACHABLE_CHANNELS);
    const orphaned = all.filter((k) => !reachable.has(k));
    // A failure here means a NEW channel was added to ipc-contracts.ts without wiring it into
    // the renderer (add it to REACHABLE_CHANNELS above once wired) — the exact "hollow channel"
    // class this test exists to catch.
    expect(orphaned).toEqual([]);
  });
});
