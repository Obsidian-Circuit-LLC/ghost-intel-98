/**
 * X Listening Station — renderer SHELL (Enterprise v3.4.1 port, Task 13).
 *
 * Wholesale rebuild onto the Phase-1/Phase-2 Tor-default surface (session.ts/capture.ts/
 * campaigns.ts/analysis.ts, `channels.xListening.{openSession,sessionStatus,closeSession,
 * campaigns*,captureTimeline,analysis,health,entities,presets*}`) — NOT the retiring X1-X8
 * clearnet-only surface (`connect`/`status`/`capture`/…, still registered by
 * `registerXListeningIpc` until Task 16 deletes it, but no longer called from here).
 *
 * This file is the SHELL only (plan Task 13): the header — campaign dock, X-session box, Tor/
 * clearnet posture control, and the persistent CLEARNET/DEMO markers. The tab body (dashboard/
 * live/sources/network/entities/changes/search/notes/exports/campaigns/system) lands in
 * Tasks 14-15; until then `xls-body` shows a placeholder.
 *
 * Case-scoped-but-not-case-required: `caseId` (from `spec.props`) is kept ONLY as an optional
 * display label for a core investigation case this window happened to be opened from — it is
 * NEVER required and NEVER threaded into any xListening IPC call. Every X capture/collection
 * concept here is a self-managed **campaign** — an `x`-namespace scraping-case id
 * (`campaigns.ts`) the module creates/switches/renames/deletes on its own. This is what removes
 * the old "open from a case to capture" requirement (contrast the retiring module's
 * `requireCase()` gate, which this shell has no equivalent of).
 *
 * Tor posture: default is Tor-routed (`AppSettings.xListening.clearnet === false`); `openSession`
 * fails closed (`{blocked:true, reason}`) when background Tor isn't bootstrapped — no silent
 * clearnet fallback (session.ts). Flipping to clearnet is gated by a ONE-TIME real-IP
 * acknowledgement (`AppSettings.xListening.clearnetAck`), mirroring
 * `ai-assistant/useClearnetLinkOpener` (`ai.linkClearnetAcknowledged`) and the Host-Info clearnet
 * toggle (`geoint.cctvResolveClearnetAck` in SettingsModule) — the confirm dialog is shown only
 * on the first false→true flip while unacknowledged; once acknowledged, clearnet can be toggled
 * on/off freely without re-prompting. The FULL fixed-shape `xListening` block is always sent on
 * patch (never a bare `{ clearnet }`) so a sibling toggle (`collect`/`archiveCycles`) can never be
 * dropped by a shallow merge (the v3.24.0 dataloss class).
 *
 * Markers: the CLEARNET/TOR badge is driven directly by the persisted `clearnet` setting (real,
 * shared state — not a fabricated indicator). The DEMO DATA LOADED marker is driven by
 * `hasSyntheticRecords` over this shell's local `posts` cache — empty today (Task 14 populates it
 * via `captureTimeline`; a future "Load Demo Data" action populates it with `synthetic:true`
 * records, store.ts/demo.ts) — so the marker is honestly silent until a campaign actually holds
 * demo/seeded data, never asserted speculatively.
 *
 * No hollow UI (the v3.24.2 lesson): every button below invokes a REAL `window.api.xListening.*`
 * channel — campaign create/switch/rename/delete all round-trip through `campaigns.ts`; the
 * session box drives `openSession`/`sessionStatus`/`closeSession`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScrapingCase } from '@shared/types';
import { normalizeXSourceKey } from '@shared/x-listening-source';
import {
  DEFAULT_COLLECTION_SETTINGS,
  COLLECTION_SETTINGS_RANGES,
  clampCollectionSettings,
  type XCollectionSettings,
  type CollectionSettingNumericField,
} from '@shared/x-listening-collection-settings';
import {
  effectiveImageCollection,
  IMAGE_MODES,
  DEFAULT_IMAGE_MODE,
  type XImageMode,
} from '@shared/x-listening-image-policy';
import { useSettings } from '../../state/store';
import { confirmDialog, promptDialog } from '../../state/dialogs';
import { NetworkGraph } from './NetworkGraph';
import './x-listening.css';

/** A campaign IS an x-namespace scraping-case id (campaigns.ts) — no separate shape. */
export type XCampaign = ScrapingCase;

/** Minimal local view of a captured X post record — just enough to detect demo/seeded data.
 *  Deliberately NOT the main-process-only `XPostArtifact` (store.ts): this renderer must never
 *  import from `src/main/**` (quarantine-clean boundary — capture-window.ts's own header makes
 *  the same point about the harness staying import-graph-clean of the modules that use it). */
export interface XPostRecord {
  id: string;
  synthetic?: boolean;
}

/** True iff any record carries the demo/seeded honesty flag (Task 12's `synthetic:true`) — the
 *  DEMO DATA LOADED marker's pure predicate. Exported so later tabs (Task 14+) can reuse the
 *  exact same rule rather than re-deriving it. */
export function hasSyntheticRecords(records: readonly XPostRecord[]): boolean {
  return records.some((r) => r.synthetic === true);
}

// ── Task 14: dashboard / live / sources / network / entities tabs ──────────────────────────
//
// Every field below is a LOOSE, renderer-owned view over what the `Record<string, unknown>`-
// typed IPC boundary (`postsList`/`analysis`/`health`/`entities` — see ipc-contracts.ts) actually
// returns; the preload contract deliberately doesn't leak `src/main`-only types (`XPostArtifact`,
// `NetworkAnalysis`, …) across the boundary, so this file defines its own narrow shapes and casts
// through `unknown` at the one call site each is read. `XPostRow` is a structural superset of
// `XPostRecord` above (same `id`/`synthetic?`), so `hasSyntheticRecords` keeps working unchanged.

export type XTab =
  | 'dashboard'
  | 'live'
  | 'sources'
  | 'network'
  | 'entities'
  | 'changes'
  | 'search'
  | 'notes'
  | 'exports'
  | 'campaigns'
  | 'system';

const XLS_TABS: readonly XTab[] = [
  'dashboard',
  'live',
  'sources',
  'network',
  'entities',
  'changes',
  'search',
  'notes',
  'exports',
  'campaigns',
  'system'
];

export interface XPostMetricsView {
  replies: number;
  reposts: number;
  likes: number;
  views: number;
}

export interface XPostRow {
  id: string;
  channelId: string;
  channelLabel: string;
  authorHandle: string;
  text: string;
  publishedAt: string;
  url: string;
  kind: 'post' | 'reply' | 'repost' | 'comment';
  metrics?: XPostMetricsView;
  evidenceHash?: string;
  synthetic?: boolean;
  /** LOCAL secure-fs refs (media.ts `cacheRemoteMedia`, Task 15) — never a remote URL. Resolved
   *  to a displayable `data:` URI on demand via `mediaRead`. */
  mediaRefs?: string[];
  /** Live-verification state (Task A1, VERIFY LIVE) — absent until the post is verified. */
  availability?: 'available' | 'unavailable';
  /** ISO time of the last live verification (Task A1). */
  verifiedAt?: string;
}

export interface XAnalysisPair {
  profileAId: string;
  profileA: string;
  profileBId: string;
  profileB: string;
  commonFollowerCount: number;
  commonFollowingCount: number;
  commonAnyCount: number;
  // Task C2a: the actual overlapping @handles (the full `NetworkAnalysis` carries these across
  // the boundary; the narrow view widens to render them as chip lists). Optional + `?? []`-guarded
  // so a mock/older payload that omits them still renders defensively.
  commonFollowers?: string[];
  commonFollowing?: string[];
  commonAny?: string[];
}

export interface XAnalysisIdentity {
  username: string;
  connectedTargets: number;
  overlapScore: number;
  // Task C2a: the MULTI-TARGET OVERLAP table's follows / followed-by columns + the record avatar.
  displayName?: string;
  avatar?: string;
  followerOf?: string[];
  followingFrom?: string[];
}

export interface XAnalysisGraphNode {
  id: string;
  type: 'target' | 'identity';
  label: string;
}

export interface XAnalysisGraphEdge {
  id: string;
  source: string;
  target: string;
  relationship: 'follower' | 'following';
}

export interface XAnalysisView {
  targetCount: number;
  relationshipCount: number;
  uniqueIdentityCount: number;
  commonIdentityCount: number;
  highOverlapCount: number;
  pairs: XAnalysisPair[];
  identities: XAnalysisIdentity[];
  graph: { nodes: XAnalysisGraphNode[]; edges: XAnalysisGraphEdge[] };
}

const EMPTY_ANALYSIS: XAnalysisView = {
  targetCount: 0,
  relationshipCount: 0,
  uniqueIdentityCount: 0,
  commonIdentityCount: 0,
  highOverlapCount: 0,
  pairs: [],
  identities: [],
  graph: { nodes: [], edges: [] },
};

export interface XHealthRow {
  profileId: string;
  username: string;
  status: string;
}

export interface XEntityRow {
  id: string;
  type: string;
  value: string;
  count: number;
}

// ── Task 15: changes / search / notes / exports / campaigns / system tabs ──────────────────

/** One flattened follower/following account row — the Changes tab's raw view over
 *  `networksList` (store.ts `XNetworkArtifact`/`XNetworkAccount`, Task 7's accumulator). */
export interface XNetworkAccountRow {
  target: string;
  kind: 'followers' | 'following';
  handle: string;
  displayName?: string;
  // Task C2a: EXTRACTED NETWORK RECORDS renders these. `avatar` is a LOCAL `data:` URI or absent
  // (remote avatars are dropped by the capture normalizer — C1) — never a remote URL fetched here.
  avatar?: string;
  bio?: string;
  firstObservedAt?: string;
  lastObservedAt?: string;
  synthetic?: boolean;
}

export interface XNoteRow {
  findingId: string;
  text: string;
  savedAt: string;
}

/** One historical change event — the Change Intel tab's HISTORICAL CHANGE EVENTS stream
 *  (store.ts `XChangeEvent`, Task A2). Rendered newest-first alongside the network deltas. */
export interface XChangeEventRow {
  id: string;
  kind: 'post_changed' | 'profile_change' | 'post_unavailable';
  at: string;
  summary: string;
  postId?: string;
  profileId?: string;
  sourceUsername?: string;
}

/** One collection-run record — the Change Intel tab's COLLECTION RUN LOG stream (store.ts
 *  `XRunLogRecord`, Task A3). Emitted by the capture/archive paths, rendered newest-first. */
export interface XRunLogRow {
  profileId: string;
  username: string;
  operation:
    | 'posts'
    | 'followers'
    | 'following'
    | 'archive_posts'
    | 'archive_followers'
    | 'archive_following';
  observed: number;
  added: number;
  duplicates: number;
  requestedPasses: number;
  completedPasses: number;
  reachedEnd: boolean;
  stopReason: string;
  status: string;
  startedAt: string;
  endedAt: string;
}

export interface XArchiveStateView {
  cursor: string | null;
  cycles: number;
  lastRunAt: string | null;
}

const EMPTY_ARCHIVE_STATE: XArchiveStateView = { cursor: null, cycles: 0, lastRunAt: null };

/** A saved highlight preset (store.ts `XPreset`) — the Search tab's "save this query" row,
 *  pairing local search with Task 10's presets backend (design doc bullet 9: "Highlight
 *  presets / local search" is ONE feature area, not two disconnected surfaces). */
export interface XPresetRow {
  id: string;
  name: string;
  keywords: string[];
  mode: 'any' | 'all';
  updatedAt: string;
}

const POST_KIND_LABEL: Record<XPostRow['kind'], string> = {
  post: 'POST',
  reply: 'REPLY',
  repost: 'REPOST',
  comment: 'COMMENT',
};

function formatMetric(n: number | undefined): string {
  if (n === undefined) return '—';
  return new Intl.NumberFormat(undefined, { notation: 'compact' }).format(n);
}

