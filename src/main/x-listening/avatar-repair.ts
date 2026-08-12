/**
 * X Listening Station — avatar-repair-on-startup (Task H1).
 *
 * Enterprise's `scheduleAvatarRepair`/`repairExistingProfileAvatars` (`electron/main.cjs:1517`,
 * armed on the login window closing / when the X session first reports connected) re-fetched
 * missing profile avatars on launch by re-visiting profile pages. Rebuilt onto the hardened seams
 * as a BOUNDED, Tor-gated, idempotent startup pass over the active campaign's known avatars:
 *
 *   - **Candidates** = the campaign's profiles/network accounts that carry a KNOWN remote avatar
 *     URL (the production source is the captured profile-metadata snapshots, `XProfileSnapshot.avatar`
 *     — the closest analog to Enterprise's `appState.profiles[].avatar`) but have NO cached local
 *     copy yet. A handle already recorded in the per-campaign avatar cache is a "has a cached
 *     avatar" hit and is skipped.
 *   - **Host-anchored re-fetch.** Each re-fetch routes the existing `cacheRemoteMedia` pipeline
 *     (`media.ts`) — host-**anchored** (`new URL(url).hostname` ∈ `MEDIA_HOST_ALLOWLIST`, never a
 *     substring match), image-content-type-checked, persisted via secure-fs (AES-GCM at rest). A
 *     candidate whose only URL is off-allowlist or non-`http(s)` is filtered out BEFORE a window
 *     ever opens (no window for junk).
 *   - **FAIL CLOSED.** The Tor gate (`resolveXTorGate`, via the same acked-clearnet flag the sweep
 *     primitive reads) is resolved BEFORE any window opens: Tor down (and no acked clearnet) opens
 *     NO window and re-fetches nothing. There is NO clearnet fallback unless the operator has both
 *     enabled clearnet AND acknowledged the real-IP exposure — stricter than the manual paths,
 *     exactly like `captureProfileTimeline` (the background sweep primitive).
 *   - **Bounded.** At most `cap` avatars are re-fetched per run (default `DEFAULT_AVATAR_REPAIR_CAP`,
 *     re-clamped main-side to `[1, MAX_AVATAR_REPAIR_CAP]` — a renderer/settings value can never arm
 *     an unbounded loop). One shared capture window services the whole bounded batch.
 *   - **Idempotent.** The per-campaign avatar cache (`x-avatar-cache.json`, secure-fs) is the ledger
 *     of which handles have a cached avatar; a handle in it is skipped, so a second pass with nothing
 *     new opens no window. This cache is a DISPLAY artifact, not evidence — the repair never rewrites
 *     an evidence-bearing snapshot/post, only appends localized-avatar refs here.
 *
 * Quarantine-clean at module load: the only static imports are pure `@shared/*` + the pure
 * `capture/security` allowlist; every electron/Tor/store/media/secure-fs touch is a LAZY dynamic
 * import inside `defaultDeps()`, mirroring `image-policy.ts`/`scheduler.ts`/`capture.ts`. A test
 * injecting full deps never evaluates electron. Determinism: the only clock is the injected `now()`
 * stamped onto the display-cache metadata (never a hash/id path).
 */
import { normalizeXSourceKey } from '@shared/x-listening-source';
import { MEDIA_HOST_ALLOWLIST } from '../capture/security';
import type { XTorGate } from './session';

/** Per-campaign avatar-cache sidecar filename (alongside x-image-policy.json / x-posts.json). */
export const X_AVATAR_CACHE_FILE = 'x-avatar-cache.json';

/** Default per-run re-fetch cap for the startup pass. Enterprise primed up to 500 identity caches;
 *  for a bounded STARTUP pass on the hardened core a tighter default keeps the launch cheap while
 *  still repairing the most-relevant handles first. Re-clamped to `[1, MAX_AVATAR_REPAIR_CAP]`. */
