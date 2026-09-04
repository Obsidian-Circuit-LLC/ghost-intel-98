/**
 * The `window.xls` boundary — GhostExodus's 47 channels, served by Ghost Intel 98.
 *
 * His renderer runs unmodified and cannot tell the difference. Everything that makes this app's
 * posture different from his lives HERE, at the boundary, and nowhere in his code:
 *
 *   - `assertTrustedSender(e)` FIRST in every handler (his capture window can host a hostile remote
 *     page, so a channel that skipped this would be reachable from it)
 *   - argument validation before anything is touched
 *   - his state document through secure-fs, encrypted at rest, with a read failure REPORTED rather
 *     than reset (see state-store.ts)
 *   - egress through the app's Tor gate, fail-closed, instead of his own Tor management
 *   - captures through the app's hardened capture window, with its sandbox, CSP, partition and
 *     navigation timeout
 *
 * Where a Ghost Intel 98 service already implements his behaviour faithfully it is CALLED, not
 * reimplemented — `computeNetworkAnalysis` and `deriveCollectionHealth` are pure functions over
 * plain arrays and take his collections directly; `captureTimeline` takes an injectable
 * `saveItems`, so his document is the persistence target while every hardened capture mechanism is
 * reused. Where our version drifted from his, HIS SOURCE IS THE AUTHORITY.
 *
 * Ids: his records are given UUIDs. His code treats ids as opaque, and a UUID satisfies the
 * `ensureUuid` gate on the app services his campaigns are passed to as a caseId.
 */
import { randomUUID } from 'node:crypto';
import { assertTrustedSender } from '../capture/capture-window';
import { XLS_CHANNELS, XLS_EVENT_CHANNELS } from '@shared/xls/channels';
import { makeStationStore, type PersistedStationState, type StationStore } from './state-store';
import {
  activeCaseId,
  activeSettings,
  addNote,
  addProfile,
  clearCollectedPosts,
  clientState,
  createCampaign,
  deleteCampaign,
  duplicateCampaign,
  normalizeUsername,
  removeNote,
  removePreset,
  removeProfile,
  savePreset,
  saveSettings,
  switchCampaign,
  updateCampaign,
  updateNote,
  type StationCtx,
} from './station-service';
import { computeNetworkAnalysis, deriveCollectionHealth } from '../x-listening/analysis';
import { postFromArtifact } from './migrate';
import { connectXSession, getXStatus, clearXSession, resolveXTorGate } from '../x-listening/session';
import { openInX, verifyPost, captureTimeline, captureNetwork, type XOpenKind } from '../x-listening/capture';
import { getXWindow, navigateXToProfile } from '../x-listening/session';
import { withQueuedCollectionLock } from '../x-listening/collection-lock';
import { readCachedMedia, cacheRemoteMedia } from '../x-listening/media';
import { resolveAvatarDataUri } from './avatars';
// The app's single fail-closed reader of the Tor-default opt-out: any settings-read error
// yields Tor mode, never a silent widen to clearnet.
import { loadClearnetEnabled } from '../x-listening/ipc';

