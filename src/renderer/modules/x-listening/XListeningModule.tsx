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
import { useSettings } from '../../state/store';
import { confirmDialog, promptDialog } from '../../state/dialogs';
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
}

export interface XAnalysisIdentity {
  username: string;
  connectedTargets: number;
  overlapScore: number;
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
  const [liveKindFilter, setLiveKindFilter] = useState<'all' | XPostRow['kind']>('all');
  const [entityTypeFilter, setEntityTypeFilter] = useState('all');

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
      const key = p.channelId || p.authorHandle;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        if (p.publishedAt > existing.lastPublishedAt) existing.lastPublishedAt = p.publishedAt;
      } else {
        map.set(key, {
          channelId: key,
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

  const handleToggleCollect = useCallback(
    async (key: 'replies' | 'reposts' | 'comments', next: boolean) => {
      const x = xListeningSettings;
      if (!x) return;
      await patchSettings({ xListening: { ...x, collect: { ...x.collect, [key]: next } } });
    },
    [xListeningSettings, patchSettings],
  );

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
              <ul className="xls-source-list">
                {sourceGroups.map((g) => (
                  <li className="xls-source-row" key={g.channelId}>
                    <span className="xls-source-name">{g.channelLabel}</span>
                    <span className="xls-count">
                      {g.count} captured · last {formatWhen(g.lastPublishedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'network' && (
          <section className="xls-tab-panel xls-network">
            <div className="xls-stat-grid">
              <article className="xls-stat">
                <span>TARGETS</span>
                <strong>{analysis.targetCount}</strong>
              </article>
              <article className="xls-stat">
                <span>RELATIONSHIPS</span>
                <strong>{analysis.relationshipCount}</strong>
              </article>
              <article className="xls-stat">
                <span>UNIQUE IDENTITIES</span>
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
            </div>

            <div className="xls-panel">
              <h3 className="xls-panel-title">COMMON FOLLOWER / FOLLOWING PAIRS</h3>
              {analysis.pairs.length === 0 ? (
                <div className="xls-empty">
                  At least two captured target networks are required.
                </div>
              ) : (
                <ul className="xls-source-list">
                  {analysis.pairs.map((p) => (
                    <li className="xls-source-row" key={`${p.profileAId}:${p.profileBId}`}>
                      <span>
                        @{p.profileA} ↔ @{p.profileB}
                      </span>
                      <span className="xls-count">
                        {p.commonFollowerCount} followers · {p.commonFollowingCount} following ·{' '}
                        {p.commonAnyCount} total
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="xls-panel">
              <h3 className="xls-panel-title">MULTI-TARGET OVERLAP</h3>
              {analysis.identities.length === 0 ? (
                <div className="xls-empty">No identities meet the overlap threshold.</div>
              ) : (
                <ul className="xls-source-list">
                  {analysis.identities.map((i) => (
                    <li className="xls-source-row" key={i.username}>
                      <span>@{i.username}</span>
                      <span className="xls-count">
                        {i.connectedTargets}/{analysis.targetCount} targets · score{' '}
                        {i.overlapScore}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="xls-panel">
              <div className="xls-panel-title-row">
                <h3 className="xls-panel-title">RELATIONSHIP GRAPH</h3>
                <span className="xls-count">
                  {analysis.graph.nodes.length} nodes · {analysis.graph.edges.length} edges
                </span>
              </div>
              {analysis.graph.edges.length === 0 ? (
                <div className="xls-empty">
                  No relationship edges yet — capture follower/following data to populate this
                  graph.
                </div>
              ) : (
                <ul className="xls-source-list">
                  {analysis.graph.edges.map((edge) => (
                    <li className="xls-source-row" key={edge.id}>
                      <span>
                        {edge.source} → {edge.target}
                      </span>
                      <span className="xls-count">{edge.relationship.toUpperCase()}</span>
                    </li>
                  ))}
                </ul>
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
                  No collection runs recorded in this campaign yet. Run a sweep or archive cycle to
                  populate the log.
                </div>
              ) : (
                <ul className="xls-source-list">
                  {runLog.map((run, i) => (
                    <li className="xls-source-row" key={`${run.profileId}:${run.operation}:${run.startedAt}:${i}`}>
                      <span>
                        <span className={`xls-marker xls-marker-run-${run.status}`}>
                          {run.operation.replace(/_/g, ' ').toUpperCase()}
                        </span>{' '}
                        @{run.username.replace(/^@/, '')} · {run.added} added / {run.observed} observed ·{' '}
                        {run.duplicates} dup · {run.status.toUpperCase()}
                      </span>
                      <span className="xls-count">{formatWhen(run.startedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
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
            <div className="xls-panel">
              <h3 className="xls-panel-title">SURROUNDING-THREAD COLLECTION</h3>
              <p className="xls-help">
                A target's own top-level posts are always captured. These extend collection to
                the surrounding thread — read MAIN-side, never widened by this UI alone.
              </p>
              {(['replies', 'reposts', 'comments'] as const).map((key) => (
                <label className="xls-check" key={key}>
                  <input
                    type="checkbox"
                    checked={xListeningSettings?.collect?.[key] === true}
                    onChange={(e) => void handleToggleCollect(key, e.target.checked)}
                    disabled={!xListeningSettings}
                  />
                  Capture {key}
                </label>
              ))}
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