export const DEFAULT_AVATAR_REPAIR_CAP = 40;
/** Hard ceiling on avatars re-fetched in one pass — an absurd/renderer-supplied cap is clamped to
 *  this main-side, so the loop is provably bounded regardless of the injected/persisted value. */
export const MAX_AVATAR_REPAIR_CAP = 500;

/** Canonical X handle guard — the same `^[A-Za-z0-9_]{1,15}$` shape every X URL builder enforces.
 *  A candidate whose handle doesn't match is dropped (never fabricate a fetch for a bogus handle). */
const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/** One localized avatar in the per-campaign cache ledger. `ref` is a LOCAL secure-fs reference
 *  (`x-media/<sha256>`) — never a remote URL; `sourceUrl` is the remote URL it was fetched from
 *  (audit trail); `cachedAt` is the injected-clock ISO time (display metadata, not a hash input). */
export interface XAvatarCacheEntry {
  ref: string;
  sha256: string;
  sourceUrl: string;
  cachedAt: string;
}

/** The persisted per-campaign map: canonical handle → localized-avatar entry. Presence of a handle
 *  = "this account has a cached avatar" (the idempotency ledger). */
export type XAvatarCacheMap = Record<string, XAvatarCacheEntry>;

/** A profile/network account with a KNOWN remote avatar URL that MAY need localizing. */
export interface XAvatarRepairCandidate {
  handle: string;
  sourceUrl: string;
}

/** The outcome of one repair pass — a run summary (not evidence). */
export interface XAvatarRepairResult {
  /** True iff the Tor gate refused (fail-closed) and the pass re-fetched nothing. */
  blocked: boolean;
  reason?: string;
  /** Total candidates considered this pass. */
  scanned: number;
  /** Avatars newly localized + cached this pass. */
  repaired: number;
  /** Repairable candidates skipped because they already had a cached avatar (idempotency). */
  skipped: number;
  /** Re-fetches that failed (off-allowlist reject at fetch time, non-image, page/fetch error). */
  failures: number;
  /** The effective (clamped) per-run cap applied. */
  cap: number;
}

/** Injectable seams so the pass is testable without electron/network/secure-fs. Production defaults
 *  are lazy dynamic imports of the sanctioned Tor seam (`./session`) + the hardened window factory +
 *  `cacheRemoteMedia` + secure-fs — this module statically imports NONE of them. */
export interface XAvatarRepairDeps {
  /** Read the acked clearnet opt-out MAIN-side, fail-closed. Default (like the sweep primitive)
   *  requires clearnet AND clearnetAck — an unattended startup pass only leaves Tor on an explicit ack. */
  loadClearnetEnabled: () => Promise<boolean>;
  /** Resolve the Tor posture from the acked clearnet flag (`session.ts` `resolveXTorGate`). */
  resolveGate: (clearnetEnabled: boolean) => XTorGate | Promise<XTorGate>;
  /** Open ONE hardened, hidden capture window over the resolved posture (proxy iff Tor mode). The
   *  whole bounded batch shares this window — the in-page media fetch runs from an authenticated
   *  x.com page, exactly like the post-media pipeline. */
  openWindow: (url: string, proxy?: { socks: string }) => Promise<Electron.BrowserWindow>;
  /** Host-anchored re-fetch + cache of one remote avatar URL (`media.ts` `cacheRemoteMedia`). Returns
   *  the LOCAL ref + byte-sha256, or null on any failure (off-allowlist, non-image, fetch error). */
  cache: (
    win: Electron.BrowserWindow,
    url: string,
    caseId: string,
  ) => Promise<{ ref: string; sha256: string } | null>;
  /** Enumerate the campaign's candidate avatars — production default derives them from the captured
   *  profile-metadata snapshots (`XProfileSnapshot.avatar`). */
  listCandidates: (caseId: string) => Promise<XAvatarRepairCandidate[]>;
  /** Read the RAW persisted avatar-cache object (possibly partial/legacy) or null when absent. */
  readCache: (caseId: string) => Promise<Record<string, unknown> | null>;
  /** Persist the updated avatar-cache map (secure-fs — AES-GCM at rest). */
  writeCache: (caseId: string, map: XAvatarCacheMap) => Promise<void>;
  /** Injected clock — the ISO time stamped onto a cache entry's `cachedAt` (display metadata only). */
  now: () => string;
  /** Per-run re-fetch cap; re-clamped to `[1, MAX_AVATAR_REPAIR_CAP]` inside `repairAvatars`. */
  cap: number;
}

