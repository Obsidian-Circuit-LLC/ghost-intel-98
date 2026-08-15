/**
 * Ghost Social Media Manager (hardened GI98 port) — Phase-3 IPC wiring: publishing + scheduled
 * queue + THE AUTO-POST ARM GATE + profile stats (G4/G5/G7, constraint 3). SAFETY-CRITICAL.
 *
 * Wires the pure services (publishing.ts / queue.ts / stats.ts) to the production Electron seams and
 * registers their channels. Like the Phase-1/2 registrars, every handler calls `assertTrustedSender`
 * FIRST — these flows drive the user's authenticated live accounts (auto-publish included), so an IPC
 * message from a non-app frame is rejected before any argument is read — then validates its argument
 * SHAPE before delegating.
 *
 * THE ARM GATE (G7): the scheduler's `autoPublish` seam is `publishing.autoPublish`, which reads the
 * default-OFF ARM flag from the encrypted module state (`isAutoPostArmed(prodStoreDeps())`) in MAIN
 * and refuses to click Publish while disarmed. `armSet` is the single authoritative arm mutation
 * (the renderer supplies the one-time confirm; MAIN records the flag). Production seams:
 *  - publishing/stats windows are HIDDEN `BrowserWindow`s on the account's own `persist:` partition
 *    with the full isolation `webPreferences` (his defaults, kept); stats windows are ALWAYS closed.
 *  - `clickPublish` runs the VERBATIM per-platform Publish-button DOM script.
 *  - the scheduler's state seams are the encrypted store; `now`/`uuid` are the real clock/UUID.
 */

import { channels } from '@shared/ipc-contracts';
import { accountPartition, type AccountLike, type PublishRequest } from '@shared/ghost-social/types';
import { assertTrustedSender } from '../capture/capture-window';
import {
  makePublishingService,
  clickPublishScript,
  type PublishingService,
  type PublishWindow,
  type PublishWc,
} from './publishing';
import { makeScheduler, type Scheduler } from './queue';
import { makeProfileStatsService, type ProfileStatsService, type StatsWindow } from './stats';
import { prodStoreDeps, getGhostState, saveGhostState, isAutoPostArmed, setAutoPostArmed } from './store';

type HandleWithEvent = (
  channel: string,
  fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
) => void;

type WindowLike = { webContents: { send(channel: string, payload: unknown): void } } | null;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Isolation `webPreferences` for a HIDDEN publishing/stats window on one account partition — his
 *  defaults (contextIsolation/nodeIntegration:false/sandbox) plus the app's standard hardening. */
function accountWebPreferences(partition: string) {
  return {
    partition,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
  };
}

/** Build a hidden `BrowserWindow` on a partition, adapted to the `PublishWindow`/`StatsWindow`
 *  structural shapes. Resolved lazily via require so importing this module never evaluates electron. */
function createHiddenWindow(partition: string): PublishWindow & StatsWindow {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const { BrowserWindow } = require('electron') as typeof import('electron');
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: accountWebPreferences(partition),
  });
  return win as unknown as PublishWindow & StatsWindow;
}

/** Production clickPublish seam — runs the VERBATIM DOM script in the authenticated page. */
async function prodClickPublish(wc: PublishWc, platform: string): Promise<boolean> {
  return !!(await wc.executeJavaScript(clickPublishScript(platform), true).catch(() => false));
}

/** Build the production publishing service (its arm-gate reader is the encrypted store). */
function prodPublishingService(): PublishingService {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const { clipboard } = require('electron') as typeof import('electron');
  return makePublishingService({
    partitionFor: (campaignId, accountId) => accountPartition(campaignId, accountId),
    createWindow: (partition) => createHiddenWindow(partition),
    clipboard: { readText: () => clipboard.readText(), writeText: (t) => clipboard.writeText(t) },
    sleep,
    isAutoPostArmed: async () => isAutoPostArmed(await prodStoreDeps()),
    clickPublish: prodClickPublish,
  });
}

/** Build the production profile-stats service. */
function prodStatsService(): ProfileStatsService {
  return makeProfileStatsService({
    partitionFor: (campaignId, accountId) => accountPartition(campaignId, accountId),
    createWindow: (partition) => createHiddenWindow(partition),
    sleep,
  });
}

/** Build the production scheduler over the encrypted store + the publishing service's arm-gated
 *  autoPublish + the real clock/UUID. */