type HandleWithEvent = (
  channel: string,
  fn: (e: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
) => void;

export interface XlsEmbedDeps {
  handle: HandleWithEvent;
  /** The window to push `state:changed` / `sweep:progress` / `app:background-error` at. */
  getWindow?: () => { isDestroyed(): boolean; webContents: { send(c: string, p: unknown): void } } | null;
  /** Injectable for tests; production builds one over secure-fs. */
  store?: StationStore;
  /** Injectable clock/ids for deterministic tests. */
  ctx?: StationCtx;
  /**
   * Save an export to a location the ANALYST picks. Production supplies the app's existing
   * `saveBufferWithDialog` — native dialog, symlink refusal, atomic temp+rename — so the renderer
   * never names a destination path and there is no traversal surface. Returns the saved file name,
   * or null when the analyst cancels. Injectable so export tests never open a dialog.
   */
  saveExport?: (defaultName: string, data: string) => Promise<string | null>;
}

const defaultCtx: StationCtx = {
  now: () => new Date().toISOString(),
  makeId: () => randomUUID(),
};

/** A validated non-empty string argument, or a clear error naming what was expected. */
function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${what} is required.`);
  return value;
}

export function registerXlsEmbedIpc(deps: XlsEmbedDeps): void {
  const ctx = deps.ctx ?? defaultCtx;
  const store =
    deps.store ??
    makeStationStore({
      // Production wiring is supplied by the caller in main; a store is always injected there.
      readFile: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
      writeFile: async () => undefined,
      statePath: () => 'station-state.json',
      now: ctx.now,
      makeId: ctx.makeId,
    });

  let cached: PersistedStationState | null = null;

  async function doc(): Promise<PersistedStationState> {
    if (!cached) cached = await store.load();
    return cached;
  }

  function emit(channel: string, payload: unknown): void {
    const win = deps.getWindow?.();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }

  /** Apply a mutation, persist it, push the new snapshot, and answer with it (his handlers do). */
  async function mutate<T>(fn: (s: PersistedStationState) => T): Promise<T> {
    const s = await doc();
    const result = fn(s);
    await store.save(s);
    emit(XLS_EVENT_CHANNELS.onStateChanged, clientState(s));
    return result;
  }

  const handle = (channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...a: unknown[]) => unknown) =>
    deps.handle(channel, fn);

  // ---- state ---------------------------------------------------------------

  handle(XLS_CHANNELS.getState, async (e) => {
    assertTrustedSender(e);
    return clientState(await doc());
  });

  // ---- campaigns (his `cases` collection) ----------------------------------

  handle(XLS_CHANNELS.createCampaign, async (e, input) => {
    assertTrustedSender(e);
    return mutate((s) => {
      createCampaign(s, (input ?? {}) as { name?: string }, ctx);
      return clientState(s);
    });
  });

  handle(XLS_CHANNELS.switchCampaign, async (e, id) => {
    assertTrustedSender(e);
    const target = str(id, 'A campaign id');
    return mutate((s) => {
      switchCampaign(s, target);
      return clientState(s);
    });
  });

  handle(XLS_CHANNELS.updateCampaign, async (e, id, input) => {
    assertTrustedSender(e);
    const target = str(id, 'A campaign id');
    return mutate((s) => updateCampaign(s, target, (input ?? {}) as { name?: string }, ctx));
  });

  handle(XLS_CHANNELS.duplicateCampaign, async (e, id) => {
    assertTrustedSender(e);
    const target = str(id, 'A campaign id');
    return mutate((s) => {
      duplicateCampaign(s, target, ctx);
      return clientState(s);
    });
  });

  handle(XLS_CHANNELS.deleteCampaign, async (e, id) => {
    assertTrustedSender(e);
    const target = str(id, 'A campaign id');
    return mutate((s) => {
      deleteCampaign(s, target, ctx);
      return clientState(s);
    });
  });

  // His four `cases:*` channels are DEAD in v3.4.1 — his preload exposes them, his UI never calls
  // them. They are registered so the advertised surface is real rather than a lie, and they answer
  // with the current snapshot instead of mutating a concept his UI does not present.
  for (const dead of [XLS_CHANNELS.createCase, XLS_CHANNELS.switchCase, XLS_CHANNELS.updateCase, XLS_CHANNELS.deleteEmptyCase]) {
    handle(dead, async (e) => {
      assertTrustedSender(e);
      return clientState(await doc());
    });
  }

  // ---- profiles ------------------------------------------------------------

  handle(XLS_CHANNELS.addProfile, async (e, username) => {
    assertTrustedSender(e);
    // His `normalizeUsername` throws his own message for anything X could not be.
    const handleName = normalizeUsername(username);
    return mutate((s) => {
      addProfile(s, handleName, ctx);
      return clientState(s);
    });
  });

  handle(XLS_CHANNELS.removeProfile, async (e, id) => {
    assertTrustedSender(e);
    const target = str(id, 'A profile id');
    return mutate((s) => {
      removeProfile(s, target, ctx);
      return clientState(s);
    });
  });

  handle(XLS_CHANNELS.setProfileImageMode, async (e, id, mode) => {
    assertTrustedSender(e);
    const target = str(id, 'A profile id');
    const next = mode === 'on' || mode === 'off' ? mode : 'inherit';
    return mutate((s) => {
      const profile = s.profiles.find((p) => p.id === target);
      if (!profile) throw new Error('Profile not found.');
      profile.imageMode = next;
      const effective = next === 'inherit' ? activeSettings(s).collectImages : next === 'on';
      return { id: target, imageMode: next, effective };
    });
  });

  handle(XLS_CHANNELS.setCampaignImages, async (e, enabled) => {
    assertTrustedSender(e);
    const on = Boolean(enabled);
    return mutate((s) => {
      saveSettings(s, { ...activeSettings(s), collectImages: on });
      return { enabled: on };
    });
  });

  // ---- notes ---------------------------------------------------------------

  handle(XLS_CHANNELS.addNote, async (e, postId, text) => {
    assertTrustedSender(e);
    const post = str(postId, 'A post id');
    return mutate((s) => {
      addNote(s, post, String(text ?? ''), ctx);
      return clientState(s);
    });
  });

  handle(XLS_CHANNELS.updateNote, async (e, noteId, text) => {
    assertTrustedSender(e);
    const id = str(noteId, 'A note id');
    return mutate((s) => {
      updateNote(s, id, String(text ?? ''), ctx);
      return clientState(s);
    });
  });

  handle(XLS_CHANNELS.removeNote, async (e, noteId) => {
    assertTrustedSender(e);
    const id = str(noteId, 'A note id');
    return mutate((s) => {
      removeNote(s, id);
      return clientState(s);
    });
  });

  // ---- presets -------------------------------------------------------------

  handle(XLS_CHANNELS.savePreset, async (e, preset) => {
    assertTrustedSender(e);
    return mutate((s) => {
      savePreset(s, (preset ?? {}) as { name?: string }, ctx);
      return clientState(s);
    });
  });

  handle(XLS_CHANNELS.removePreset, async (e, id) => {
    assertTrustedSender(e);
    const target = str(id, 'A preset id');
    return mutate((s) => {
      removePreset(s, target);
      return clientState(s);
    });
  });

  // ---- settings and data ---------------------------------------------------

  handle(XLS_CHANNELS.saveSettings, async (e, settings) => {
    assertTrustedSender(e);
    if (!settings || typeof settings !== 'object') throw new Error('Settings are required.');
    return mutate((s) => {
      saveSettings(s, { ...activeSettings(s), ...(settings as object) } as never);
      return clientState(s);
    });
  });

  handle(XLS_CHANNELS.clearCollectedData, async (e) => {
    assertTrustedSender(e);
    return mutate((s) => {
      clearCollectedPosts(s);
      return clientState(s);
    });
  });

  // ---- analysis ------------------------------------------------------------
  // Both are PURE functions over plain arrays (ported from his source during the earlier port), so
  // his collections feed them directly and his renderer gets the shape it expects.

  handle(XLS_CHANNELS.getNetworkAnalysis, async (e) => {
    assertTrustedSender(e);
    const s = await doc();
    const caseId = activeCaseId(s);
    return computeNetworkAnalysis(
      s.profiles.filter((p) => p.caseId === caseId) as never,
      s.relationships.filter((r) => r.caseId === caseId) as never,
      ctx.now()
    );
  });

  handle(XLS_CHANNELS.getCollectionHealth, async (e) => {
    assertTrustedSender(e);
    const s = await doc();
    const caseId = activeCaseId(s);
    return deriveCollectionHealth(
      s.collectionRuns.filter((r) => r.caseId === caseId) as never,
      {
        targets: s.profiles
          .filter((p) => p.caseId === caseId)
          .map((p) => ({ profileId: p.id, username: p.username })),
      }
    );
  });

  // ---- session (the app's Tor-gated session, not his own) ------------------

  handle(XLS_CHANNELS.connectX, async (e) => {
    assertTrustedSender(e);
    const s = await doc();
    const clearnetEnabled = await loadClearnetEnabled();
    return connectXSession(activeCaseId(s), clearnetEnabled);
  });

  handle(XLS_CHANNELS.getSessionStatus, async (e) => {
    assertTrustedSender(e);
    return getXStatus(activeCaseId(await doc()));
  });

  handle(XLS_CHANNELS.clearSession, async (e) => {
    assertTrustedSender(e);
    return clearXSession(activeCaseId(await doc()));
  });

  // ---- Tor ----------------------------------------------------------------
  // His app manages its own Tor. Here the APP owns egress: the gate is resolved from the acked
  // clearnet setting and reported in his shape. `tor:toggle` therefore reports the posture rather
  // than switching a Tor his embed does not run — flipping egress to clearnet is an app-level,
  // ack-gated decision and must not be reachable from an embedded renderer.

  async function torState(): Promise<{ enabled: boolean; connected: boolean; port: number | null; exitIp: string | null }> {
    const clearnetEnabled = await loadClearnetEnabled();
    const gate = resolveXTorGate(clearnetEnabled);
    return {
      enabled: !clearnetEnabled,
      connected: !gate.blocked && !clearnetEnabled,
      port: null,
      exitIp: null,
    };
  }

  handle(XLS_CHANNELS.getTorStatus, async (e) => {
    assertTrustedSender(e);
    return torState();
  });

  handle(XLS_CHANNELS.toggleTor, async (e) => {
    assertTrustedSender(e);
    return torState();
  });

  // ---- opening X ----------------------------------------------------------

  const open = (kind: XOpenKind) => async (e: Electron.IpcMainInvokeEvent, ref: unknown) => {
    assertTrustedSender(e);
    return openInX(kind, str(ref, 'A reference'));
  };

  handle(XLS_CHANNELS.openThread, open('thread'));
  handle(XLS_CHANNELS.openIdentityProfile, open('identity'));

  handle(XLS_CHANNELS.openProfileFeed, async (e, id) => {
    assertTrustedSender(e);
    const target = str(id, 'A profile id');
    const s = await doc();
    const profile = s.profiles.find((p) => p.id === target);
    if (!profile) throw new Error('Profile not found.');
    return openInX('profile', profile.username);
  });

  handle(XLS_CHANNELS.openRelationshipProfile, async (e, id) => {
    assertTrustedSender(e);
    const target = str(id, 'A relationship id');
    const s = await doc();
    const row = s.relationships.find((r) => r.id === target);
    if (!row) throw new Error('Relationship not found.');
    return openInX('identity', row.username);
  });

  handle(XLS_CHANNELS.verifyPost, async (e, postId) => {
    assertTrustedSender(e);
    const target = str(postId, 'A post id');
    const s = await doc();
    return verifyPost(activeCaseId(s), target);
  });

  // ---- cached media (never remote; the cache only) -------------------------

  handle(XLS_CHANNELS.getPostMediaDataUrl, async (e, postId, index) => {
    assertTrustedSender(e);
    const target = str(postId, 'A post id');
    const s = await doc();
    const post = s.posts.find((p) => p.id === target);
    const ref = post?.media?.[Number(index) || 0];
    if (!ref) return null;
    return readCachedMedia(activeCaseId(s), ref);
  });

  handle(XLS_CHANNELS.getAvatarDataUrl, async (e, username, preferredUrl) => {
    assertTrustedSender(e);
    const handleName = String(username ?? '').replace(/^@+/, '');
    if (!handleName) return null;
    const s = await doc();
    const caseId = activeCaseId(s);
    // His own model: the avatar URL travels ON the record. Posts first (freshest), then the
    // relationship rows, then the profile — the precedence his app uses.
    const fromPost = s.posts.find((p) => p.caseId === caseId && p.username?.toLowerCase() === handleName.toLowerCase() && p.avatar)?.avatar;
    const fromRel = s.relationships.find((r) => r.caseId === caseId && r.username?.toLowerCase() === handleName.toLowerCase() && r.avatar)?.avatar;
    const fromProfile = s.profiles.find((p) => p.caseId === caseId && p.username.toLowerCase() === handleName.toLowerCase() && p.avatar)?.avatar;
    const ref = fromPost || fromRel || fromProfile;
    // NOT an early return on a missing ref any more: his UI may be handing over the only URL that
    // exists, for a row whose record has not been enriched yet.
    if (!ref && typeof preferredUrl !== 'string') return null;

    // v3.73.1: his records carry the REMOTE avatar URL his scraper read off the page, not one of
    // our local media refs. v3.73.0 handed that value straight to readCachedMedia, which rejects
    // anything that is not `x-media/<64 hex>` — so every avatar resolved to null and no display
    // picture could ever appear. Localise a remote URL through the hardened cache (host-anchored,
    // routed via the X session window, encrypted at rest) and write the local ref back onto every
    // record that carried the same URL, so it is fetched once.
    return resolveAvatarDataUri(
      {
        caseId,
        ref,
        // His UI passes the avatar it just read off the page as the SECOND argument. Dropping it
        // was why pictures never appeared for a row whose stored record had no avatar yet.
        preferred: typeof preferredUrl === 'string' ? preferredUrl : undefined,
        onLocalised: (localRef) => {
          for (const row of s.posts) if (row.avatar === ref) row.avatar = localRef;
          for (const row of s.relationships) if (row.avatar === ref) row.avatar = localRef;
          for (const row of s.profiles) if (row.avatar === ref) row.avatar = localRef;
          void store.save(s);
        },
      },
      {
        readCached: (id, r) => readCachedMedia(id, r),
        cacheRemote: async (id, url) => {
          const win = getXWindow(id);
          if (!win) return null;
          return cacheRemoteMedia(win as never, url, id);
        },
        hasSession: (id) => Boolean(getXWindow(id)),
      }
    );
  });

  // ---- collection: his refresh / extract, on the app's hardened capture path ----
  //
  // These reuse Ghost Intel 98's capture machinery wholesale — the Tor gate, the signed-in guard,
  // the bounded navigation, the media policy, the app-wide collection lock — and inject HIS
  // document as the persistence target. That is the whole shape of the embed in one place: his
  // model, our egress.

  /**
   * Write captured posts into his document in HIS post shape, deduped by id like his handler.
   *
   * Fed from `savePosts` — the RICH capture artifact — not `saveItems`. Capture persistence is
   * DUAL: `savePosts` carries kind, metrics, avatar, mediaRefs and the evidence hash, while
   * `saveItems` carries a thin sidecar with none of them. v3.73.0-v3.74.2 injected only
   * `saveItems`, so his document received stripped posts with no avatar and no media while the
   * rich copies went to the OLD store, where his station never looks. That is why fresh collection
   * produced no images: the data was being written, just not the half that has pictures in it.
   */
  function ingestPosts(
    s: PersistedStationState,
    profileId: string,
    username: string,
    posts: Array<Record<string, unknown>>
  ): { added: number; skipped: number } {
    const caseId = activeCaseId(s);
    const seen = new Set(s.posts.filter((p) => p.caseId === caseId).map((p) => p.id));
    let added = 0;
    let skipped = 0;
    for (const raw of posts) {
      const id = String(raw.id ?? '');
      if (!id) continue;
      if (seen.has(id)) {
        // His enrichment rule: a re-observed post gains fields it predates, without touching
        // anything evidential. This is the exact bug that made display pictures never fill in on an
        // existing campaign — a re-captured post used to be discarded wholesale.
        const existing = s.posts.find((p) => p.id === id && p.caseId === caseId);
        if (existing) {
          if (!existing.avatar && raw.avatar) existing.avatar = String(raw.avatar);
          if (!existing.displayName && raw.displayName) existing.displayName = String(raw.displayName);
          existing.lastObservedAt = ctx.now();
        }
        skipped += 1;
        continue;
      }
      seen.add(id);
      // The SAME mapping the migration uses — one set of field names, one place to be wrong.
      s.posts.push(
        postFromArtifact(raw as never, {
          caseId,
          profileId,
          source: username,
          now: ctx.now(),
        }) as never
      );
      added += 1;
    }
    return { added, skipped };
  }

  /** One profile refresh: navigate, capture, ingest, and record the run the way his app does. */
  async function refreshOne(s: PersistedStationState, profileId: string): Promise<{ collected: number; added: number }> {
    const caseId = activeCaseId(s);
    const profile = s.profiles.find((p) => p.id === profileId && p.caseId === caseId);
    if (!profile) throw new Error('Profile not found in the active campaign.');

    const startedAt = ctx.now();
    return withQueuedCollectionLock(async () => {
      // ENSURE a capture window FIRST. The auth cookie is case-independent and persisted, so his
      // UI reads SESSION CONNECTED while this campaign has no live window — after a restart, or
      // before Open Session was ever clicked ("signed in (cookie) != ready to capture (window)",
      // the trap the old module was fixed for in v3.71.1).
      //
      // v3.74.4 added this ensure AFTER the navigate below, which is useless: navigateXToProfile
      // itself throws "No capture window is open for this campaign." when there is none, so the
      // ensure could never run and that is the error his REFRESH button returned. Right fix,
      // wrong place — order is the whole point here.
      //
      // Opened HIDDEN: collection must never pop the Chromium browser at the analyst. Tor gate and
      // fail-closed posture unchanged — a blocked gate is reported, not worked around.
      let win = getXWindow(caseId);
      if (!win) {
        const opened = await connectXSession(caseId, await loadClearnetEnabled(), { visible: false });
        if (opened.blocked) {
          throw new Error(
            opened.reason ??
              'Tor is not ready — cannot open a capture window. Wait for Tor, or enable the clearnet opt-in.'
          );
        }
        win = getXWindow(caseId);
      }
      if (!win) throw new Error('Could not open a capture window for this campaign.');

      const nav = await navigateXToProfile(caseId, profile.username, {}, { collectReplies: activeSettings(s).collectReplies });
      if (nav.blocked) {
        profile.lastError = nav.reason ?? 'blocked';
        profile.lastCheckedAt = ctx.now();
        s.collectionRuns.push({
          id: ctx.makeId(), caseId, profileId, username: profile.username, operation: 'posts',
          startedAt, completedAt: ctx.now(), requestedPasses: activeSettings(s).scrollPasses,
          passesCompleted: 0, observed: 0, added: 0, duplicates: 0,
          stopReason: nav.reason ?? 'blocked', reachedEnd: false, frontierUsernames: [],
          status: 'error', error: nav.reason ?? 'blocked',
        } as never);
        await store.save(s);
        emit(XLS_EVENT_CHANNELS.onStateChanged, clientState(s));
        return { collected: 0, added: 0 };
      }



      let ingested = { added: 0, skipped: 0 };
      const result = await captureTimeline(
        win,
        { caseId, jobId: caseId, channelId: profile.username, channelLabel: `@${profile.username}`, targetUsername: profile.username },
        {
          // HIS DOCUMENT IS THE STORE. Everything else about the capture stays ours.
          //
          // `savePosts` is the seam that matters: it carries the RICH artifact (kind, metrics,
          // avatar, mediaRefs, evidence hash). `saveItems` carries a thin sidecar with none of
          // that, and wiring only that one is why fresh collection produced no pictures.
          savePosts: async (_caseId, posts) => {
            ingested = ingestPosts(s, profileId, profile.username, posts as unknown as Array<Record<string, unknown>>);
            return ingested;
          },
          // The plain sidecar would otherwise write a second, thinner copy into the OLD store,
          // which nothing in the embed reads. Accept and discard rather than duplicate evidence
          // into a place no one looks.
          saveItems: async () => ({ added: 0, skipped: 0 }),
        }
      );

      profile.lastCheckedAt = ctx.now();
      profile.lastError = result.blocked ? (result.reason ?? 'blocked') : null;
      profile.collectedCount = s.posts.filter((p) => p.caseId === caseId && p.profileId === profileId).length;
      s.collectionRuns.push({
        id: ctx.makeId(), caseId, profileId, username: profile.username, operation: 'posts',
        startedAt, completedAt: ctx.now(), requestedPasses: activeSettings(s).scrollPasses,
        passesCompleted: 0, observed: result.posts?.length ?? 0, added: ingested.added,
        duplicates: ingested.skipped, stopReason: result.blocked ? (result.reason ?? 'blocked') : null,
        reachedEnd: false, frontierUsernames: [], status: result.blocked ? 'error' : 'ok',
        error: result.blocked ? (result.reason ?? 'blocked') : null,
      } as never);
      s.lastSweepAt = ctx.now();
      await store.save(s);
      emit(XLS_EVENT_CHANNELS.onStateChanged, clientState(s));
      return { collected: result.posts?.length ?? 0, added: ingested.added };
    }, 'xls:profiles:refresh');
  }

  handle(XLS_CHANNELS.refreshProfile, async (e, id) => {
    assertTrustedSender(e);
    const target = str(id, 'A profile id');
    return refreshOne(await doc(), target);
  });

  handle(XLS_CHANNELS.refreshAll, async (e) => {
    assertTrustedSender(e);
    const s = await doc();
    const caseId = activeCaseId(s);
    const targets = s.profiles.filter((p) => p.caseId === caseId && p.enabled).map((p) => p.id);
    let collected = 0;
    let added = 0;
    let failed = 0;
    let lastReason = '';
    for (const id of targets) {
      emit(XLS_EVENT_CHANNELS.onSweepProgress, {
        message: `Collecting @${s.profiles.find((p) => p.id === id)?.username ?? ''}…`,
        current: targets.indexOf(id) + 1,
        total: targets.length,
        running: true,
      });
      try {
        const r = await refreshOne(s, id);
        collected += r.collected;
        added += r.added;
      } catch (err) {
        // One bad target must not abort the sweep — but it must not vanish either. Count it,
        // record it in the run log where he can find it, and keep the reason for the summary.
        failed += 1;
        lastReason = err instanceof Error ? err.message : String(err);
        const profile = s.profiles.find((p) => p.id === id);
        s.collectionRuns.push({
          id: ctx.makeId(), caseId, profileId: id, username: profile?.username ?? '',
          operation: 'posts', startedAt: ctx.now(), completedAt: ctx.now(),
          requestedPasses: 0, passesCompleted: 0, observed: 0, added: 0, duplicates: 0,
          stopReason: lastReason, reachedEnd: false, frontierUsernames: [],
          status: 'error', error: lastReason,
        } as never);
        emit(XLS_EVENT_CHANNELS.onBackgroundError, { message: lastReason });
      }
    }
    emit(XLS_EVENT_CHANNELS.onSweepProgress, { message: '', current: targets.length, total: targets.length, running: false });
    if (failed > 0) {
      await store.save(s);
      emit(XLS_EVENT_CHANNELS.onStateChanged, clientState(s));
    }
    // Report the failures. A sweep that says "complete" having collected nothing, with the reason
    // only in a console the analyst never sees, is how a total collection failure looked like a
    // working feature for three releases.
    return {
      ...clientState(s),
      collected,
      added,
      failed,
      reason: failed
        ? `${failed} of ${targets.length} source(s) failed: ${lastReason}`
        : undefined,
    };
  });

  handle(XLS_CHANNELS.extractRelationships, async (e, id, relationship) => {
    assertTrustedSender(e);
    const target = str(id, 'A profile id');
    const kind = relationship === 'following' ? 'following' : 'followers';
    const s = await doc();
    const caseId = activeCaseId(s);
    const profile = s.profiles.find((p) => p.id === target && p.caseId === caseId);
    if (!profile) throw new Error('Profile not found in the active campaign.');

    let added = 0;
    let observed = 0;
    const startedAt = ctx.now();
    const result = await captureNetwork(
      { caseId, channelId: profile.username, targetUsername: profile.username, kind },
      {
        // Again: his document is the store, our capture path does the work.
        saveNetwork: async (_caseId, artifact) => {
          const rows = (artifact as unknown as { accounts?: Array<Record<string, unknown>> }).accounts ?? [];
          observed = rows.length;
          const rel = kind === 'following' ? 'following' : 'follower';
          const existing = new Set(
            s.relationships
              .filter((r) => r.caseId === caseId && r.profileId === target && r.relationship === rel)
              .map((r) => String(r.username).toLowerCase())
          );
          for (const row of rows) {
            const username = String(row.username ?? '').replace(/^@+/, '');
            if (!username) continue;
            if (existing.has(username.toLowerCase())) continue;
            existing.add(username.toLowerCase());
            s.relationships.push({
              id: ctx.makeId(), caseId, profileId: target, sourceUsername: profile.username,
              relationship: rel, username, displayName: String(row.displayName ?? ''),
              bio: String(row.bio ?? ''), url: String(row.url ?? `https://x.com/${username}`),
              avatar: String(row.avatar ?? ''), collectedAt: ctx.now(),
              firstObservedAt: ctx.now(), lastObservedAt: ctx.now(),
            } as never);
            added += 1;
          }
          return added;
        },
      }
    );

    // Record the run in HIS log, success or failure. captureNetwork writes its own run record into
    // the OLD store, which his station never reads — so without this a blocked extraction left no
    // trace anywhere he could see, exactly the way a failing sweep used to report "complete".
    s.collectionRuns.push({
      id: ctx.makeId(), caseId, profileId: target, username: profile.username,
      operation: kind, startedAt, completedAt: ctx.now(),
      requestedPasses: 0, passesCompleted: result.completedPasses ?? 0,
      observed, added, duplicates: Math.max(0, observed - added),
      stopReason: result.blocked ? (result.reason ?? 'blocked') : null,
      reachedEnd: Boolean(result.reachedEnd), frontierUsernames: [],
      status: result.blocked ? 'error' : 'ok',
      error: result.blocked ? (result.reason ?? 'blocked') : null,
    } as never);

    await store.save(s);
    emit(XLS_EVENT_CHANNELS.onStateChanged, clientState(s));
    if (result.blocked) {
      emit(XLS_EVENT_CHANNELS.onBackgroundError, {
        message: `Network extraction blocked: ${result.reason ?? 'unknown reason'}`,
      });
    }
    // Surface the block. Returning a bare zero here is how "Network extraction complete" came to
    // mean "nothing happened and I will not tell you why".
    return {
      collected: observed,
      added,
      relationship: kind === 'following' ? 'following' : 'follower',
      reachedEnd: Boolean(result.reachedEnd),
      blocked: Boolean(result.blocked),
      reason: result.blocked ? (result.reason ?? 'Network extraction was blocked.') : undefined,
    };
  });

  handle(XLS_CHANNELS.clearRelationships, async (e, profileId) => {
    assertTrustedSender(e);
    const target = typeof profileId === 'string' ? profileId : '';
    return mutate((s) => {
      const caseId = activeCaseId(s);
      s.relationships = s.relationships.filter(
        (r) => !(r.caseId === caseId && (!target || r.profileId === target))
      );
      return clientState(s);
    });
  });

  // ---- presets, archive, demo ----------------------------------------------

  handle(XLS_CHANNELS.runPreset, async (e, id) => {
    assertTrustedSender(e);
    const target = str(id, 'A preset id');
    return mutate((s) => {
      const caseId = activeCaseId(s);
      const preset = s.presets.find((p) => p.id === target);
      if (!preset) throw new Error('Preset not found.');
      const keywords = preset.keywords.map((k) => (preset.caseSensitive ? k : k.toLowerCase()));
      const scoped = s.posts.filter(
        (p) => p.caseId === caseId && (!preset.profileIds.length || preset.profileIds.includes(p.profileId))
      );
      const already = new Set(s.matches.filter((m) => m.presetId === target).map((m) => m.postId));
      let matched = 0;
      for (const post of scoped) {
        const text = preset.caseSensitive ? post.text : String(post.text ?? '').toLowerCase();
        const hits = keywords.filter((k) => text.includes(k));
        const ok = preset.mode === 'all' ? hits.length === keywords.length && keywords.length > 0 : hits.length > 0;
        if (!ok || already.has(post.id)) continue;
        s.matches.push({ id: ctx.makeId(), caseId, presetId: target, postId: post.id, matchedKeywords: hits, createdAt: ctx.now() } as never);
        matched += 1;
      }
      return { matched, state: clientState(s) };
    });
  });

  handle(XLS_CHANNELS.resetArchiveProgress, async (e) => {
    assertTrustedSender(e);
    return mutate((s) => {
      s.archive = { lastCycleAt: null, nextOperationIndex: 0, cyclesCompleted: 0, profiles: {} };
      return clientState(s);
    });
  });

  handle(XLS_CHANNELS.runArchiveStep, async (e) => {
    assertTrustedSender(e);
    // His archive walks one profile per tick, deepening collection. It drives the SAME refresh path,
    // so it inherits the Tor gate, the collection lock and the bounded navigation.
    const s = await doc();
    const caseId = activeCaseId(s);
    const targets = s.profiles.filter((p) => p.caseId === caseId && p.enabled);
    if (!targets.length) return clientState(s);
    const index = s.archive.nextOperationIndex % targets.length;
    const profile = targets[index];
    try {
      await refreshOne(s, profile.id);
    } finally {
      s.archive.nextOperationIndex = (index + 1) % targets.length;
      if (s.archive.nextOperationIndex === 0) {
        s.archive.cyclesCompleted += 1;
        s.archive.lastCycleAt = ctx.now();
      }
      await store.save(s);
      emit(XLS_EVENT_CHANNELS.onStateChanged, clientState(s));
    }
    return clientState(s);
  });

  handle(XLS_CHANNELS.loadDemo, async (e) => {
    assertTrustedSender(e);
    // His demo seeds a campaign with synthetic material. Ghost Intel 98 does not ship fabricated
    // intelligence into a real campaign's evidence set — an analyst cannot tell a seeded post from
    // a collected one once it is in the document, and every export would carry it.
    throw new Error('Demo data is not available in Ghost Intel 98 — collect a real target instead.');
  });

  // ---- exports -------------------------------------------------------------

  const saveExport = deps.saveExport ?? (async () => null);

  async function exportRows(suggested: string, rows: unknown, serialise: (r: never) => string) {
    const saved = await saveExport(suggested, serialise(rows as never));
    if (!saved) return { canceled: true };
    return { canceled: false, filePath: saved, count: Array.isArray(rows) ? rows.length : 0 };
  }

  function csv(rows: Array<Record<string, unknown>>, columns: string[]): string {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n');
  }

  handle(XLS_CHANNELS.exportJson, async (e) => {
    assertTrustedSender(e);
    const s = await doc();
    return exportRows('x-listening-posts.json', clientState(s).posts, (rows) => JSON.stringify(rows, null, 2));
  });

  handle(XLS_CHANNELS.exportPdf, async (e) => {
    assertTrustedSender(e);
    // His PDF export renders through his own print pipeline, which the embed does not run. Rather
    // than silently produce a different artifact under the same button, say so.
    throw new Error('PDF export is not wired in this build — use JSON or CSV.');
  });

  handle(XLS_CHANNELS.exportRelationshipsJson, async (e) => {
    assertTrustedSender(e);
    const s = await doc();
    return exportRows('x-listening-network.json', clientState(s).relationships, (rows) => JSON.stringify(rows, null, 2));
  });

  handle(XLS_CHANNELS.exportRelationshipsCsv, async (e) => {
    assertTrustedSender(e);
    const s = await doc();
    const rows = clientState(s).relationships as unknown as Array<Record<string, unknown>>;
    return exportRows('x-listening-network.csv', rows, () =>
      csv(rows, ['sourceUsername', 'relationship', 'username', 'displayName', 'bio', 'url', 'collectedAt'])
    );
  });
}