/** The home page the shared repair window navigates to — an authenticated x.com context from which
 *  the in-page `pbs.twimg.com` avatar fetch works, mirroring the post-media pipeline. */
const REPAIR_WINDOW_URL = 'https://x.com/home';

function isEnoent(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function defaultDeps(): XAvatarRepairDeps {
  const resolvePath = async (caseId: string): Promise<string> => {
    const [{ join }, paths] = await Promise.all([import('node:path'), import('../storage/paths')]);
    return join(paths.scrapingCaseDir('x', caseId), X_AVATAR_CACHE_FILE);
  };
  return {
    loadClearnetEnabled: async () => {
      try {
        const { settingsStore } = await import('../storage/json-fs');
        const settings = await settingsStore.read();
        // Stricter than the manual paths: an unattended startup pass only leaves Tor when clearnet is
        // BOTH enabled AND acknowledged — matching `captureProfileTimeline`'s background posture.
        return settings.xListening?.clearnet === true && settings.xListening?.clearnetAck === true;
      } catch {
        return false;
      }
    },
    resolveGate: async (clearnetEnabled) => {
      const { resolveXTorGate } = await import('./session');
      return resolveXTorGate(clearnetEnabled);
    },
    openWindow: async (url, proxy) => {
      const [{ createCaptureWindow }, sess] = await Promise.all([
        import('../capture/capture-window'),
        import('./session'),
      ]);
      const win = await createCaptureWindow({
        partition: sess.X_LISTENING_PARTITION,
        url,
        allowHosts: sess.X_ALLOW_HOSTS,
        ...(proxy ? { proxy } : {}),
        webRTCIPHandlingPolicy: 'disable_non_proxied_udp',
      });
      win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      return win;
    },
    cache: async (win, url, caseId) => {
      const { cacheRemoteMedia } = await import('./media');
      return cacheRemoteMedia(win as unknown as import('../capture/security').MediaCapturePage, url, caseId);
    },
    listCandidates: async (caseId) => {
      // Production candidate source: the captured profile-metadata snapshots. The LATEST snapshot per
      // profile carries the remote avatar URL last observed on that profile's header — the closest
      // GI98 analog to Enterprise's `appState.profiles[].avatar`. A snapshot with no usable handle or
      // no remote avatar URL contributes nothing (never fabricate a fetch).
      try {
        const { prodXStore } = await import('./store');
        const store = await prodXStore();
        const snapshots = await store.profileSnapshots.read(caseId);
        const latestByProfile = new Map<string, { handle: string; sourceUrl: string }>();
        for (const snap of snapshots) {
          const handle = normalizeXSourceKey(snap.sourceUsername ?? '');
          const sourceUrl = String(snap.avatar ?? '').trim();
          if (!handle || !sourceUrl) continue;
          // Append order = capture order (store doc), so a later snapshot overwrites an earlier one —
          // the newest observed avatar URL wins for each profile.
          latestByProfile.set(snap.profileId, { handle, sourceUrl });
        }
        // De-dup by handle (two profiles with the same handle share one cache entry).
        const byHandle = new Map<string, XAvatarRepairCandidate>();
        for (const c of latestByProfile.values()) {
          if (!byHandle.has(c.handle)) byHandle.set(c.handle, c);
        }
        return [...byHandle.values()];
      } catch {
        return [];
      }
    },
    readCache: async (caseId) => {
      const { secureReadFile } = await import('../storage/secure-fs');
      const p = await resolvePath(caseId);
      try {
        const buf = await secureReadFile(p);
        return JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
      } catch (e) {
        if (isEnoent(e)) return null;
        throw e;
      }
    },
    writeCache: async (caseId, map) => {
      const { secureWriteFile } = await import('../storage/secure-fs');
      const p = await resolvePath(caseId);
      await secureWriteFile(p, JSON.stringify(map, null, 2));
    },
    now: () => new Date().toISOString(),
    cap: DEFAULT_AVATAR_REPAIR_CAP,
  };
}

/** Normalize a raw persisted avatar-cache object into a clean `{ handle: entry }` map — every key is
 *  re-canonicalized and only entries with a well-formed local `ref` are kept. Any junk is dropped, so
 *  a legacy/corrupt sidecar degrades to "fewer known-cached handles" (which merely re-repairs), never
 *  a crash. */
function normalizeCacheMap(raw: Record<string, unknown> | null | undefined): XAvatarCacheMap {
  const out: XAvatarCacheMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const handle = normalizeXSourceKey(k);
    if (!handle || !v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    const ref = String(e.ref ?? '');
    if (!/^x-media\/[0-9a-f]{64}$/.test(ref)) continue;
    out[handle] = {
      ref,
      sha256: String(e.sha256 ?? ''),
      sourceUrl: String(e.sourceUrl ?? ''),
      cachedAt: String(e.cachedAt ?? ''),
    };
  }
  return out;
}

/** Read the per-campaign avatar cache, healed. ANY read failure resolves to an EMPTY map (every
 *  handle ⇒ "not yet cached") rather than throwing — a hiccup re-repairs, never crashes the launch. */
async function readCacheMap(caseId: string, deps: XAvatarRepairDeps): Promise<XAvatarCacheMap> {
  try {
    return normalizeCacheMap(await deps.readCache(caseId));
  } catch {
    return {};
  }
}

/** Is this candidate's avatar URL a host-anchored, `http(s)`, allowlist-host image URL we may
 *  re-fetch? Rejects anything off-allowlist (by parsed hostname, never a substring), non-`http(s)`,
 *  or malformed BEFORE a window is opened — `cacheRemoteMedia` enforces the same anchor at fetch time,
 *  this is the belt-and-braces pre-filter so junk never even opens a capture window. */
function isRepairableUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return MEDIA_HOST_ALLOWLIST.includes(parsed.hostname);
}