function prodScheduler(publishing: PublishingService, getWindow: () => WindowLike): Scheduler {
  return makeScheduler({
    getState: async () => getGhostState(await prodStoreDeps()),
    saveState: async (state) => saveGhostState(await prodStoreDeps(), state),
    autoPublish: (campaignId, account, post) => publishing.autoPublish(campaignId, account, post),
    isArmed: async () => isAutoPostArmed(await prodStoreDeps()),
    now: () => Date.now(),
    uuid: () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      return (require('node:crypto') as typeof import('node:crypto')).randomUUID();
    },
    notifyStateChanged: () => {
      try {
        getWindow()?.webContents.send(channels.ghostSocial.scheduledStateChanged, {});
      } catch {
        /* window gone */
      }
    },
  });
}

// ---- argument-shape validators (the renderer is hostile) ---------------

function asString(v: unknown, what: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`${what} requires a string.`);
  return v;
}

/** Coerce a renderer-supplied account into the `AccountLike` the services need. `url` MUST be a
 *  string (downstream navigation is scheme-guarded by the view manager; the publishing/stats
 *  windows only ever navigate his fixed compose/profile URLs or the account's own home). */
function asAccountLike(v: unknown): AccountLike {
  if (!v || typeof v !== 'object') throw new Error('An account object is required.');
  const o = v as Record<string, unknown>;
  return {
    id: asString(o.id, 'account.id'),
    platform: asString(o.platform, 'account.platform') as AccountLike['platform'],
    name: typeof o.name === 'string' ? o.name : '',
    url: asString(o.url, 'account.url'),
    profileUrl: typeof o.profileUrl === 'string' ? o.profileUrl : undefined,
    username: typeof o.username === 'string' ? o.username : undefined,
  };
}

/** Coerce a renderer-supplied post into a `PublishRequest`. Media is name/type-only — NEVER
 *  uploaded (constraint 13), so only the string metadata is carried through. */
function asPublishRequest(v: unknown): PublishRequest {
  if (!v || typeof v !== 'object') throw new Error('A post object is required.');
  const o = v as Record<string, unknown>;
  return {
    text: typeof o.text === 'string' ? o.text : '',
    mediaPath: typeof o.mediaPath === 'string' ? o.mediaPath : undefined,
    mediaType: typeof o.mediaType === 'string' ? o.mediaType : undefined,
  };
}

/**
 * Register the Phase-3 channels. A single publishing service + scheduler + stats service is built
 * per registration (production calls this once). `getWindow` supplies the renderer-push target.
 */
export function registerGhostSocialPublishingIpc(deps: {
  handle: HandleWithEvent;
  getWindow: () => WindowLike;
}): { publishing: PublishingService; scheduler: Scheduler; stats: ProfileStatsService } {
  const { handle, getWindow } = deps;
  const publishing = prodPublishingService();
  const scheduler = prodScheduler(publishing, getWindow);
  const stats = prodStatsService();

  // ---- manual publish (PREPARE-ONLY, G5) ----------------------------------
  handle(channels.ghostSocial.publishPrepare, (e, campaignId, account, post) => {
    assertTrustedSender(e);
    return publishing.publish(asString(campaignId, 'campaignId'), asAccountLike(account), asPublishRequest(post));
  });

  // ---- THE AUTO-POST ARM GATE (G7) ----------------------------------------
  handle(channels.ghostSocial.armGet, async (e) => {
    assertTrustedSender(e);
    return isAutoPostArmed(await prodStoreDeps());
  });

  handle(channels.ghostSocial.armSet, async (e, armedArg) => {
    assertTrustedSender(e);
    // SAFETY (G7): only the literal `true` arms. The renderer supplies the one-time confirm; MAIN
    // records the authoritative flag (setAutoPostArmed coerces to a strict boolean before persist).
    const armed = armedArg === true;
    const state = await setAutoPostArmed(await prodStoreDeps(), armed);
    return state.autoPostArmed === true;
  });

  // ---- scheduled queue tick (arm-gated) -----------------------------------
  handle(channels.ghostSocial.scheduledRunNow, (e, postId) => {
    assertTrustedSender(e);
    return scheduler.runNow(asString(postId, 'postId'));
  });

  handle(channels.ghostSocial.scheduledProcessDue, (e) => {
    assertTrustedSender(e);
    return scheduler.processDue();
  });

  // ---- profile stats (hidden window ALWAYS closed, G4) --------------------
  handle(channels.ghostSocial.statsRefresh, (e, campaignId, account) => {
    assertTrustedSender(e);
    return stats.refresh(asString(campaignId, 'campaignId'), asAccountLike(account));
  });

  return { publishing, scheduler, stats };
}