function formatWhen(iso: string | undefined): string {
  if (!iso) return 'Unknown time';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const CLEARNET_WARNING_TEXT =
  'Routing X capture over CLEARNET exposes your real IP directly to X instead of Tor. ' +
  'This is remembered — you will not be asked again unless you clear it in Settings. Enable clearnet?';

/**
 * Resolve ONE cached local media ref (media.ts `cacheRemoteMedia`, Task 15) to a displayable
 * `data:` URI on demand via the real `mediaRead` channel — the renderer never gets raw vault
 * bytes, only what this channel hands back. Renders nothing while pending/on a miss (a
 * malformed ref, a locked vault, a not-yet-cached file) rather than a broken-image icon.
 */
function XMediaThumb({ caseId, mediaRef }: { caseId: string; mediaRef: string }): JSX.Element | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const dataUri = await window.api.xListening.mediaRead({ caseId, ref: mediaRef });
        if (active) setSrc(dataUri);
      } catch (err) {
        if (active) console.warn('[XListening] mediaRead:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, [caseId, mediaRef]);
  if (!src) return null;
  return <img src={src} alt="captured media" />;
}

export function XListeningModule({ caseId }: { caseId?: string }): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const patchSettings = useSettings((s) => s.patch);

  const [campaigns, setCampaigns] = useState<XCampaign[]>([]);
  const [activeCampaignId, setActiveCampaignId] = useState('');
  const [campaignBusy, setCampaignBusy] = useState(false);

  const [sessionConnected, setSessionConnected] = useState(false);
  const [sessionWindowOpen, setSessionWindowOpen] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);

  const [tab, setTab] = useState<XTab>('dashboard');
  // The PERSISTED source of truth for the active campaign (`postsList` — Task 14), never a
  // renderer-only accumulation of capture results: switching tabs, remounting, or reopening the
  // module must never make previously-captured (but still on-disk) data disappear from view, and
  // must never keep showing a stale batch after another window/session captured more.
  const [posts, setPosts] = useState<XPostRow[]>([]);
  const [analysis, setAnalysis] = useState<XAnalysisView>(EMPTY_ANALYSIS);
  const [health, setHealth] = useState<XHealthRow[]>([]);
  const [entities, setEntities] = useState<XEntityRow[]>([]);
  const [insightsBusy, setInsightsBusy] = useState(false);

  const [targetUsername, setTargetUsername] = useState('');
  const [captureBusy, setCaptureBusy] = useState(false);
  // Task D1: which source card is mid-action (REFRESH/REMOVE) — drives per-card busy state so the
  // analyst gets immediate one-click feedback on the exact row acted on (ADHD-friendly).
  const [sourceBusyId, setSourceBusyId] = useState<string | null>(null);
  const [liveKindFilter, setLiveKindFilter] = useState<'all' | XPostRow['kind']>('all');
  const [entityTypeFilter, setEntityTypeFilter] = useState('all');

  // ── Task C1: Network tab extraction controls ───────────────────────────────
  // TARGET SOURCE selector ('all' or one captured source's username) + VIEW selector
  // (both/followers/following, filters the displayed relationship graph) + the three EXTRACT
  // actions. `networkBusy`/`networkProgress` give immediate one-click feedback (ADHD-friendly).
  const [networkTargetId, setNetworkTargetId] = useState('all');
  const [networkView, setNetworkView] = useState<'both' | 'followers' | 'following'>('both');
  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkProgress, setNetworkProgress] = useState('');
  // Task C2a: MULTI-TARGET OVERLAP "MINIMUM CONNECTED TARGETS" threshold (source parity: default 2,
  // floored at 2 — an identity must connect to at least two targets to be "common").
  const [networkMinTargets, setNetworkMinTargets] = useState(2);

  const [notice, setNotice] = useState('X Listening Station ready.');

  // ── Task 15 tabs: real state, real IPC — no hollow panels ──────────────────
  const [networks, setNetworks] = useState<XNetworkAccountRow[]>([]);
  const [changeEvents, setChangeEvents] = useState<XChangeEventRow[]>([]);
  const [runLog, setRunLog] = useState<XRunLogRow[]>([]);
  /** The post id currently being live-verified (VERIFY LIVE, Task A1) — disables its button. */
  const [verifyingPostId, setVerifyingPostId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [notes, setNotes] = useState<XNoteRow[]>([]);
  const [noteDraftFindingId, setNoteDraftFindingId] = useState('');
  const [noteDraftText, setNoteDraftText] = useState('');
  const [notesBusy, setNotesBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [archiveState, setArchiveState] = useState<XArchiveStateView>(EMPTY_ARCHIVE_STATE);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  // F2: the per-campaign COLLECTION SETTINGS editable draft (loaded from the encrypted per-campaign
  // sidecar on campaign switch; SAVE clamps MAIN-side and returns the stored record).
  const [collectionSettings, setCollectionSettings] =
    useState<XCollectionSettings>(DEFAULT_COLLECTION_SETTINGS);
  const [collectionSettingsBusy, setCollectionSettingsBusy] = useState(false);
  // F1: per-profile image-collection policy — the `{ canonicalSourceKey → mode }` override map + the
  // campaign-wide `retrieveImages` toggle, so each Sources card shows + drives its own Images control.
  const [imagePolicy, setImagePolicy] =
    useState<{ modes: Record<string, XImageMode>; retrieveImages: boolean }>({ modes: {}, retrieveImages: true });
  const [presets, setPresets] = useState<XPresetRow[]>([]);
  const [presetNameDraft, setPresetNameDraft] = useState('');
  const [presetsBusy, setPresetsBusy] = useState(false);

  const xListeningSettings = settings?.xListening;
  const clearnet = xListeningSettings?.clearnet === true;
  const clearnetAck = xListeningSettings?.clearnetAck === true;
  const demoActive = hasSyntheticRecords(posts);

  const activeCampaign = campaigns.find((c) => c.id === activeCampaignId);

  // ── campaign list (self-managed — no core case need be bound) ────────────
  const loadCampaigns = useCallback(async (preferId?: string) => {
    try {
      const list = await window.api.xListening.campaignsList();
      setCampaigns(list);
      setActiveCampaignId((cur) => {
        if (preferId && list.some((c) => c.id === preferId)) return preferId;
        if (cur && list.some((c) => c.id === cur)) return cur;
        return list[0]?.id ?? '';
      });
    } catch (err) {
      console.warn('[XListening] campaignsList:', err);
    }
  }, []);

  useEffect(() => {
    void loadCampaigns();
    // Mount-only: campaign list is refreshed explicitly after every create/rename/delete below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── session status for the active campaign ────────────────────────────────
  const refreshSession = useCallback(async (id: string) => {
    if (!id) {
      setSessionConnected(false);
      setSessionWindowOpen(false);
      return;
    }
    try {
      const s = await window.api.xListening.sessionStatus(id);
      setSessionConnected(s.connected);
      setSessionWindowOpen(s.windowOpen);
    } catch (err) {
      console.warn('[XListening] sessionStatus:', err);
    }
  }, []);

  useEffect(() => {
    void refreshSession(activeCampaignId);
  }, [activeCampaignId, refreshSession]);

  // ── Task 14: dashboard/live/sources/network/entities data — real IPC, no hollow panels ────
  // A campaign with no id (none created/selected yet) fetches NOTHING — an honest empty state,
  // never a call with a garbage/empty caseId that the main handlers would reject anyway.
  const loadInsights = useCallback(async (id: string) => {
    if (!id) {
      setPosts([]);
      setAnalysis(EMPTY_ANALYSIS);
      setHealth([]);
      setEntities([]);
      setNetworks([]);
      setChangeEvents([]);
      setRunLog([]);
      setNotes([]);
      setArchiveState(EMPTY_ARCHIVE_STATE);
      setPresets([]);
      return;
    }
    setInsightsBusy(true);
    try {
      const [postsRes, analysisRes, healthRes, entitiesRes, networksRes, notesRes, archiveRes, presetsRes, changeEventsRes, runLogRes] =
        await Promise.all([
          window.api.xListening.postsList(id),
          window.api.xListening.analysis(id),
          window.api.xListening.health(id),
          window.api.xListening.entities(id),
          window.api.xListening.networksList(id),
          window.api.xListening.readNotes(id),
          window.api.xListening.archiveStatus(id),
          window.api.xListening.presetsRead(id),
          window.api.xListening.changeEvents(id),
          window.api.xListening.runLog(id),
        ]);
      setPosts((postsRes as unknown as XPostRow[]) ?? []);
      setAnalysis((analysisRes as unknown as XAnalysisView) ?? EMPTY_ANALYSIS);
      setHealth((healthRes as unknown as XHealthRow[]) ?? []);
      setEntities((entitiesRes as unknown as XEntityRow[]) ?? []);
      // networksList returns raw XNetworkArtifact[] ({target,kind,accounts[],capturedAt}) —
      // flatten to the Changes tab's per-account row view client-side.
      const artifacts = (networksRes as unknown as Array<{
        target: string;
        kind: 'followers' | 'following';
        accounts: XNetworkAccountRow[];
      }>) ?? [];
      setNetworks(
        artifacts.flatMap((a) =>
          (a.accounts ?? []).map((acct) => ({ ...acct, target: a.target, kind: a.kind })),
        ),
      );
      setNotes(((notesRes as unknown as { notes: XNoteRow[] })?.notes) ?? []);
      setArchiveState((archiveRes as unknown as XArchiveStateView | null) ?? EMPTY_ARCHIVE_STATE);
      setPresets(((presetsRes as unknown as { presets: XPresetRow[] })?.presets) ?? []);
      setChangeEvents((changeEventsRes as unknown as XChangeEventRow[]) ?? []);
      setRunLog((runLogRes as unknown as XRunLogRow[]) ?? []);
    } catch (err) {
      console.warn('[XListening] loadInsights:', err);
    } finally {
      setInsightsBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadInsights(activeCampaignId);
  }, [activeCampaignId, loadInsights]);

  // Shared by the Live and Sources tabs: the analyst navigates the campaign's open capture
  // window to a target profile manually (Open Session above), then this drives the REAL
  // `captureTimeline` channel for whatever page is currently loaded there. On success the
  // PERSISTED list is re-read (`loadInsights`) rather than trusting the returned batch alone —
  // `captureTimeline` only reports what THIS call captured, not the campaign's full history.
  const handleCaptureTimeline = useCallback(async () => {
    if (!activeCampaignId) {
      setNotice('Create or select a campaign before capturing.');
      return;
    }
    const username = targetUsername.trim().replace(/^@+/, '');
    if (!username) {
      setNotice('Enter a target username to capture.');
      return;
    }
    setCaptureBusy(true);
    try {
      const res = await window.api.xListening.captureTimeline({
        caseId: activeCampaignId,
        channelId: username,
        channelLabel: `@${username}`,
        targetUsername: username,
      });
      if (res.blocked) {
        setNotice(res.reason ?? 'Capture blocked.');
      } else {
        setNotice(
          `Captured ${res.added} new post(s) (${res.skipped} already known) from @${username}.`,
        );
        await loadInsights(activeCampaignId);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setCaptureBusy(false);
    }
  }, [activeCampaignId, targetUsername, loadInsights]);

  // Sources: the distinct targets observed across captured posts, derived client-side over the
  // real fetched `posts` list — not a separate "profiles" concept this data model doesn't have.
  const sourceGroups = useMemo(() => {
    const map = new Map<
      string,
      { channelId: string; channelLabel: string; count: number; lastPublishedAt: string }
    >();
    for (const p of posts) {
      const raw = p.channelId || p.authorHandle;
      // Key by the SHARED canonicalization removeSource uses, so two casings of one handle collapse
      // to a single card (else removing one card would cascade-delete the other's evidence). Keep the
      // first-seen RAW handle as the card's channelId for display + as the removeSource/capture target.
      const key = normalizeXSourceKey(raw);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        if (p.publishedAt > existing.lastPublishedAt) existing.lastPublishedAt = p.publishedAt;
      } else {
        map.set(key, {
          channelId: raw,
          channelLabel: p.channelLabel || `@${p.authorHandle}`,
          count: 1,
          lastPublishedAt: p.publishedAt,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [posts]);

  const livePosts = useMemo(
    () => posts.filter((p) => liveKindFilter === 'all' || p.kind === liveKindFilter),
    [posts, liveKindFilter],
  );

  const entityTypes = useMemo(() => [...new Set(entities.map((e) => e.type))].sort(), [entities]);
  const filteredEntities = useMemo(
    () => (entityTypeFilter === 'all' ? entities : entities.filter((e) => e.type === entityTypeFilter)),
    [entities, entityTypeFilter],
  );

  const healthyCount = useMemo(() => health.filter((h) => h.status === 'HEALTHY').length, [health]);

  // ── Task A1: live post verification (VERIFY LIVE) ───────────────────────────
  // Re-verify a captured post against its live X URL through the real `verifyPost` channel — a
  // Tor-gated capture window opens MAIN-side (fail-closed, no clearnet fallback). On success the
  // PERSISTED list is re-read (`loadInsights`) so an edited post's new text / a removed post's
  // availability lands in the visible feed rather than trusting the returned value alone. Declared
  // BEFORE `renderPost` so it can sit in that callback's dependency list without a TDZ error.
  const handleVerifyPost = useCallback(
    async (postId: string) => {
      if (!activeCampaignId) return;
      setVerifyingPostId(postId);
      try {
        const res = await window.api.xListening.verifyPost({ caseId: activeCampaignId, postId });
        setNotice(
          res.availability === 'unavailable'
            ? 'Live verification: post is no longer available at its original URL.'
            : res.changed
              ? 'Live verification: post text changed — a prior version was archived.'
              : 'Live verification: post is available and unchanged.',
        );
        await loadInsights(activeCampaignId);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      } finally {
        setVerifyingPostId(null);
      }
    },
    [activeCampaignId, loadInsights],
  );

  const renderPost = useCallback(
    (post: XPostRow) => (
      <article className="xls-post-card" key={post.id}>
        <div className="xls-post-head">
          <strong>@{post.authorHandle}</strong>
          <span className="xls-kind">{POST_KIND_LABEL[post.kind] ?? post.kind.toUpperCase()}</span>
          {post.synthetic && <span className="xls-marker xls-marker-demo">DEMO</span>}
          {post.availability === 'unavailable' && (
            <span className="xls-marker xls-marker-unavailable">UNAVAILABLE</span>
          )}
          <time>{formatWhen(post.publishedAt)}</time>
        </div>
        <p className="xls-post-text">{post.text}</p>
        {activeCampaignId && post.mediaRefs && post.mediaRefs.length > 0 && (
          <div className="xls-media-strip">
            {post.mediaRefs.map((ref) => (
              <XMediaThumb key={ref} caseId={activeCampaignId} mediaRef={ref} />
            ))}
          </div>
        )}
        {post.metrics && (
          <div className="xls-metrics">
            <span>↩ {formatMetric(post.metrics.replies)}</span>
            <span>⟳ {formatMetric(post.metrics.reposts)}</span>
            <span>♥ {formatMetric(post.metrics.likes)}</span>
            <span>◉ {formatMetric(post.metrics.views)}</span>
            <span className="xls-stamp" title={post.evidenceHash}>
              SHA-256 {post.evidenceHash ? `${post.evidenceHash.slice(0, 10)}…` : '—'}
            </span>
          </div>
        )}
        {!post.synthetic && (
          <div className="xls-post-actions">
            <button
              type="button"
              className="xls-btn"
              disabled={verifyingPostId === post.id}
              onClick={() => void handleVerifyPost(post.id)}
              title="Open this post's real X URL over Tor and check whether it still exists or was edited."
            >
              {verifyingPostId === post.id ? 'VERIFYING…' : 'VERIFY LIVE'}
            </button>
          </div>
        )}
      </article>
    ),
    [activeCampaignId, handleVerifyPost, verifyingPostId],
  );

  // ── campaign dock actions ──────────────────────────────────────────────────
  const handleNewCampaign = useCallback(async () => {
    const name = await promptDialog(
      'Name this campaign (a self-managed X collection case — no core investigation case is required):',
      '',
      'New campaign',
    );
    if (!name || !name.trim()) return;
    setCampaignBusy(true);
    try {
      const created = await window.api.xListening.campaignsCreate(name.trim());
      await loadCampaigns(created.id);
      setNotice(`Campaign "${created.name}" created.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setCampaignBusy(false);
    }
  }, [loadCampaigns]);

  const handleSwitchCampaign = useCallback(
    async (id: string) => {
      if (!id) {
        setActiveCampaignId('');
        return;
      }
      setCampaignBusy(true);
      try {
        // Look up (and thereby validate) the campaign still exists via the real channel — a
        // stale local list entry (deleted from another window) must never be silently treated
        // as active.
        const fresh = await window.api.xListening.campaignsSwitch(id);
        setCampaigns((cur) => cur.map((c) => (c.id === fresh.id ? fresh : c)));
        setActiveCampaignId(fresh.id);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      } finally {
        setCampaignBusy(false);
      }
    },
    [],
  );

  const handleRenameCampaign = useCallback(async () => {
    if (!activeCampaign) return;
    const name = await promptDialog('Rename this campaign:', activeCampaign.name, 'Rename campaign');
    if (!name || !name.trim()) return;
    setCampaignBusy(true);
    try {
      await window.api.xListening.campaignsUpdate({ id: activeCampaign.id, name: name.trim() });
      await loadCampaigns(activeCampaign.id);
      setNotice('Campaign renamed.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setCampaignBusy(false);
    }
  }, [activeCampaign, loadCampaigns]);

  // Accepts an explicit `target` (Task 15's Campaigns tab, deleting a NON-active row without
  // first switching to it) — defaults to the active campaign (the header dock's button).
  const handleDeleteCampaign = useCallback(
    async (target?: XCampaign) => {
      const victim = target ?? activeCampaign;
      if (!victim) return;
      const ok = await confirmDialog(
        `Delete campaign "${victim.name}"? This permanently removes every post, network, ` +
          'note, preset and archive cursor it holds.',
        'Delete campaign',
      );
      if (!ok) return;
      setCampaignBusy(true);
      try {
        await window.api.xListening.campaignsDelete(victim.id);
        if (victim.id === activeCampaignId) setActiveCampaignId('');
        await loadCampaigns();
        setNotice('Campaign deleted.');
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      } finally {
        setCampaignBusy(false);
      }
    },
    [activeCampaign, activeCampaignId, loadCampaigns],
  );

  // ── session actions ────────────────────────────────────────────────────────
  const handleOpenSession = useCallback(async () => {
    if (!activeCampaignId) {
      setNotice('Create or select a campaign before opening a session.');
      return;
    }
    setSessionBusy(true);
    try {
      const res = await window.api.xListening.openSession(activeCampaignId);
      setNotice(res.blocked ? (res.reason ?? 'Session blocked.') : 'X session window opened.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setSessionBusy(false);
      await refreshSession(activeCampaignId);
    }
  }, [activeCampaignId, refreshSession]);

  const handleCloseSession = useCallback(async () => {
    if (!activeCampaignId) return;
    setSessionBusy(true);
    try {
      await window.api.xListening.closeSession(activeCampaignId);
      setNotice('Session window closed.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setSessionBusy(false);
      await refreshSession(activeCampaignId);
    }
  }, [activeCampaignId, refreshSession]);

  // ── Tor / clearnet posture ─────────────────────────────────────────────────
  const setClearnet = useCallback(
    async (next: boolean) => {
      const x = xListeningSettings;
      if (!x) return;
      if (next && !clearnetAck) {
        const ok = await confirmDialog(CLEARNET_WARNING_TEXT, 'Enable clearnet capture');
        if (!ok) return;
        await patchSettings({ xListening: { ...x, clearnet: true, clearnetAck: true } });
        return;
      }
      await patchSettings({ xListening: { ...x, clearnet: next } });
    },
    [xListeningSettings, clearnetAck, patchSettings],
  );

  // ── Task 15: notes (findingId = a captured post id) ─────────────────────────
  const handleSaveNote = useCallback(async () => {
    if (!activeCampaignId) return;
    const findingId = noteDraftFindingId;
    const text = noteDraftText.trim();
    if (!findingId) {
      setNotice('Select a captured post to attach the note to.');
      return;
    }
    if (!text) {
      setNotice('Enter note text before saving.');
      return;
    }
    setNotesBusy(true);
    try {
      const res = await window.api.xListening.saveNote({ caseId: activeCampaignId, findingId, text });
      setNotes(res.notes as unknown as XNoteRow[]);
      setNoteDraftText('');
      setNotice('Note saved.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setNotesBusy(false);
    }
  }, [activeCampaignId, noteDraftFindingId, noteDraftText]);

  const handleRemoveNote = useCallback(
    async (findingId: string) => {
      if (!activeCampaignId) return;
      setNotesBusy(true);
      try {
        const res = await window.api.xListening.removeNote({ caseId: activeCampaignId, findingId });
        setNotes(res.notes as unknown as XNoteRow[]);
        setNotice('Note removed.');
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      } finally {
        setNotesBusy(false);
      }
    },
    [activeCampaignId],
  );

  // ── Task 15: interactive exports (native save dialog — real IPC, no fabricated path) ────
  const handleExportPosts = useCallback(
    async (format: 'json' | 'csv' | 'pdf') => {
      if (!activeCampaignId) return;
      setExportBusy(true);
      try {
        const res = await window.api.xListening.exportPostsToFile({ caseId: activeCampaignId, format });
        setNotice(
          res.canceled
            ? 'Export canceled.'
            : `Exported ${res.count} post(s) to ${res.filePath} (sha256 ${res.sha256.slice(0, 10)}…).`,
        );
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      } finally {
        setExportBusy(false);
      }
    },
    [activeCampaignId],
  );

  const handleExportNetwork = useCallback(async () => {
    if (!activeCampaignId) return;
    setExportBusy(true);
    try {
      const res = await window.api.xListening.exportNetworkToFile(activeCampaignId);
      setNotice(
        res.canceled
          ? 'Export canceled.'
          : `Exported ${res.count} network account(s) to ${res.filePath} (sha256 ${res.sha256.slice(0, 10)}…).`,
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setExportBusy(false);
    }
  }, [activeCampaignId]);

  // ── Task E1: Tor-gated "open in X" affordance (openInX) ─────────────────────────────────
  // Opens the real X surface (a thread / a @profile / a network identity) in an in-app,
  // Tor-gated capture window. The URL is validated + constructed MAIN-side BEFORE any window
  // opens (fail-closed under Tor); this only forwards the {kind, ref} and surfaces any refusal.
  // Consumed here by the network overlap rows; C2b (graph inspector) + D1 ("View X") reuse it.
  const handleOpenInX = useCallback(
    async (kind: 'thread' | 'profile' | 'identity', ref: string) => {
      const cleaned = String(ref ?? '').trim();
      if (!cleaned) return;
      try {
        await window.api.xListening.openInX({ kind, ref: cleaned });
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  // ── Task C1: EXTRACT FOLLOWERS / FOLLOWING / BOTH ──────────────────────────
  // Drives the REAL `captureNetwork` channel (Tor-gated MAIN-side, fail-closed) for the selected
  // TARGET SOURCE — 'all' fans out across every captured source, otherwise the one picked. EXTRACT
  // BOTH runs followers THEN following per target. On success the PERSISTED network accumulator is
  // re-read (`loadInsights`) so the graph/overlap panels reflect the fresh accounts, never a stale
  // batch. A target with no valid X username (nothing to open) is skipped rather than firing a
  // doomed capture. Immediate one-click feedback via `networkProgress`/`notice` (ADHD-friendly).
  const handleExtractNetwork = useCallback(
    async (mode: 'followers' | 'following' | 'both') => {
      if (!activeCampaignId) {
        setNotice('Create or select a campaign before extracting a network.');
        return;
      }
      const usernameRe = /^[A-Za-z0-9_]{1,15}$/;
      const candidates =
        networkTargetId === 'all'
          ? sourceGroups.map((g) => g.channelId)
          : [networkTargetId];
      const targets: string[] = [];
      const skipped: string[] = [];
      for (const c of candidates) {
        const u = String(c ?? '').replace(/^@+/, '').trim();
        if (usernameRe.test(u)) targets.push(u);
        else if (u) skipped.push(u);
      }
      // Plain-language feedback about which sources were skipped (ADHD-friendliness: never drop
      // silently). Appended to the final notice on success; shown on its own if nothing is valid.
      const skipNote = skipped.length
        ? ` Skipped ${skipped.length} source(s) with an unusable X handle: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}.`
        : '';
      if (targets.length === 0) {
        setNotice(
          `No valid target source to extract. Capture a timeline first, then pick a source.${skipNote}`,
        );
        return;
      }
      const kinds: Array<'followers' | 'following'> =
        mode === 'both' ? ['followers', 'following'] : [mode];
      setNetworkBusy(true);
      let observedTotal = 0;
      let ran = 0;
      let lastBlockedReason: string | undefined;
      try {
        for (const username of targets) {
          for (const kind of kinds) {
            setNetworkProgress(`Extracting ${kind} for @${username}…`);
            try {
              const res = await window.api.xListening.captureNetwork({
                caseId: activeCampaignId,
                channelId: username,
                targetUsername: username,
                kind,
              });
              if (res?.blocked) {
                lastBlockedReason = res.reason;
                continue;
              }
              observedTotal += res?.observed ?? 0;
              ran += 1;
            } catch (err) {
              lastBlockedReason = err instanceof Error ? err.message : String(err);
            }
          }
        }
        if (ran === 0) {
          setNotice(lastBlockedReason ?? 'Network extraction blocked — nothing captured.');
        } else {
          setNotice(
            `Extracted ${observedTotal} account(s) across ${ran} pass(es)` +
              (lastBlockedReason ? ` (some passes were blocked: ${lastBlockedReason})` : '') +
              '.' +
              skipNote,
          );
          await loadInsights(activeCampaignId);
        }
      } finally {
        setNetworkBusy(false);
        setNetworkProgress('');
      }
    },
    [activeCampaignId, networkTargetId, sourceGroups, loadInsights],
  );

  // ── Task D1: Target Sources per-source card actions (source: main.tsx TARGET SOURCES) ────────
  // Each captured source gets REFRESH / VIEW X / NETWORK / REMOVE (per-profile IMAGES is Phase-3 F1,
  // intentionally omitted here). A "source" is derived client-side from posts, so these operate on
  // the source's username (`channelId`), never a persisted profile record.

  // REFRESH — a single-source timeline capture. Reuses the SAME real `captureTimeline` channel the
  // Live/Sources capture uses (Tor-gated MAIN-side, fail-closed), scoped to this one source. On
  // success the PERSISTED list is re-read so the new posts land in every view. Immediate per-card
  // feedback via `sourceBusyId`.
  const handleRefreshSource = useCallback(
    async (sourceKey: string) => {
      if (!activeCampaignId) {
        setNotice('Create or select a campaign before refreshing a source.');
        return;
      }
      const username = String(sourceKey ?? '').replace(/^@+/, '').trim();
      if (!username) return;
      setSourceBusyId(sourceKey);
      try {
        const res = await window.api.xListening.captureTimeline({
          caseId: activeCampaignId,
          channelId: username,
          channelLabel: `@${username}`,
          targetUsername: username,
        });
        if (res?.blocked) {
          setNotice(res.reason ?? 'Capture blocked.');
        } else {
          setNotice(
            `Refreshed @${username}: ${res?.added ?? 0} new post(s) (${res?.skipped ?? 0} already known).`,
          );
          await loadInsights(activeCampaignId);
        }
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      } finally {
        setSourceBusyId(null);
      }
    },
    [activeCampaignId, loadInsights],
  );

  // NETWORK — jump to the Network tab with this source pre-selected as the extraction TARGET SOURCE
  // (C1's `networkTargetId`, keyed by `channelId`). No IPC — a pure in-app navigation + preselect.
  const handleSourceNetwork = useCallback((sourceKey: string) => {
    setNetworkTargetId(sourceKey);
    setTab('network');
  }, []);

  // REMOVE — cascade-delete this source's evidence (posts + follower/following network artifacts)
  // through the real `removeSource` channel, behind a confirm gate (destructive). On success the
  // PERSISTED insights are re-read so the source (derived from posts) disappears from every view.
  const handleRemoveSource = useCallback(
    async (source: { channelId: string; channelLabel: string }) => {
      if (!activeCampaignId) return;
      const ok = await confirmDialog(
        `Remove ${source.channelLabel} from this campaign? This permanently deletes its captured ` +
          'posts and any follower/following network records it holds.',
        'Remove source',
      );
      if (!ok) return;
      setSourceBusyId(source.channelId);
      try {
        const res = await window.api.xListening.removeSource({
          caseId: activeCampaignId,
          sourceKey: source.channelId,
        });
        setNotice(
          `Removed ${source.channelLabel}: ${res?.removedPosts ?? 0} post(s) and ` +
            `${res?.removedNetworks ?? 0} network record(s) deleted.`,
        );
        await loadInsights(activeCampaignId);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      } finally {
        setSourceBusyId(null);
      }
    },
    [activeCampaignId, loadInsights],
  );

  // ── Task C2a: Network tab derived views (source: main.tsx FOLLOWER NETWORK) ───────────────
  // The TARGET SOURCE selector ('all' or one captured source username = channelId) scopes the
  // SELECTED counts + EXTRACTED NETWORK RECORDS. `@`-insensitive, case-insensitive match against
  // the captured account's `target`. `null` key = ALL SOURCES (no scoping).
  const networkTargetKey = useMemo(
    () => (networkTargetId === 'all' ? null : String(networkTargetId).replace(/^@+/, '').toLowerCase()),
    [networkTargetId],
  );
  const matchesSelectedTarget = useCallback(
    (target: string): boolean =>
      networkTargetKey === null ||
      String(target ?? '').replace(/^@+/, '').toLowerCase() === networkTargetKey,
    [networkTargetKey],
  );

  // SELECTED FOLLOWERS / SELECTED FOLLOWING stat-card counts — locally observed rows for the
  // selected target (or every target when ALL). Sourced from the captured `networks` accumulator,
  // never fabricated. `networksList` returns the store's rows UNFILTERED, so demo/seeded accounts
  // (`synthetic:true`, demo.ts) must be dropped here — mirroring `computeNetworkAnalysis` and
  // `exportNetworkCsv`, which already exclude synthetic — or these cards would inflate against the
  // adjacent analysis cards / CSV whenever demo data is loaded (Global Constraints honesty rule).
  const selectedFollowerCount = useMemo(
    () =>
      networks.filter(
        (a) => a.kind === 'followers' && !a.synthetic && matchesSelectedTarget(a.target),
      ).length,
    [networks, matchesSelectedTarget],
  );
  const selectedFollowingCount = useMemo(
    () =>
      networks.filter(
        (a) => a.kind === 'following' && !a.synthetic && matchesSelectedTarget(a.target),
      ).length,
    [networks, matchesSelectedTarget],
  );

  // MULTI-TARGET OVERLAP rows — identities connected to >= max(2, MINIMUM CONNECTED TARGETS),
  // capped at 500 (source parity, main.tsx:285). Defensive on a payload that omits `identities`.
  const overlapIdentities = useMemo(
    () =>
      (analysis.identities ?? [])
        .filter((i) => (i.connectedTargets ?? 0) >= Math.max(2, networkMinTargets))
        .slice(0, 500),
    [analysis.identities, networkMinTargets],
  );

  // EXTRACTED NETWORK RECORDS — the captured accounts scoped by TARGET SOURCE + VIEW, capped at
  // 3000 (source parity). `networksList` is UNFILTERED, so demo/seeded rows (`synthetic:true`,
  // demo.ts) are dropped here — this list sits directly above an EXPORT CSV whose count already
  // excludes synthetic, so an unfiltered list would show demo accounts the export omits.
  const networkRecordRows = useMemo(
    () =>
      networks
        .filter(
          (a) =>
            !a.synthetic &&
            matchesSelectedTarget(a.target) &&
            (networkView === 'both' || a.kind === networkView),
        )
        .slice(0, 3000),
    [networks, matchesSelectedTarget, networkView],
  );

  // RECENT NETWORK DELTAS — CONSERVATIVE, derived honestly from the accounts' own first/last-seen
  // bookkeeping (the hardened core keeps no separate network-event log). Per (target, kind) group
  // the latest scan is the max `lastObservedAt`; an account first seen in that latest scan is
  // NEWLY OBSERVED, and an account whose `lastObservedAt` predates its group's latest scan was NOT
  // SEEN in the latest comparable scan — a review candidate, never asserted as an unfollow (X can
  // truncate/reorder lists). Newest-first, capped 100 (source parity, main.tsx:289).
  const recentNetworkDeltas = useMemo(() => {
    // `networksList` is UNFILTERED — drop demo/seeded rows (`synthetic:true`, demo.ts) before both
    // the per-group latest-scan reduction and the delta roll-up, so a demo account never surfaces
    // as a NEWLY OBSERVED / NOT SEEN candidate (Global Constraints honesty rule).
    const realNetworks = networks.filter((a) => !a.synthetic);
    const latestByGroup = new Map<string, string>();
    for (const a of realNetworks) {
      const g = `${a.target}::${a.kind}`;
      const last = a.lastObservedAt ?? '';
      if (last > (latestByGroup.get(g) ?? '')) latestByGroup.set(g, last);
    }
    return realNetworks
      .map((a) => {
        const latest = latestByGroup.get(`${a.target}::${a.kind}`) ?? '';
        const first = a.firstObservedAt ?? '';
        const last = a.lastObservedAt ?? '';
        const newlyObserved = !!first && first === last && last === latest;
        const notSeen = !!last && !!latest && last < latest;
        return { account: a, newlyObserved, notSeen, at: last };
      })
      .filter((r) => r.newlyObserved || r.notSeen)
      .sort((x, y) => y.at.localeCompare(x.at))
      .slice(0, 100);
  }, [networks]);

  // ── Task 15(d): archive step, driven off the campaign's OWN Tor-default session ─────────
  const handleRunArchive = useCallback(async () => {
    if (!activeCampaignId) return;
    const username = targetUsername.trim().replace(/^@+/, '');
    if (!username) {
      setNotice('Enter a target username above before running an archive step.');
      return;
    }
    setArchiveBusy(true);
    try {
      const res = await window.api.xListening.archiveRun({
        caseId: activeCampaignId,
        channelId: username,
        channelLabel: `@${username}`,
        targetUsername: username,
        maxCycles: 1,
      });
      if (res.blocked) {
        setNotice(res.reason ?? 'Archive step blocked.');
      } else if (res.cyclesRun === 0) {
        setNotice('Archive cycles are OFF (Settings → X Listening) — nothing ran.');
      } else {
        setNotice(`Archive step complete — ${res.totalAdded} new post(s).`);
        await loadInsights(activeCampaignId);
      }
      setArchiveState(res.state as unknown as XArchiveStateView);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setArchiveBusy(false);
    }
  }, [activeCampaignId, targetUsername, loadInsights]);

  const handleToggleArchiveCycles = useCallback(
    async (next: boolean) => {
      const x = xListeningSettings;
      if (!x) return;
      await patchSettings({ xListening: { ...x, archiveCycles: next } });
    },
    [xListeningSettings, patchSettings],
  );

  // ── F2: per-campaign COLLECTION SETTINGS (System-tab form) ──────────────────
  // Load THIS campaign's persisted collection settings on switch — a per-campaign record, so
  // switching campaigns loads that campaign's settings (never the last one's). Guarded try/catch so
  // a minimal harness lacking the channel keeps the defaults instead of crashing the module.
  useEffect(() => {
    if (!activeCampaignId) {
      setCollectionSettings(DEFAULT_COLLECTION_SETTINGS);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.api.xListening.getCollectionSettings(activeCampaignId);
        if (!cancelled && res) setCollectionSettings(clampCollectionSettings(res));
      } catch {
        if (!cancelled) setCollectionSettings(DEFAULT_COLLECTION_SETTINGS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCampaignId]);

  // F1: load this campaign's per-profile image policy (override map + campaign toggle) on switch.
  // Guarded so a minimal harness lacking the channel keeps the inherit-everything defaults.
  useEffect(() => {
    if (!activeCampaignId) {
      setImagePolicy({ modes: {}, retrieveImages: true });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.api.xListening.getImagePolicy(activeCampaignId);
        if (!cancelled && res) {
          setImagePolicy({
            modes: res.modes && typeof res.modes === 'object' ? res.modes : {},
            retrieveImages: res.retrieveImages !== false,
          });
        }
      } catch {
        if (!cancelled) setImagePolicy({ modes: {}, retrieveImages: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCampaignId]);

  // F1: set one source's image mode. MAIN-side validates the mode + canonicalizes the key and returns
  // the stored record; we re-seat the local map from it so the control shows exactly what main enforces.
  const handleSetImageMode = useCallback(
    async (sourceKey: string, mode: XImageMode) => {
      if (!activeCampaignId) return;
      const key = normalizeXSourceKey(sourceKey);
      try {
        const res = await window.api.xListening.setProfileImageMode({
          caseId: activeCampaignId,
          sourceKey,
          mode,
        });
        setImagePolicy((prev) => {
          const modes = { ...prev.modes };
          if (res.imageMode === DEFAULT_IMAGE_MODE) delete modes[res.sourceKey || key];
          else modes[res.sourceKey || key] = res.imageMode;
          return { ...prev, modes };
        });
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    },
    [activeCampaignId],
  );

  // Local draft edits — booleans flip immediately, numbers are re-clamped MAIN-side on SAVE (the
  // input min/max come from the shared ranges, so the UI can't offer an out-of-band value anyway).
  const setCollectionBool = useCallback((key: keyof XCollectionSettings, next: boolean) => {
    setCollectionSettings((prev) => ({ ...prev, [key]: next }));
  }, []);
  const setCollectionNumber = useCallback((key: CollectionSettingNumericField, raw: string) => {
    // Keep the raw numeric parse local; the authoritative clamp is main-side on SAVE. An empty/NaN
    // input holds the field's default so the form never carries a NaN into the save payload.
    const parsed = Number(raw);
    const next = Number.isFinite(parsed) ? parsed : COLLECTION_SETTINGS_RANGES[key].def;
    setCollectionSettings((prev) => ({ ...prev, [key]: next }));
  }, []);

  const handleSaveCollectionSettings = useCallback(async () => {
    if (!activeCampaignId) return;
    setCollectionSettingsBusy(true);
    try {
      const saved = await window.api.xListening.saveCollectionSettings({
        caseId: activeCampaignId,
        settings: collectionSettings,
      });
      // Re-seat from the MAIN-side clamped record so the UI shows exactly what will be consulted.
      setCollectionSettings(clampCollectionSettings(saved));
      setNotice('Collection settings saved for this campaign.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setCollectionSettingsBusy(false);
    }
  }, [activeCampaignId, collectionSettings]);

  // ── Task 15(a): demo data (honesty-marked, never mistaken for real intel) ───────────────
  const handleLoadDemoData = useCallback(async () => {
    if (!activeCampaignId) return;
    const ok = await confirmDialog(
      'Load seeded DEMO data into this campaign? Every record is stamped synthetic and excluded ' +
        'from network analysis, entity extraction, exports and evidence hashing — but it will ' +
        'appear in the LIVE feed with a DEMO marker.',
      'Load demo data',
    );
    if (!ok) return;
    setDemoBusy(true);
    try {
      const res = await window.api.xListening.loadDemoData(activeCampaignId);
      setNotice(`Loaded ${res.added} demo post(s) (${res.skipped} already present).`);
      await loadInsights(activeCampaignId);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setDemoBusy(false);
    }
  }, [activeCampaignId, loadInsights]);

  // ── Task 15: highlight presets (design doc: "Highlight presets / local search" is ONE
  // feature area) — save the current search query as a reusable, in-app-evaluated preset. ──
  const handleSavePreset = useCallback(async () => {
    if (!activeCampaignId) return;
    const name = presetNameDraft.trim();
    const query = searchQuery.trim();
    if (!name) {
      setNotice('Enter a name for this preset before saving.');
      return;
    }
    if (!query) {
      setNotice('Enter a search query above before saving it as a preset.');
      return;
    }
    setPresetsBusy(true);
    try {
      const keywords = query.split(',').map((k) => k.trim()).filter(Boolean);
      const res = await window.api.xListening.presetsSave({
        caseId: activeCampaignId,
        id: crypto.randomUUID(),
        name,
        keywords,
      });
      setPresets(res.presets as unknown as XPresetRow[]);
      setPresetNameDraft('');
      setNotice(`Preset "${name}" saved.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setPresetsBusy(false);
    }
  }, [activeCampaignId, presetNameDraft, searchQuery]);

  const handleRunPreset = useCallback(
    async (preset: XPresetRow) => {
      if (!activeCampaignId) return;
      setPresetsBusy(true);
      try {
        const res = await window.api.xListening.presetsRun({ caseId: activeCampaignId, id: preset.id });
        setNotice(`Preset "${preset.name}" matched ${res.matches.length} post(s).`);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      } finally {
        setPresetsBusy(false);
      }
    },
    [activeCampaignId],
  );

  const handleRemovePreset = useCallback(
    async (preset: XPresetRow) => {
      if (!activeCampaignId) return;
      setPresetsBusy(true);
      try {
        const res = await window.api.xListening.presetsRemove({ caseId: activeCampaignId, id: preset.id });
        setPresets(res.presets as unknown as XPresetRow[]);
        setNotice(`Preset "${preset.name}" removed.`);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      } finally {
        setPresetsBusy(false);
      }
    },
    [activeCampaignId],
  );

  // ── Task 15: client-side local search over the persisted posts (no server round-trip) ───
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return posts.filter(
      (p) => p.text.toLowerCase().includes(q) || p.authorHandle.toLowerCase().includes(q),
    );
  }, [posts, searchQuery]);

  // ── Task 15: Changes tab — newly-observed vs long-standing network accounts ─────────────
  const sortedNetworkChanges = useMemo(
    () =>
      [...networks].sort((a, b) => (b.lastObservedAt ?? '').localeCompare(a.lastObservedAt ?? '')),
    [networks],
  );

  return (
    <div className="xls-root">
      <header className="xls-dock">
        <div className="xls-dock-row">
          <span className="xls-dock-label">CAMPAIGN</span>
          <select
            className="xls-input xls-dock-select"
            aria-label="Active campaign"
            value={activeCampaignId}
            onChange={(e) => void handleSwitchCampaign(e.target.value)}
            disabled={campaignBusy || campaigns.length === 0}
          >
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            className="xls-btn xls-btn-primary"
            onClick={() => void handleNewCampaign()}
            disabled={campaignBusy}
          >
            New Campaign
          </button>
          <button
            className="xls-btn"
            onClick={() => void handleRenameCampaign()}
            disabled={campaignBusy || !activeCampaign}
          >
            Rename
          </button>
          <button
            className="xls-btn xls-btn-danger"
            onClick={() => void handleDeleteCampaign()}
            disabled={campaignBusy || !activeCampaign}
          >
            Delete
          </button>
        </div>
        {caseId && (
          <div className="xls-dock-note">
            Opened from investigation case {caseId} (label only — this campaign is self-managed
            and works with no case bound).
          </div>
        )}
      </header>

      <div className="xls-session-bar">
        <span className={`xls-status-dot${sessionConnected ? ' xls-online' : ''}`} aria-hidden="true" />
        <div className="xls-session-label">
          <strong>{sessionConnected ? 'X SESSION ONLINE' : 'X SESSION OFFLINE'}</strong>
          <small>
            {sessionWindowOpen ? 'Capture window open' : 'No capture window open'} for this campaign
          </small>
        </div>
        <div className="xls-session-spacer" />
        <div className="xls-markers">
          <span className={`xls-marker${clearnet ? ' xls-marker-clearnet' : ' xls-marker-tor'}`}>
            {clearnet ? 'CLEARNET' : 'TOR'}
          </span>
          {demoActive && <span className="xls-marker xls-marker-demo">DEMO DATA LOADED</span>}
        </div>
        <button
          className="xls-btn"
          onClick={() => void handleCloseSession()}
          disabled={sessionBusy || !sessionWindowOpen}
        >
          Close Session
        </button>
        <button
          className="xls-btn xls-btn-primary"
          onClick={() => void handleOpenSession()}
          disabled={sessionBusy || !activeCampaignId}
        >
          {sessionBusy ? 'Working…' : 'Open Session'}
        </button>
      </div>

      <div className="xls-network-posture">
        <label className="xls-check">
          <input
            type="checkbox"
            checked={clearnet}
            onChange={(e) => void setClearnet(e.target.checked)}
            disabled={!xListeningSettings}
          />
          Route over CLEARNET instead of Tor (exposes your real IP to X)
        </label>
        <p className="xls-help">
          {clearnet
            ? 'Clearnet mode is ON — capture uses your real IP, not Tor.'
            : 'Tor mode (default) — capture fails closed when background Tor is not bootstrapped; there is no clearnet fallback.'}
        </p>
      </div>

      <div className="xls-notice" role="status">
        {notice}
      </div>

      <nav className="xls-tabs">
        {XLS_TABS.map((t) => (
          <button
            key={t}
            className={`xls-tab${tab === t ? ' xls-tab-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </nav>

      <main className="xls-body">
        {tab === 'dashboard' && (
          <section className="xls-tab-panel xls-dashboard">
            <div className="xls-stat-grid">
              <article className="xls-stat">
                <span>CAPTURED POSTS</span>
                <strong>{posts.length}</strong>
              </article>
              <article className="xls-stat">
                <span>TARGETS OBSERVED</span>
                <strong>{sourceGroups.length}</strong>
              </article>
              <article className="xls-stat">
                <span>NETWORK IDENTITIES</span>
                <strong>{analysis.uniqueIdentityCount}</strong>
              </article>
              <article className="xls-stat">
                <span>COMMON IDENTITIES</span>
                <strong>{analysis.commonIdentityCount}</strong>
              </article>
              <article className="xls-stat">
                <span>HIGH OVERLAP</span>
                <strong>{analysis.highOverlapCount}</strong>
              </article>
              <article className="xls-stat">
                <span>EXTRACTED ENTITIES</span>
                <strong>{entities.length}</strong>
              </article>
            </div>

            <div className="xls-panel">
              <div className="xls-panel-title-row">
                <h3 className="xls-panel-title">COLLECTION HEALTH</h3>
                <span className="xls-count">
                  {healthyCount}/{health.length} HEALTHY
                </span>
              </div>
              {health.length === 0 ? (
                <div className="xls-empty">No collection-run log recorded for this campaign yet.</div>
              ) : (
                <ul className="xls-source-list">
                  {health.map((h) => (
                    <li className="xls-source-row" key={h.profileId}>
                      <span>@{h.username}</span>
                      <span>{h.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="xls-panel">
              <h3 className="xls-panel-title">RECENT CAPTURES</h3>
              <div className="xls-feed">
                {posts.slice(0, 5).map(renderPost)}
                {posts.length === 0 && (
                  <div className="xls-empty">No posts captured in this campaign yet.</div>
                )}
              </div>
            </div>
          </section>
        )}

        {tab === 'live' && (
          <section className="xls-tab-panel xls-live">
            <div className="xls-add-source">
              <input
                className="xls-input xls-live-target"
                aria-label="Target username to capture"
                placeholder="username or @username"
                value={targetUsername}
                onChange={(e) => setTargetUsername(e.target.value)}
              />
              <button
                className="xls-btn xls-btn-primary"
                onClick={() => void handleCaptureTimeline()}
                disabled={captureBusy || !activeCampaignId}
              >
                {captureBusy ? 'Capturing…' : 'Capture Timeline'}
              </button>
            </div>
            <div className="xls-network-controls">
              <label className="xls-field">
                KIND
                <select
                  className="xls-input"
                  value={liveKindFilter}
                  onChange={(e) => setLiveKindFilter(e.target.value as 'all' | XPostRow['kind'])}
                >
                  <option value="all">ALL</option>
                  <option value="post">POST</option>
                  <option value="reply">REPLY</option>
                  <option value="repost">REPOST</option>
                  <option value="comment">COMMENT</option>
                </select>
              </label>
              <span className="xls-count">{livePosts.length} displayed</span>
              {insightsBusy && <span className="xls-count">Loading…</span>}
            </div>
            <div className="xls-feed">
              {livePosts.map(renderPost)}
              {livePosts.length === 0 && (
                <div className="xls-empty">No records match these feed filters.</div>
              )}
            </div>
          </section>
        )}

        {tab === 'sources' && (
          <section className="xls-tab-panel xls-sources">
            <div className="xls-add-source">
              <input
                className="xls-input xls-source-target"
                aria-label="Target username to monitor"
                placeholder="username or @username"
                value={targetUsername}
                onChange={(e) => setTargetUsername(e.target.value)}
              />
              <button
                className="xls-btn xls-btn-primary"
                onClick={() => void handleCaptureTimeline()}
                disabled={captureBusy || !activeCampaignId}
              >
                {captureBusy ? 'Capturing…' : 'Capture Timeline'}
              </button>
            </div>
            {sourceGroups.length === 0 ? (
              <div className="xls-empty">No source targets captured in this campaign yet.</div>
            ) : (
              <div className="xls-source-cards">
                {sourceGroups.map((g) => {
                  const busy = sourceBusyId === g.channelId;
                  // F1: this source's override mode (inherit when unset) + the effective decision it
                  // yields against the campaign toggle — shown in plain language on the control.
                  const sourceKey = normalizeXSourceKey(g.channelId);
                  const imageMode = imagePolicy.modes[sourceKey] ?? DEFAULT_IMAGE_MODE;
                  const imagesEffective = effectiveImageCollection(imageMode, imagePolicy.retrieveImages);
                  return (
                    <article className="xls-source-card" data-source={g.channelId} key={g.channelId}>
                      <div className="xls-source-card-head">
                        <span className="xls-source-name">{g.channelLabel}</span>
                        <span className="xls-count">
                          {g.count} captured · last {formatWhen(g.lastPublishedAt)}
                        </span>
                      </div>
                      <div className="xls-source-images">
                        <label className="xls-source-images-label" htmlFor={`xls-img-${sourceKey}`}>
                          Images
                        </label>
                        <select
                          id={`xls-img-${sourceKey}`}
                          className="xls-input xls-source-images-select"
                          aria-label={`Image collection for ${g.channelLabel}`}
                          value={imageMode}
                          disabled={!activeCampaignId}
                          onChange={(e) => void handleSetImageMode(g.channelId, e.target.value as XImageMode)}
                        >
                          {IMAGE_MODES.map((m) => (
                            <option key={m} value={m}>
                              {m === 'on' ? 'On' : m === 'off' ? 'Off' : 'Inherit'}
                            </option>
                          ))}
                        </select>
                        <span
                          className="xls-source-images-effective"
                          data-effective={imagesEffective ? 'on' : 'off'}
                          title={
                            imageMode === 'inherit'
                              ? `Following the campaign images toggle (currently ${imagePolicy.retrieveImages ? 'on' : 'off'}).`
                              : `This source overrides the campaign toggle.`
                          }
                        >
                          {imagesEffective ? 'collecting images' : 'no images'}
                        </span>
                      </div>
                      <div className="xls-source-actions">
                        <button
                          type="button"
                          className="xls-btn"
                          disabled={busy || !activeCampaignId}
                          title={`Capture the latest timeline for ${g.channelLabel}.`}
                          onClick={() => void handleRefreshSource(g.channelId)}
                        >
                          {busy ? 'Working…' : 'Refresh'}
                        </button>
                        <button
                          type="button"
                          className="xls-btn"
                          title={`Open ${g.channelLabel} on X in a hardened Tor-gated window.`}
                          onClick={() => void handleOpenInX('profile', g.channelId)}
                        >
                          View X
                        </button>
                        <button
                          type="button"
                          className="xls-btn"
                          title={`Jump to the Follower Network tab with ${g.channelLabel} pre-selected.`}
                          onClick={() => handleSourceNetwork(g.channelId)}
                        >
                          Network
                        </button>
                        <button
                          type="button"
                          className="xls-btn xls-btn-danger"
                          disabled={busy || !activeCampaignId}
                          title={`Remove ${g.channelLabel} and delete its captured evidence.`}
                          onClick={() => void handleRemoveSource(g)}
                        >
                          Remove
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {tab === 'network' && (
          <section className="xls-tab-panel xls-network">
            <div className="xls-panel">
              <h3 className="xls-panel-title">EXTRACT FOLLOWER / FOLLOWING NETWORK</h3>
              <div className="xls-network-controls">
                <label className="xls-field">
                  TARGET SOURCE
                  <select
                    className="xls-input"
                    aria-label="Network extraction target source"
                    value={networkTargetId}
                    onChange={(e) => setNetworkTargetId(e.target.value)}
                  >
                    <option value="all">ALL SOURCES</option>
                    {sourceGroups.map((g) => (
                      <option key={g.channelId} value={g.channelId}>
                        {g.channelLabel}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="xls-field">
                  VIEW
                  <select
                    className="xls-input"
                    aria-label="Network view filter"
                    value={networkView}
                    onChange={(e) =>
                      setNetworkView(e.target.value as 'both' | 'followers' | 'following')
                    }
                  >
                    <option value="both">FOLLOWERS + FOLLOWING</option>
                    <option value="followers">FOLLOWERS</option>
                    <option value="following">FOLLOWING</option>
                  </select>
                </label>
              </div>
              <div className="xls-add-source">
                <button
                  type="button"
                  className="xls-btn xls-btn-primary"
                  disabled={networkBusy || !activeCampaignId}
                  title="Open each target's followers page over Tor and extract the visible accounts."
                  onClick={() => void handleExtractNetwork('followers')}
                >
                  {networkBusy ? 'Extracting…' : 'EXTRACT FOLLOWERS'}
                </button>
                <button
                  type="button"
                  className="xls-btn xls-btn-primary"
                  disabled={networkBusy || !activeCampaignId}
                  title="Open each target's following page over Tor and extract the visible accounts."
                  onClick={() => void handleExtractNetwork('following')}
                >
                  {networkBusy ? 'Extracting…' : 'EXTRACT FOLLOWING'}
                </button>
                <button
                  type="button"
                  className="xls-btn"
                  disabled={networkBusy || !activeCampaignId}
                  title="Extract BOTH the followers and following networks for each target over Tor."
                  onClick={() => void handleExtractNetwork('both')}
                >
                  {networkBusy ? 'Extracting…' : 'EXTRACT BOTH'}
                </button>
              </div>
              {networkProgress ? (
                <div className="xls-notice" role="status">
                  {networkProgress}
                </div>
              ) : (
                <div className="xls-empty">
                  Extraction opens each target&apos;s follower/following page over Tor (fail-closed)
                  and records the visible accounts. Capture a timeline first to populate the source
                  list.
                </div>
              )}
            </div>

            <div className="xls-stat-grid">
              <article className="xls-stat">
                <span>SELECTED FOLLOWERS</span>
                <strong>{selectedFollowerCount}</strong>
                <small>
                  {networkTargetKey === null
                    ? 'all targets'
                    : `@${networkTargetKey}`}
                </small>
              </article>
              <article className="xls-stat">
                <span>SELECTED FOLLOWING</span>
                <strong>{selectedFollowingCount}</strong>
                <small>locally observed</small>
              </article>
              <article className="xls-stat">
                <span>COMMON IDENTITIES</span>
                <strong>{analysis.commonIdentityCount}</strong>
                <small>connected to ≥2 targets</small>
              </article>
              <article className="xls-stat">
                <span>HIGH OVERLAP</span>
                <strong>{analysis.highOverlapCount}</strong>
                <small>priority review candidates</small>
              </article>
            </div>

            <div className="xls-panel">
              <div className="xls-panel-title-row">
                <h3 className="xls-panel-title">COMMON FOLLOWERS / FOLLOWING</h3>
                <span className="xls-count">{analysis.pairs.length} pair(s)</span>
              </div>
              {analysis.pairs.length === 0 ? (
                <div className="xls-empty">
                  At least two extracted target networks are required.
                </div>
              ) : (
                <div className="xls-pair-grid">
                  {analysis.pairs.map((p) => (
                    <details className="xls-pair-card" key={`${p.profileAId}:${p.profileBId}`}>
                      <summary>
                        <strong>
                          @{p.profileA} ↔ @{p.profileB}
                        </strong>
                        <span className="xls-count">
                          {p.commonFollowerCount} followers · {p.commonFollowingCount} following ·{' '}
                          {p.commonAnyCount} total
                        </span>
                      </summary>
                      <div className="xls-common-groups">
                        <div>
                          <h4 className="xls-common-heading">COMMON FOLLOWERS</h4>
                          <div className="xls-identity-chips">
                            {(p.commonFollowers ?? []).slice(0, 100).map((u) => (
                              <button
                                type="button"
                                className="xls-identity-chip"
                                key={`cf-${p.profileAId}-${p.profileBId}-${u}`}
                                title="Open this identity's X profile in a Tor-gated in-app window"
                                onClick={() => void handleOpenInX('identity', u)}
                              >
                                @{u}
                              </button>
                            ))}
                            {(p.commonFollowers ?? []).length === 0 && (
                              <span className="xls-count">None observed.</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <h4 className="xls-common-heading">COMMON FOLLOWING</h4>
                          <div className="xls-identity-chips">
                            {(p.commonFollowing ?? []).slice(0, 100).map((u) => (
                              <button
                                type="button"
                                className="xls-identity-chip"
                                key={`cg-${p.profileAId}-${p.profileBId}-${u}`}
                                title="Open this identity's X profile in a Tor-gated in-app window"
                                onClick={() => void handleOpenInX('identity', u)}
                              >
                                @{u}
                              </button>
                            ))}
                            {(p.commonFollowing ?? []).length === 0 && (
                              <span className="xls-count">None observed.</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>

            <div className="xls-panel">
              <div className="xls-panel-title-row">
                <h3 className="xls-panel-title">MULTI-TARGET OVERLAP</h3>
                <span className="xls-count">{overlapIdentities.length} identity(ies)</span>
              </div>
              <label className="xls-field xls-min-targets">
                MINIMUM CONNECTED TARGETS
                <input
                  type="number"
                  className="xls-input"
                  aria-label="Minimum connected targets"
                  min={2}
                  max={Math.max(2, analysis.targetCount)}
                  value={networkMinTargets}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setNetworkMinTargets(Number.isFinite(n) ? Math.max(2, Math.floor(n)) : 2);
                  }}
                />
              </label>
              {overlapIdentities.length === 0 ? (
                <div className="xls-empty">No identities meet this overlap threshold.</div>
              ) : (
                <div className="xls-overlap-table">
                  {overlapIdentities.map((i) => (
                    <div className="xls-overlap-row" key={i.username}>
                      <button
                        type="button"
                        className="xls-identity-main"
                        title="Open this identity's X profile in a Tor-gated in-app window"
                        onClick={() => void handleOpenInX('identity', i.username)}
                      >
                        @{i.username}
                      </button>
                      <span className="xls-count">
                        {i.connectedTargets}/{analysis.targetCount} targets
                      </span>
                      <strong className="xls-overlap-score">{i.overlapScore}</strong>
                      <span className="xls-overlap-connections">
                        <em>follows:</em>{' '}
                        {(i.followerOf ?? []).length
                          ? (i.followerOf ?? []).map((x) => (
                              <span className="xls-inline-identity" key={`follows-${i.username}-${x}`}>
                                @{x}
                              </span>
                            ))
                          : '—'}
                      </span>
                      <span className="xls-overlap-connections">
                        <em>followed by targets:</em>{' '}
                        {(i.followingFrom ?? []).length
                          ? (i.followingFrom ?? []).map((x) => (
                              <span className="xls-inline-identity" key={`followed-${i.username}-${x}`}>
                                @{x}
                              </span>
                            ))
                          : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="xls-panel">
              <div className="xls-panel-title-row">
                <h3 className="xls-panel-title">COMMON NETWORK MIND MAP</h3>
                <span className="xls-count">
                  {analysis.graph?.nodes?.length ?? 0} nodes · {analysis.graph?.edges?.length ?? 0}{' '}
                  edges
                </span>
              </div>
              <NetworkGraph
                graph={analysis.graph ?? { nodes: [], edges: [] }}
                onOpenIdentity={(u) => void handleOpenInX('identity', u)}
              />
            </div>

            <div className="xls-panel">
              <div className="xls-panel-title-row">
                <h3 className="xls-panel-title">RECENT NETWORK DELTAS</h3>
                <span className="xls-count">{recentNetworkDeltas.length} delta(s)</span>
              </div>
              <p className="xls-help">
                &ldquo;Not seen in latest scan&rdquo; is a review candidate, not proof of an
                unfollow. X can truncate or reorder lists, so a missing account may simply not have
                loaded this pass.
              </p>
              {recentNetworkDeltas.length === 0 ? (
                <div className="xls-empty">No network deltas recorded yet.</div>
              ) : (
                <ul className="xls-source-list">
                  {recentNetworkDeltas.map((d, i) => (
                    <li
                      className="xls-source-row xls-delta-row"
                      key={`${d.account.target}:${d.account.kind}:${d.account.handle}:${i}`}
                    >
                      <span>
                        <button
                          type="button"
                          className="xls-identity-main"
                          title="Open this identity's X profile in a Tor-gated in-app window"
                          onClick={() => void handleOpenInX('identity', d.account.handle)}
                        >
                          @{d.account.handle.replace(/^@+/, '')}
                        </button>
                        <span
                          className={`xls-marker ${
                            d.newlyObserved ? 'xls-marker-new' : 'xls-marker-unavailable'
                          }`}
                        >
                          {d.newlyObserved ? 'NEWLY OBSERVED' : 'NOT SEEN IN LATEST COMPARABLE SCAN'}
                        </span>{' '}
                        {d.account.kind.toUpperCase()} of @{d.account.target.replace(/^@+/, '')}
                      </span>
                      <span className="xls-count">{formatWhen(d.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="xls-panel">
              <div className="xls-panel-title-row">
                <h3 className="xls-panel-title">EXTRACTED NETWORK RECORDS</h3>
                <span className="xls-count">{networkRecordRows.length} record(s)</span>
              </div>
              <div className="xls-add-source">
                <button
                  type="button"
                  className="xls-btn xls-btn-primary"
                  disabled={exportBusy || !activeCampaignId}
                  title="Export the captured follower/following accounts as formula-guarded CSV (synthetic excluded, SHA-256 sidecar)."
                  onClick={() => void handleExportNetwork()}
                >
                  EXPORT CSV
                </button>
              </div>
              {networkRecordRows.length === 0 ? (
                <div className="xls-empty">No network records match this source / view.</div>
              ) : (
                <div className="xls-network-records">
                  {networkRecordRows.map((r, i) => (
                    <article
                      className="xls-network-record"
                      key={`${r.target}:${r.kind}:${r.handle}:${i}`}
                    >
                      <div className="xls-network-record-avatar" aria-hidden="true">
                        {r.avatar && r.avatar.startsWith('data:') ? (
                          <img src={r.avatar} alt="" />
                        ) : (
                          <span>{(r.handle || '?').charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="xls-network-record-id">
                        <strong>{r.displayName || `@${r.handle.replace(/^@+/, '')}`}</strong>
                        <span>@{r.handle.replace(/^@+/, '')}</span>
                        {r.bio && <small>{r.bio}</small>}
                      </div>
                      <span className={`xls-marker xls-relationship-tag xls-relationship-${r.kind}`}>
                        {r.kind === 'followers' ? 'FOLLOWER' : 'FOLLOWING'}
                      </span>
                      <span className="xls-count xls-observed">
                        first {formatWhen(r.firstObservedAt)}
                        <br />
                        last {formatWhen(r.lastObservedAt)}
                      </span>
                      <button
                        type="button"
                        className="xls-btn"
                        title="Open this account's X profile in a Tor-gated in-app window"
                        onClick={() => void handleOpenInX('profile', r.handle)}
                      >
                        OPEN PROFILE
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {tab === 'entities' && (
          <section className="xls-tab-panel xls-entities">
            <div className="xls-network-controls">
              <label className="xls-field">
                TYPE
                <select
                  className="xls-input"
                  value={entityTypeFilter}
                  onChange={(e) => setEntityTypeFilter(e.target.value)}
                >
                  <option value="all">ALL TYPES</option>
                  {entityTypes.map((t) => (
                    <option key={t} value={t}>
                      {t.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <span className="xls-count">{filteredEntities.length} entities</span>
            </div>
            {filteredEntities.length === 0 ? (
              <div className="xls-empty">No extracted entities match.</div>
            ) : (
              <ul className="xls-source-list">
                {filteredEntities.map((e) => (
                  <li className="xls-source-row" key={e.id}>
                    <span>{e.value}</span>
                    <span className="xls-count">
                      {e.type.toUpperCase()} · {e.count} findings
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'changes' && (
          <section className="xls-tab-panel xls-changes">
            <div className="xls-changes-grid">
              <div className="xls-panel">
                <h3 className="xls-panel-title">HISTORICAL CHANGE EVENTS</h3>
                <span className="xls-count">{changeEvents.length} change event(s)</span>
                {changeEvents.length === 0 ? (
                  <div className="xls-empty">
                    No post edits or profile-metadata changes observed in this campaign yet.
                  </div>
                ) : (
                  <ul className="xls-source-list">
                    {changeEvents.map((ev) => (
                      <li className="xls-source-row" key={ev.id}>
                        <span>
                          <span className={`xls-marker xls-marker-${ev.kind}`}>
                            {ev.kind.replace(/_/g, ' ').toUpperCase()}
                          </span>{' '}
                          {ev.summary}
                          {ev.sourceUsername && (
                            <span className="xls-event-source">
                              {' '}
                              @{ev.sourceUsername.replace(/^@/, '')}
                            </span>
                          )}
                        </span>
                        <span className="xls-count">{formatWhen(ev.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="xls-panel">
                <h3 className="xls-panel-title">COLLECTION RUN LOG</h3>
                <span className="xls-count">{runLog.length} collection run(s)</span>
                {runLog.length === 0 ? (
                  <div className="xls-empty">
                    No collection runs recorded in this campaign yet. Run a sweep or archive cycle
                    to populate the log.
                  </div>
                ) : (
                  <ul className="xls-source-list">
                    {runLog.map((run, i) => {
                      const statusLabel =
                        run.status === 'error'
                          ? 'ERROR'
                          : (run.stopReason || run.status || 'complete').toUpperCase();
                      return (
                        <li
                          className="xls-source-row"
                          key={`${run.profileId}:${run.operation}:${run.startedAt}:${i}`}
                        >
                          <span>
                            <span className={`xls-marker xls-marker-run-${run.status}`}>
                              @{run.username.replace(/^@/, '')} ·{' '}
                              {run.operation.replace(/_/g, ' ').toUpperCase()}
                            </span>{' '}
                            {run.observed} observed / {run.added} new / {run.duplicates} duplicate ·{' '}
                            {run.completedPasses}/{run.requestedPasses || '—'} passes · {statusLabel}
                          </span>
                          <span className="xls-count">{formatWhen(run.startedAt)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            <div className="xls-network-controls">
              <span className="xls-count">{sortedNetworkChanges.length} observed accounts</span>
            </div>
            {sortedNetworkChanges.length === 0 ? (
              <div className="xls-empty">
                No follower/following accounts captured in this campaign yet.
              </div>
            ) : (
              <ul className="xls-source-list">
                {sortedNetworkChanges.map((acct, i) => {
                  const isNew =
                    !!acct.firstObservedAt && acct.firstObservedAt === acct.lastObservedAt;
                  return (
                    <li className="xls-source-row" key={`${acct.target}:${acct.kind}:${acct.handle}:${i}`}>
                      <span>
                        {acct.handle} · {acct.kind.toUpperCase()} of @{acct.target.replace(/^@/, '')}
                        {isNew && <span className="xls-marker xls-marker-new"> NEW</span>}
                      </span>
                      <span className="xls-count">
                        first seen {formatWhen(acct.firstObservedAt)} · last seen{' '}
                        {formatWhen(acct.lastObservedAt)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {tab === 'search' && (
          <section className="xls-tab-panel xls-search">
            <div className="xls-add-source">
              <input
                className="xls-input xls-search-query"
                aria-label="Search captured posts"
                placeholder="Search captured post text or @handle… (comma-separate for a multi-keyword preset)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <span className="xls-count">{searchResults.length} match(es)</span>
            </div>
            <div className="xls-feed">
              {searchQuery.trim() === '' ? (
                <div className="xls-empty">Type to search locally over this campaign's captured posts.</div>
              ) : searchResults.length === 0 ? (
                <div className="xls-empty">No captured post matches "{searchQuery}".</div>
              ) : (
                searchResults.map(renderPost)
              )}
            </div>

            <div className="xls-panel">
              <h3 className="xls-panel-title">SAVE AS A HIGHLIGHT PRESET</h3>
              <div className="xls-add-source">
                <input
                  className="xls-input xls-preset-name"
                  aria-label="Preset name"
                  placeholder="Preset name…"
                  value={presetNameDraft}
                  onChange={(e) => setPresetNameDraft(e.target.value)}
                />
                <button
                  className="xls-btn xls-btn-primary"
                  onClick={() => void handleSavePreset()}
                  disabled={presetsBusy || !activeCampaignId}
                >
                  Save Preset
                </button>
              </div>
            </div>

            <div className="xls-panel">
              <h3 className="xls-panel-title">SAVED PRESETS</h3>
              {presets.length === 0 ? (
                <div className="xls-empty">No highlight presets saved in this campaign yet.</div>
              ) : (
                <ul className="xls-source-list">
                  {presets.map((p) => (
                    <li className="xls-source-row" key={p.id}>
                      <span>
                        <strong>{p.name}</strong> — {p.keywords.join(', ')}
                      </span>
                      <span className="xls-source-actions">
                        <button className="xls-btn" onClick={() => void handleRunPreset(p)} disabled={presetsBusy}>
                          Run
                        </button>
                        <button
                          className="xls-btn xls-btn-danger"
                          onClick={() => void handleRemovePreset(p)}
                          disabled={presetsBusy}
                        >
                          Remove
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {tab === 'notes' && (
          <section className="xls-tab-panel xls-notes">
            <div className="xls-panel">
              <h3 className="xls-panel-title">ATTACH A NOTE TO A CAPTURED POST</h3>
              <div className="xls-add-source">
                <select
                  className="xls-input"
                  aria-label="Post to attach a note to"
                  value={noteDraftFindingId}
                  onChange={(e) => setNoteDraftFindingId(e.target.value)}
                >
                  <option value="">Select a captured post…</option>
                  {posts.map((p) => (
                    <option key={p.id} value={p.id}>
                      @{p.authorHandle} · {p.text.slice(0, 60)}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                className="xls-input xls-note-text"
                aria-label="Note text"
                placeholder="Analyst note…"
                value={noteDraftText}
                onChange={(e) => setNoteDraftText(e.target.value)}
              />
              <button
                className="xls-btn xls-btn-primary"
                onClick={() => void handleSaveNote()}
                disabled={notesBusy || !noteDraftFindingId}
              >
                {notesBusy ? 'Saving…' : 'Save Note'}
              </button>
            </div>
            <div className="xls-panel">
              <h3 className="xls-panel-title">SAVED NOTES</h3>
              {notes.length === 0 ? (
                <div className="xls-empty">No analyst notes saved in this campaign yet.</div>
              ) : (
                <ul className="xls-source-list">
                  {notes.map((n) => {
                    const post = posts.find((p) => p.id === n.findingId);
                    return (
                      <li className="xls-source-row" key={n.findingId}>
                        <span>
                          <strong>{post ? `@${post.authorHandle}` : n.findingId}</strong> —{' '}
                          {n.text}
                        </span>
                        <span className="xls-source-actions">
                          <span className="xls-count">{formatWhen(n.savedAt)}</span>
                          <button
                            className="xls-btn xls-btn-danger"
                            onClick={() => void handleRemoveNote(n.findingId)}
                            disabled={notesBusy}
                          >
                            Remove
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        )}

        {tab === 'exports' && (
          <section className="xls-tab-panel xls-exports">
            <div className="xls-panel">
              <h3 className="xls-panel-title">EXPORT CAPTURED POSTS</h3>
              <p className="xls-help">
                Choose a destination in a native save dialog — demo/synthetic posts are always
                excluded, and a SHA-256 checksum sidecar is written alongside the export.
              </p>
              <div className="xls-dock-row">
                <button
                  className="xls-btn xls-btn-primary"
                  onClick={() => void handleExportPosts('json')}
                  disabled={exportBusy || !activeCampaignId}
                >
                  Export JSON…
                </button>
                <button
                  className="xls-btn xls-btn-primary"
                  onClick={() => void handleExportPosts('csv')}
                  disabled={exportBusy || !activeCampaignId}
                >
                  Export CSV…
                </button>
                <button
                  className="xls-btn xls-btn-primary"
                  onClick={() => void handleExportPosts('pdf')}
                  disabled={exportBusy || !activeCampaignId}
                >
                  Export PDF…
                </button>
              </div>
            </div>
            <div className="xls-panel">
              <h3 className="xls-panel-title">EXPORT CAPTURED NETWORKS</h3>
              <p className="xls-help">
                Follower/following accounts as formula-guarded CSV — demo/synthetic accounts
                excluded.
              </p>
              <button
                className="xls-btn xls-btn-primary"
                onClick={() => void handleExportNetwork()}
                disabled={exportBusy || !activeCampaignId}
              >
                Export Network CSV…
              </button>
            </div>
          </section>
        )}

        {tab === 'campaigns' && (
          <section className="xls-tab-panel xls-campaigns">
            <div className="xls-panel-title-row">
              <h3 className="xls-panel-title">ALL CAMPAIGNS</h3>
              <button
                className="xls-btn xls-btn-primary"
                onClick={() => void handleNewCampaign()}
                disabled={campaignBusy}
              >
                New Campaign
              </button>
            </div>
            {campaigns.length === 0 ? (
              <div className="xls-empty">No campaigns yet — create one to start collecting.</div>
            ) : (
              <ul className="xls-source-list">
                {campaigns.map((c) => (
                  <li className="xls-source-row" key={c.id}>
                    <span>
                      {c.name}
                      {c.id === activeCampaignId && <span className="xls-marker xls-marker-active"> ACTIVE</span>}
                    </span>
                    <span className="xls-source-actions">
                      <button
                        className="xls-btn"
                        onClick={() => void handleSwitchCampaign(c.id)}
                        disabled={campaignBusy || c.id === activeCampaignId}
                      >
                        Switch
                      </button>
                      <button
                        className="xls-btn xls-btn-danger"
                        onClick={() => void handleDeleteCampaign(c)}
                        disabled={campaignBusy}
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'system' && (
          <section className="xls-tab-panel xls-system">
            <div className="xls-panel xls-collection-settings">
              <div className="xls-panel-title-row">
                <h3 className="xls-panel-title">COLLECTION SETTINGS</h3>
                <button
                  type="button"
                  className="xls-btn xls-btn-primary"
                  onClick={() => void handleSaveCollectionSettings()}
                  disabled={collectionSettingsBusy || !activeCampaignId}
                >
                  {collectionSettingsBusy ? 'Saving…' : 'Save Settings'}
                </button>
              </div>
              <p className="xls-help">
                Per-campaign collection knobs. A target's own top-level posts are always captured;
                these govern the surrounding thread, scroll budgets and the incremental archive.
                Every number is re-clamped MAIN-side on save — this form can only offer values inside
                the allowed band.
              </p>

              <div className="xls-settings-group">
                <h4 className="xls-settings-group-title">AUTOMATIC SWEEPS</h4>
                <label className="xls-check">
                  <input
                    type="checkbox"
                    checked={collectionSettings.automaticSweeps === true}
                    disabled={!activeCampaignId}
                    onChange={(e) => setCollectionBool('automaticSweeps', e.target.checked)}
                  />
                  Enable automatic sweeps on the interval below
                </label>
                <p className="xls-help">
                  The sweep timer runs at a fixed cadence, but each sweep&apos;s capture still routes
                  the Tor gate. Tor mode fails closed (no capture, no silent clearnet) unless you have
                  enabled the clearnet toggle with its real-IP acknowledgement.
                </p>
              </div>

              <div className="xls-settings-group">
                <h4 className="xls-settings-group-title">RECORD TYPES</h4>
                {([
                  ['collectReplies', 'Capture replies'],
                  ['collectReposts', 'Capture reposts'],
                  ['collectComments', 'Capture third-party comments'],
                  ['retrieveImages', 'Retrieve + archive images'],
                ] as ReadonlyArray<readonly [keyof XCollectionSettings, string]>).map(([key, label]) => (
                  <label className="xls-check" key={key}>
                    <input
                      type="checkbox"
                      checked={collectionSettings[key] === true}
                      disabled={!activeCampaignId}
                      onChange={(e) => setCollectionBool(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
                <div className="xls-settings-grid">
                  {([
                    ['commentThreadsPerSource', 'Comment threads / source'],
                    ['commentScrollPasses', 'Comment scroll passes'],
                  ] as ReadonlyArray<readonly [CollectionSettingNumericField, string]>).map(
                    ([key, label]) => (
                      <label className="xls-field" key={key}>
                        {label} ({COLLECTION_SETTINGS_RANGES[key].min}–{COLLECTION_SETTINGS_RANGES[key].max})
                        <input
                          type="number"
                          className="xls-input"
                          min={COLLECTION_SETTINGS_RANGES[key].min}
                          max={COLLECTION_SETTINGS_RANGES[key].max}
                          value={collectionSettings[key]}
                          disabled={!activeCampaignId}
                          onChange={(e) => setCollectionNumber(key, e.target.value)}
                        />
                      </label>
                    ),
                  )}
                </div>
              </div>

              <div className="xls-settings-group">
                <h4 className="xls-settings-group-title">TIMING &amp; HEALTH</h4>
                <div className="xls-settings-grid">
                  {([
                    ['sweepIntervalMinutes', 'Sweep interval (min)'],
                    ['profileScrollPasses', 'Profile scroll passes'],
                    ['followerBasePasses', 'Follower base passes'],
                    ['followingBasePasses', 'Following base passes'],
                    ['networkStagnationLimit', 'Network stagnation limit'],
                    ['networkSnapshotsRetained', 'Network snapshots kept'],
                    ['delayPerPassMs', 'Delay / pass (ms)'],
                    ['retentionLimit', 'Retention limit'],
                  ] as ReadonlyArray<readonly [CollectionSettingNumericField, string]>).map(
                    ([key, label]) => (
                      <label className="xls-field" key={key}>
                        {label} ({COLLECTION_SETTINGS_RANGES[key].min}–{COLLECTION_SETTINGS_RANGES[key].max})
                        <input
                          type="number"
                          className="xls-input"
                          min={COLLECTION_SETTINGS_RANGES[key].min}
                          max={COLLECTION_SETTINGS_RANGES[key].max}
                          value={collectionSettings[key]}
                          disabled={!activeCampaignId}
                          onChange={(e) => setCollectionNumber(key, e.target.value)}
                        />
                      </label>
                    ),
                  )}
                </div>
              </div>

              <div className="xls-settings-group">
                <h4 className="xls-settings-group-title">INCREMENTAL ARCHIVE</h4>
                <label className="xls-check">
                  <input
                    type="checkbox"
                    checked={collectionSettings.archiveEnabled === true}
                    disabled={!activeCampaignId}
                    onChange={(e) => setCollectionBool('archiveEnabled', e.target.checked)}
                  />
                  Enable the incremental archive
                </label>
                {([
                  ['archiveFollowers', 'Archive followers'],
                  ['archiveFollowing', 'Archive following'],
                ] as ReadonlyArray<readonly [keyof XCollectionSettings, string]>).map(([key, label]) => (
                  <label className="xls-check" key={key}>
                    <input
                      type="checkbox"
                      checked={collectionSettings[key] === true}
                      disabled={!activeCampaignId}
                      onChange={(e) => setCollectionBool(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
                <div className="xls-settings-grid">
                  {([
                    ['archiveIntervalMinutes', 'Archive interval (min)'],
                    ['postDepthPerCycle', 'Post depth / cycle'],
                    ['maxPostDepth', 'Max post depth'],
                    ['networkDepthPerCycle', 'Network depth / cycle'],
                    ['maxNetworkDepth', 'Max network depth'],
                  ] as ReadonlyArray<readonly [CollectionSettingNumericField, string]>).map(
                    ([key, label]) => (
                      <label className="xls-field" key={key}>
                        {label} ({COLLECTION_SETTINGS_RANGES[key].min}–{COLLECTION_SETTINGS_RANGES[key].max})
                        <input
                          type="number"
                          className="xls-input"
                          min={COLLECTION_SETTINGS_RANGES[key].min}
                          max={COLLECTION_SETTINGS_RANGES[key].max}
                          value={collectionSettings[key]}
                          disabled={!activeCampaignId}
                          onChange={(e) => setCollectionNumber(key, e.target.value)}
                        />
                      </label>
                    ),
                  )}
                </div>
              </div>

              <div className="xls-settings">
                <button
                  type="button"
                  className="xls-btn xls-btn-primary"
                  onClick={() => void handleSaveCollectionSettings()}
                  disabled={collectionSettingsBusy || !activeCampaignId}
                >
                  {collectionSettingsBusy ? 'Saving…' : 'Save Settings'}
                </button>
              </div>
            </div>

            <div className="xls-panel">
              <h3 className="xls-panel-title">HISTORICAL ARCHIVE</h3>
              <label className="xls-check">
                <input
                  type="checkbox"
                  checked={xListeningSettings?.archiveCycles === true}
                  onChange={(e) => void handleToggleArchiveCycles(e.target.checked)}
                  disabled={!xListeningSettings}
                />
                Enable low-rate archive cycles
              </label>
              <p className="xls-help">
                Cursor: {archiveState.cursor ?? '—'} · Cycles: {archiveState.cycles} · Last run:{' '}
                {archiveState.lastRunAt ? formatWhen(archiveState.lastRunAt) : 'never'}
              </p>
              <button
                className="xls-btn xls-btn-primary"
                onClick={() => void handleRunArchive()}
                disabled={archiveBusy || !activeCampaignId}
              >
                {archiveBusy ? 'Running…' : 'Run Archive Step'}
              </button>
            </div>

            <div className="xls-panel">
              <h3 className="xls-panel-title">DEMO DATA</h3>
              <p className="xls-help">
                Loads deterministic seeded posts and network rows, all stamped synthetic —
                excluded from analysis, entities, exports and evidence hashing.
              </p>
              <button
                className="xls-btn"
                onClick={() => void handleLoadDemoData()}
                disabled={demoBusy || !activeCampaignId}
              >
                {demoBusy ? 'Loading…' : 'Load Demo Data'}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