/**
 * Run one bounded, Tor-gated, idempotent avatar-repair pass for `caseId` (the active campaign).
 *
 * Order (fail-closed by construction):
 *   1. Read the cache ledger + enumerate candidates (LOCAL reads, no egress).
 *   2. Filter to REPAIRABLE candidates (valid handle + allowlist `http(s)` URL) NOT already cached.
 *   3. If nothing is pending → return early (no window, no gate touch) — the idempotent no-op.
 *   4. Resolve the Tor gate; if blocked → return `{ blocked:true }` opening NO window (fail-closed).
 *   5. Open ONE window over the resolved posture; re-fetch up to `cap` avatars via `cacheRemoteMedia`;
 *      persist the newly localized refs; ALWAYS destroy the window in a `finally`.
 */
export async function repairAvatars(
  caseId: string,
  overrides: Partial<XAvatarRepairDeps> = {},
): Promise<XAvatarRepairResult> {
  const deps: XAvatarRepairDeps = { ...defaultDeps(), ...overrides };
  // Re-clamp the cap main-side — a renderer/settings value can never arm an unbounded loop.
  const cap = Math.max(1, Math.min(MAX_AVATAR_REPAIR_CAP, Math.floor(Number(deps.cap) || DEFAULT_AVATAR_REPAIR_CAP)));

  const [map, candidates] = await Promise.all([readCacheMap(caseId, deps), deps.listCandidates(caseId)]);
  const scanned = candidates.length;

  // Repairable = well-formed handle + allowlist http(s) URL. Pending = repairable AND not yet cached.
  const repairable = candidates.filter(
    (c) => X_HANDLE_RE.test(normalizeXSourceKey(c.handle)) && isRepairableUrl(c.sourceUrl),
  );
  const pending = repairable.filter((c) => !map[normalizeXSourceKey(c.handle)]);
  const skipped = repairable.length - pending.length;

  if (pending.length === 0) {
    // Nothing to do — idempotent no-op. No window, no gate resolution, no egress.
    return { blocked: false, scanned, repaired: 0, skipped, failures: 0, cap };
  }

  // FAIL CLOSED: resolve the Tor posture and refuse (opening no window) when it is blocked. No clearnet
  // fallback unless the acked-clearnet toggle is on (the strict background default).
  const clearnetEnabled = await deps.loadClearnetEnabled();
  const gate = await deps.resolveGate(clearnetEnabled);
  if (gate.blocked) {
    return { blocked: true, reason: gate.reason, scanned, repaired: 0, skipped, failures: 0, cap };
  }

  const batch = pending.slice(0, cap);
  const win = await deps.openWindow(REPAIR_WINDOW_URL, gate.proxy);
  let repaired = 0;
  let failures = 0;
  try {
    for (const c of batch) {
      const handle = normalizeXSourceKey(c.handle);
      try {
        const cached = await deps.cache(win, c.sourceUrl, caseId);
        if (cached) {
          map[handle] = { ref: cached.ref, sha256: cached.sha256, sourceUrl: c.sourceUrl, cachedAt: deps.now() };
          repaired += 1;
        } else {
          failures += 1;
        }
      } catch (err) {
        // A single avatar failure must never abort the whole pass (Enterprise: individual image
        // failures don't block repair completion) — count it and carry on.
        failures += 1;
        console.warn(`[XListening] avatar repair fetch failed for @${handle}:`, err);
      }
    }
    if (repaired > 0) {
      await deps.writeCache(caseId, map);
    }
  } finally {
    const w = win as unknown as { isDestroyed?: () => boolean; destroy?: () => void };
    if (typeof w.destroy === 'function' && !(w.isDestroyed && w.isDestroyed())) {
      w.destroy();
    }
  }

  return { blocked: false, scanned, repaired, skipped, failures, cap };
}

/** Injectable seam for `getRepairedAvatar` — production default resolves the cache + read-back lazily. */
export interface GetRepairedAvatarDeps {
  readCache: (caseId: string) => Promise<Record<string, unknown> | null>;
  readMedia: (caseId: string, ref: string) => Promise<string | null>;
}

/**
 * Read back a previously-repaired avatar for one handle as a display `data:` URI (or null when the
 * handle has no cached avatar / the read misses) — the future PostCard/identity consumer (Phase 4 I1)
 * gets a localized avatar, never a raw remote URL or vault bytes. `ref` is validated inside
 * `readCachedMedia` before any path is built. Not wired to an IPC channel yet (H1's deliverable is
 * the repair pass); exported for the display consumer to bind.
 */
export async function getRepairedAvatar(
  caseId: string,
  handle: string,
  overrides: Partial<GetRepairedAvatarDeps> = {},
): Promise<string | null> {
  const deps: GetRepairedAvatarDeps = {
    readCache: async (id) => {
      const [{ join }, paths, { secureReadFile }] = await Promise.all([
        import('node:path'),
        import('../storage/paths'),
        import('../storage/secure-fs'),
      ]);
      const p = join(paths.scrapingCaseDir('x', id), X_AVATAR_CACHE_FILE);
      try {
        const buf = await secureReadFile(p);
        return JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
    readMedia: async (id, ref) => {
      const { readCachedMedia } = await import('./media');
      return readCachedMedia(id, ref);
    },
    ...overrides,
  };
  const map = normalizeCacheMap(await deps.readCache(caseId).catch(() => null));
  const entry = map[normalizeXSourceKey(handle)];
  if (!entry) return null;
  return deps.readMedia(caseId, entry.ref);
}
