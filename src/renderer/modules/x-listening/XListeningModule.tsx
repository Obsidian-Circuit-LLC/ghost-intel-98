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
import type { XScheduleStatus } from '@shared/x-listening-schedule';
import { useSettings } from '../../state/store';
import { confirmDialog } from '../../state/dialogs';
import { NetworkGraph } from './NetworkGraph';
import { PostCard } from './PostCard';
import { CampaignEditorDialog, type CampaignEditorValue } from './CampaignEditorDialog';
import { ModuleBanner } from '../../components/ModuleBanner';
import xlsBanner from '../../assets/x-listening-banner.jpg';
import xlsBannerBlur from '../../assets/x-listening-banner-blur.jpg';
import './x-listening.css';

/** Accept a bare handle, `@handle`, or a full x.com / twitter.com profile URL and return the bare
 *  username. The capture channel wants a username, not a URL — GhostExodus pasted a full profile URL
 *  ("https://x.com/ExodusGhost") into the target field, which must resolve to "ExodusGhost". */
export function extractXUsername(input: string): string {
  const s = String(input ?? '').trim();
  const m = s.match(/(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})/i);
  if (m) return m[1];
  return s.replace(/^@+/, '').trim();
}

/** Per-campaign editor meta (purpose/description) — the renderer mirror of main-side `campaign-meta.ts`. */
export interface XCampaignMeta {
  purpose: string;
  description: string;
}
const EMPTY_CAMPAIGN_META: XCampaignMeta = { purpose: '', description: '' };

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

/** Enterprise v3.4.1 nav labels (J2 reskin) — the sidebar reads GhostExodus's console wording
 *  ("COMMAND BOARD", "LIVE FEED", "FOLLOWER NETWORK", …) while the underlying tab id (used by the
 *  data-tab hook the tab-switch tests key on) stays the stable GI98 XTab. The topbar title reuses
 *  the same label. */
const XLS_NAV_LABEL: Record<XTab, string> = {
  dashboard: 'COMMAND BOARD',
  live: 'LIVE FEED',
  sources: 'TARGET SOURCES',
  network: 'FOLLOWER NETWORK',
  entities: 'ENTITY INDEX',
  changes: 'CHANGE INTEL',
  search: 'SEARCH',
  notes: 'ANALYST NOTES',
  exports: 'EXPORTS',
  campaigns: 'CAMPAIGNS',
  system: 'SYSTEM',
};

export interface XPostMetricsView {
  replies: number;
  reposts: number;
  likes: number;
  views: number;
}

/** RAW platform-rendered metric strings ("1.2K", "3,401") as captured, kept alongside the parsed
 *  integers so the PostCard can show the exact platform label without fabricating precision
 *  (store.ts `XPostMetricsRaw`; the boundary widens it to this renderer-owned view). */
export interface XPostMetricsRawView {
  replies?: string;
  reposts?: string;
  likes?: string;
  views?: string;
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
  /** RAW captured metric strings (Task I1 — shown verbatim on the card where present). */
  metricsRaw?: XPostMetricsRawView;
  evidenceHash?: string;
  synthetic?: boolean;
  /** LOCAL secure-fs refs (media.ts `cacheRemoteMedia`, Task 15) — never a remote URL. Resolved
   *  to a displayable `data:` URI on demand via `mediaRead`. */
  mediaRefs?: string[];
  /** LOCAL avatar `data:` URI or absent (a remote avatar URL is never stored) — Task I1 card. */
  avatar?: string;
  /** The post author's display name, when the capture observed one (Task I1 card). */
  displayName?: string;
  /** The monitored source through which this post was observed, when it differs from the author
   *  ("VIA @source"). Falls back to `channelId` on the card when absent (Task I1). */
  sourceUsername?: string;
  /** Provenance bookkeeping (Task I1 card). Fall back to `publishedAt` when the boundary omits them. */
  firstObservedAt?: string;
  lastObservedAt?: string;
  /** ISO time the record was harvested (HarvestedItem) — the card's LAST-observed fallback. */
  harvestedAt?: string;
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
  // Enterprise COLLECTION HEALTH columns (enterprise.cjs:221-224) — computed main-side +
  // carried over IPC; optional so a partial/legacy payload never crashes the row.
  postCount?: number;
  followerCount?: number;
  followingCount?: number;
  oldestPostAt?: string | null;
}

export interface XEntityRow {
  id: string;
  type: string;
  value: string;
  count: number;
  // Task: ENTITY INDEX display pics. `normalizedValue` is the canonical handle for a MENTION entity
  // (drives the card avatar + OPEN X PROFILE); `sourceUsernames` are the finding sources (each a
  // small avatar chip). Present at runtime on the `entities` rollup (store.ts XEntityCacheEntry);
  // optional here so a legacy/partial payload never crashes the card.
  normalizedValue?: string;
  sourceUsernames?: string[];
  firstObservedAt?: string;
  lastObservedAt?: string;
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
  /** Case-sensitive matching (default false). Restored with the full editor (audit HIGH #9). */
  caseSensitive: boolean;
  /** Per-source scope — when non-empty, only posts from these `channelId`s are matched (audit HIGH #9). */
  profileIds: string[];
  enabled?: boolean;
  updatedAt: string;
}

/** One preset RUN match returned by `presetsRun` — the post and the keywords that matched it. */
export interface XPresetMatchView {
  postId: string;
  matchedKeywords: string[];
}

// Post kind labels + compact metric formatting now live in the extracted PostCard (Task I1); the
// module keeps only `formatWhen`, still used by the network / changes / sources / notes tabs.
function formatWhen(iso: string | undefined): string {
  if (!iso) return 'Unknown time';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const CLEARNET_WARNING_TEXT =
  'Routing X capture over CLEARNET exposes your real IP directly to X instead of Tor. ' +
  'This is remembered — you will not be asked again unless you clear it in Settings. Enable clearnet?';

export function XListeningModule({ caseId }: { caseId?: string }): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const patchSettings = useSettings((s) => s.patch);

  const [campaigns, setCampaigns] = useState<XCampaign[]>([]);
  const [activeCampaignId, setActiveCampaignId] = useState('');
  const [campaignBusy, setCampaignBusy] = useState(false);
  // J1: per-campaign editor meta (purpose/description), loaded alongside the campaign list; drives
  // the CAMPAIGN cards + prefills the EDIT modal. Absent/failed reads degrade to empty (honest blank).
  const [campaignMeta, setCampaignMeta] = useState<Record<string, XCampaignMeta>>({});
  // J1: the campaign editor modal — null when closed; `target` is the campaign being edited.
  const [campaignEditor, setCampaignEditor] = useState<{ mode: 'create' | 'edit'; target?: XCampaign } | null>(null);

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
  // Campaign-wide avatar lookup (canonical handle → LOCAL data: URI) from the cache-only `avatars`
  // channel — the ENTITY INDEX resolves each mention/source handle to a localized avatar through it,
  // never a remote URL. A miss leaves the handle absent → monogram fallback.
  const [avatars, setAvatars] = useState<Record<string, string>>({});
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
  // G1: the main-side automatic-sweep/archive SCHEDULE status (armed cadence + next-fire times) —
  // drives the next-sweep indicator + one-click Pause. Polled from the scheduler registry.
  const [schedule, setSchedule] = useState<XScheduleStatus | null>(null);
  // F1: per-profile image-collection policy — the `{ canonicalSourceKey → mode }` override map + the
  // campaign-wide `retrieveImages` toggle, so each Sources card shows + drives its own Images control.
  const [imagePolicy, setImagePolicy] =
    useState<{ modes: Record<string, XImageMode>; retrieveImages: boolean }>({ modes: {}, retrieveImages: true });
  const [presets, setPresets] = useState<XPresetRow[]>([]);
  const [presetNameDraft, setPresetNameDraft] = useState('');
  const [presetsBusy, setPresetsBusy] = useState(false);
  // Audit HIGH #9 — the full preset editor draft (mode / case / per-source scope / keyword textarea).
  const [presetKeywordsDraft, setPresetKeywordsDraft] = useState('');
  const [presetModeDraft, setPresetModeDraft] = useState<'any' | 'all'>('any');
  const [presetCaseDraft, setPresetCaseDraft] = useState(false);
  const [presetProfilesDraft, setPresetProfilesDraft] = useState<string[]>([]);
  // Non-null while EDITing an existing preset (upsert its id) rather than creating a new one.
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  // Audit HIGH #8 — the last preset RUN result (derived-on-read; drives the MATCH display).
  const [presetRun, setPresetRun] = useState<{ name: string; matches: XPresetMatchView[] } | null>(null);

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
      // J1: editor meta rides alongside the list. A typeof guard tolerates an older preload / a test
      // mock without the channel (yields no meta, every card falls back to an honest blank) while
      // still making the literal `campaignsMeta(...)` call the whole-module-seam invariant checks for.
      try {
        if (typeof window.api.xListening.campaignsMeta === 'function') {
          const meta = await window.api.xListening.campaignsMeta();
          setCampaignMeta(meta ?? {});
        }
      } catch (metaErr) {
        console.warn('[XListening] campaignsMeta:', metaErr);
      }
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
      setAvatars({});
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
    // Avatars are a display enhancement (ENTITY INDEX pics), resolved SEPARATELY so a miss never
    // blanks the core insights — and guarded so an older preload without the channel degrades to
    // monograms rather than throwing. The lookup is cache-only (no egress).
    try {
      if (typeof window.api?.xListening?.avatars === 'function') {
        const avatarRes = await window.api.xListening.avatars(id);
        setAvatars((avatarRes as unknown as Record<string, string>) ?? {});
      }
    } catch (err) {
      console.warn('[XListening] avatars:', err);
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
    const username = extractXUsername(targetUsername);
    if (!username) {
      setNotice('Enter a target username (or paste their x.com profile URL) to capture.');
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

  // ── ENTITY INDEX display pics: canonical-handle → LOCAL avatar data: URI ─────────────────────
  // The hardened analog of Enterprise's `avatarFor`. Resolves ONLY from the cache-only `avatars`
  // lookup — a `data:` URI or undefined (→ monogram). Never a remote URL, so never in the DOM.
  const avatarFor = useCallback(
    (handle: string): string | undefined => {
      const uri = avatars[normalizeXSourceKey(handle)];
      return uri && uri.startsWith('data:') ? uri : undefined;
    },
    [avatars],
  );

  // Small identity-avatar chip (mirrors Enterprise's `IdentityAvatar`): the localized image when the
  // handle has a cached avatar, else the handle's monogram initial — no broken image, no renderer
  // fetch. `size` is 'sm' (mention card head) or 'xs' (finding-source chip).
  const renderIdentAvatar = useCallback(
    (handle: string, size: 'xs' | 'sm') => {
      const src = avatarFor(handle);
      const initial = handle.replace(/^@+/, '').slice(0, 1).toUpperCase() || '@';
      return (
        <span className={`xls-ident-avatar xls-ident-avatar--${size}`} aria-hidden="true">
          {src ? <img src={src} alt="" /> : <span>{initial}</span>}
        </span>
      );
    },
    [avatarFor],
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

  // `renderPost` (the shared PostCard binding used by Dashboard / Live / Search) is defined lower,
  // after the analyst-note handlers it depends on (handleSaveNoteFor / handleRemoveNote), so its
  // dependency array never references a still-in-TDZ const.

  // ── campaign dock actions ──────────────────────────────────────────────────
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

  // ── J1: campaign editor modal (CREATE / EDIT) + DUPLICATE SETUP ────────────
  const handleOpenCreateEditor = useCallback(() => {
    setCampaignEditor({ mode: 'create' });
  }, []);

  const handleOpenEditEditor = useCallback((target: XCampaign) => {
    setCampaignEditor({ mode: 'edit', target });
  }, []);

  const handleSubmitEditor = useCallback(
    async (value: CampaignEditorValue) => {
      const editor = campaignEditor;
      if (!editor) return;
      setCampaignBusy(true);
      try {
        if (editor.mode === 'create') {
          // CREATE + ACTIVATE: make the campaign, persist its editor meta, then switch to it.
          const created = await window.api.xListening.campaignsCreate(value.name);
          await window.api.xListening.campaignsUpdate({
            id: created.id,
            name: created.name,
            purpose: value.purpose,
            description: value.description,
          });
          await loadCampaigns(created.id);
          setNotice(`Campaign "${created.name}" created.`);
        } else if (editor.target) {
          await window.api.xListening.campaignsUpdate({
            id: editor.target.id,
            name: value.name,
            purpose: value.purpose,
            description: value.description,
          });
          await loadCampaigns(editor.target.id);
          setNotice('Campaign saved.');
        }
        setCampaignEditor(null);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      } finally {
        setCampaignBusy(false);
      }
    },
    [campaignEditor, loadCampaigns],
  );

  const handleDuplicateCampaign = useCallback(
    async (source: XCampaign) => {
      setCampaignBusy(true);
      try {
        const copy = await window.api.xListening.campaignsDuplicate(source.id);
        await loadCampaigns(copy.id);
        setNotice(`Duplicated "${source.name}" setup into "${copy.name}".`);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      } finally {
        setCampaignBusy(false);
      }
    },
    [loadCampaigns],
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

  // Task I1: upsert an analyst note straight from a PostCard's inline notes panel (findingId = the
  // post id) through the SAME real `saveNote` upsert the Notes tab uses — a re-save of the same
  // finding REPLACES its note (edit), so add + edit share one path. On success the persisted note
  // list is re-seated from the returned record so every card + the Notes tab agree.
  const handleSaveNoteFor = useCallback(
    async (findingId: string, text: string) => {
      if (!activeCampaignId) return;
      const clean = text.trim();
      if (!findingId || !clean) return;
      try {
        const res = await window.api.xListening.saveNote({ caseId: activeCampaignId, findingId, text: clean });
        setNotes(res.notes as unknown as XNoteRow[]);
        setNotice('Analyst note saved.');
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
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

  // FB4 (audit HIGH #10): export the captured network as a self-describing JSON envelope embedding
  // the common-connection analysis + a manifestHash — the analysis reaches a JSON file, not only CSV.
  const handleExportNetworkJson = useCallback(async () => {
    if (!activeCampaignId) return;
    setExportBusy(true);
    try {
      const res = await window.api.xListening.exportNetworkJsonToFile(activeCampaignId);
      setNotice(
        res.canceled
          ? 'Export canceled.'
          : `Exported ${res.count} relationship(s) to ${res.filePath} (sha256 ${res.sha256.slice(0, 10)}…).`,
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
      // The save re-armed the main-side timers (Enterprise `settings:save` → restart) — re-read the
      // fresh schedule so the next-sweep indicator reflects the new cadence immediately.
      void refreshScheduleStatus(activeCampaignId);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setCollectionSettingsBusy(false);
    }
    // refreshScheduleStatus is stable (defined below with an empty dep set).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaignId, collectionSettings]);

  // ── G1: automatic-sweep schedule status (next-sweep indicator + one-click Pause) ────────────
  // Read the main-side scheduler registry. Guarded so a minimal test harness (api mock without the
  // method) never throws — the seam test only requires the literal call to exist below.
  const refreshScheduleStatus = useCallback(async (id: string) => {
    if (!id || typeof window.api?.xListening?.scheduleStatus !== 'function') {
      setSchedule(null);
      return;
    }
    try {
      const st = await window.api.xListening.scheduleStatus(id);
      setSchedule(st ?? null);
    } catch (err) {
      console.warn('[XListening] scheduleStatus:', err);
    }
  }, []);

  // Re-read the schedule whenever the campaign or session-connect state changes (connect arms the
  // timers main-side; disconnect halts them), and poll gently so the next-sweep time stays current.
  useEffect(() => {
    void refreshScheduleStatus(activeCampaignId);
    if (!activeCampaignId) return;
    const handle = window.setInterval(() => void refreshScheduleStatus(activeCampaignId), 20000);
    return () => window.clearInterval(handle);
  }, [activeCampaignId, sessionConnected, refreshScheduleStatus]);

  // One-click Pause (ADHD-friendly): flip automaticSweeps OFF and persist immediately — no need to
  // hunt for the checkbox + Save. Main clamps + re-arms (to nothing) on the save.
  const handlePauseSweeps = useCallback(async () => {
    if (!activeCampaignId) return;
    setCollectionSettingsBusy(true);
    try {
      const next = { ...collectionSettings, automaticSweeps: false };
      const saved = await window.api.xListening.saveCollectionSettings({
        caseId: activeCampaignId,
        settings: next,
      });
      setCollectionSettings(clampCollectionSettings(saved));
      setNotice('Automatic sweeps paused for this campaign.');
      void refreshScheduleStatus(activeCampaignId);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setCollectionSettingsBusy(false);
    }
  }, [activeCampaignId, collectionSettings, refreshScheduleStatus]);

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
  // Reset the editor back to a fresh "NEW PRESET" state (also the EDIT → Cancel path).
  const clearPresetEditor = useCallback(() => {
    setEditingPresetId(null);
    setPresetNameDraft('');
    setPresetKeywordsDraft('');
    setPresetModeDraft('any');
    setPresetCaseDraft(false);
    setPresetProfilesDraft([]);
  }, []);

  // Audit HIGH #9 — EDIT: load an existing preset into the form (his `editPreset`, main.tsx:306).
  // Keywords round-trip one-per-line so the textarea shows the saved phrase list.
  const handleEditPreset = useCallback((preset: XPresetRow) => {
    setEditingPresetId(preset.id);
    setPresetNameDraft(preset.name);
    setPresetKeywordsDraft(preset.keywords.join('\n'));
    setPresetModeDraft(preset.mode);
    setPresetCaseDraft(preset.caseSensitive === true);
    setPresetProfilesDraft(preset.profileIds ?? []);
  }, []);

  const handleSavePreset = useCallback(async () => {
    if (!activeCampaignId) return;
    const name = presetNameDraft.trim();
    // Audit HIGH #9 — keywords now come from a dedicated TEXTAREA split on comma OR newline
    // (his form, main.tsx:345), no longer piggy-backed on the live search box.
    const keywords = presetKeywordsDraft.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
    if (!name) {
      setNotice('Enter a name for this preset before saving.');
      return;
    }
    if (!keywords.length) {
      setNotice('Enter at least one keyword or phrase for this preset.');
      return;
    }
    setPresetsBusy(true);
    try {
      // Audit HIGH #9 — send the FULL preset shape (mode / caseSensitive / profileIds) the save
      // handler already stores + evaluatePreset already honors. EDIT upserts the same id.
      const res = await window.api.xListening.presetsSave({
        caseId: activeCampaignId,
        id: editingPresetId ?? crypto.randomUUID(),
        name,
        keywords,
        mode: presetModeDraft,
        caseSensitive: presetCaseDraft,
        profileIds: presetProfilesDraft,
        enabled: true,
      });
      setPresets(res.presets as unknown as XPresetRow[]);
      clearPresetEditor();
      setNotice(editingPresetId ? `Preset "${name}" updated.` : `Preset "${name}" saved.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setPresetsBusy(false);
    }
  }, [
    activeCampaignId,
    presetNameDraft,
    presetKeywordsDraft,
    presetModeDraft,
    presetCaseDraft,
    presetProfilesDraft,
    editingPresetId,
    clearPresetEditor,
  ]);

  const handleRunPreset = useCallback(
    async (preset: XPresetRow) => {
      if (!activeCampaignId) return;
      setPresetsBusy(true);
      try {
        const res = await window.api.xListening.presetsRun({ caseId: activeCampaignId, id: preset.id });
        // Audit HIGH #8 — keep the matches so the matched posts render with highlighting + a
        // MATCH:<name> row, instead of discarding them behind a toast.
        setPresetRun({ name: preset.name, matches: res.matches });
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

  // Audit HIGH #8 — the last preset RUN result, projected onto the loaded posts. `presetMatchByPost`
  // maps each matched post to its highlight terms + the preset name (his `presetMatchByPost`,
  // main.tsx:279); `presetMatchedPosts` are the posts to render, in the loaded order.
  const presetMatchByPost = useMemo(() => {
    const map = new Map<string, { terms: string[]; names: string[] }>();
    if (!presetRun) return map;
    for (const m of presetRun.matches) {
      map.set(m.postId, { terms: m.matchedKeywords, names: [presetRun.name] });
    }
    return map;
  }, [presetRun]);
  const presetMatchedPosts = useMemo(
    () => posts.filter((p) => presetMatchByPost.has(p.id)),
    [posts, presetMatchByPost],
  );

  // ── Task 15: Changes tab — newly-observed vs long-standing network accounts ─────────────
  const sortedNetworkChanges = useMemo(
    () =>
      [...networks].sort((a, b) => (b.lastObservedAt ?? '').localeCompare(a.lastObservedAt ?? '')),
    [networks],
  );

  // ── Task I1: the shared rich PostCard binding (Dashboard / Live / Search) ────────────────────
  // One extracted card, wired to the hardened seams: OPEN REAL THREAD → E1's Tor-gated
  // openInX('thread', post.url); VERIFY LIVE → A1's verifyPost (hidden for synthetic inside the
  // card); inline ANALYST NOTES → the existing saveNote/removeNote IPC. Per-post notes are the
  // findingId-keyed slice of the campaign's notes. Defined here (after every handler it depends on)
  // so its dependency array never touches a still-in-TDZ const. `opts.highlightTerms` lets Search
  // pass its live query for in-text highlighting; other call sites pass the card plain.
  const renderPost = useCallback(
    (post: XPostRow, opts?: { highlightTerms?: string[]; presetNames?: string[] }) => (
      <PostCard
        key={post.id}
        post={post}
        caseId={activeCampaignId}
        notes={notes.filter((n) => n.findingId === post.id)}
        verifying={verifyingPostId === post.id}
        onOpenThread={(p) => void handleOpenInX('thread', p.url)}
        onVerify={(id) => void handleVerifyPost(id)}
        onSaveNote={handleSaveNoteFor}
        onDeleteNote={handleRemoveNote}
        highlightTerms={opts?.highlightTerms}
        presetNames={opts?.presetNames}
      />
    ),
    [
      activeCampaignId,
      notes,
      verifyingPostId,
      handleOpenInX,
      handleVerifyPost,
      handleSaveNoteFor,
      handleRemoveNote,
    ],
  );

  // ── J2 Enterprise shell derivations ──────────────────────────────────────
  // Live count badges for the sidebar nav (Enterprise parity). Each is a REAL
  // count off this shell's loaded state — never a fabricated figure. Tabs with
  // no meaningful count (dashboard/exports/system) carry no badge.
  const navBadge = (t: XTab): number | undefined => {
    switch (t) {
      case 'live': return posts.length;
      case 'sources': return sourceGroups.length;
      case 'network': return analysis.commonIdentityCount;
      case 'entities': return entities.length;
      case 'changes': return changeEvents.length;
      case 'search': return presets.length;
      case 'notes': return notes.length;
      case 'campaigns': return campaigns.length;
      default: return undefined;
    }
  };
  const activeCampaignPurpose =
    (campaignMeta[activeCampaignId]?.purpose || '').trim() || 'No purpose defined.';
  const imagesOn = imagePolicy.retrieveImages !== false;

  return (
    <div className="xls-root">
      <aside className="xls-sidebar">
        <div className="xls-brand">
          <div className="xls-seal" aria-hidden="true">CD</div>
          <div className="xls-brand-text">
            <strong>CYBERVS DOMINATVS</strong>
            <span>X LISTENING STATION</span>
            <small>ENTERPRISE // by GhostExodus</small>
          </div>
        </div>

        <div className="xls-campaign-dock">
          <span className="xls-dock-eyebrow">ACTIVE CAMPAIGN</span>
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
          <small className="xls-dock-purpose">{activeCampaignPurpose}</small>
          <div className="xls-dock-actions">
            <button
              className="xls-btn xls-btn-primary"
              onClick={handleOpenCreateEditor}
              disabled={campaignBusy}
            >
              + NEW
            </button>
            <button
              className="xls-btn"
              onClick={() => activeCampaign && handleOpenEditEditor(activeCampaign)}
              disabled={campaignBusy || !activeCampaign}
            >
              EDIT
            </button>
            <button className="xls-btn" onClick={() => setTab('campaigns')}>
              MANAGE
            </button>
          </div>
          {caseId && (
            <div className="xls-dock-note">
              Opened from investigation case {caseId} (label only — this campaign is self-managed
              and works with no case bound).
            </div>
          )}
        </div>

        <nav className="xls-nav">
          {XLS_TABS.map((t) => {
            const badge = navBadge(t);
            return (
              <button
                key={t}
                data-tab={t}
                className={`xls-tab${tab === t ? ' xls-tab-active' : ''}`}
                onClick={() => setTab(t)}
              >
                <span className="xls-nav-label">{XLS_NAV_LABEL[t]}</span>
                {badge !== undefined && <b className="xls-nav-badge">{badge}</b>}
              </button>
            );
          })}
        </nav>

        <div className={`xls-tor-box${clearnet ? ' xls-tor-bad' : ' xls-tor-ok'}`}>
          <div className="xls-tor-head">
            <span
              className={`xls-status-dot${clearnet ? '' : ' xls-online'}`}
              aria-hidden="true"
            />
            <div className="xls-tor-label">
              <strong>{clearnet ? 'CLEARNET — REAL IP' : 'TOR MODE'}</strong>
              <small>
                {clearnet
                  ? 'Capture uses your real IP, not Tor.'
                  : 'Fails closed when background Tor is down — no clearnet fallback.'}
              </small>
            </div>
          </div>
          <label className="xls-check xls-tor-toggle">
            <input
              type="checkbox"
              checked={clearnet}
              onChange={(e) => void setClearnet(e.target.checked)}
              disabled={!xListeningSettings}
            />
            Route over CLEARNET instead of Tor (exposes your real IP to X)
          </label>
          <div className="xls-markers">
            <span
              className={`xls-marker${clearnet ? ' xls-marker-clearnet' : ' xls-marker-tor'}`}
            >
              {clearnet ? 'CLEARNET' : 'TOR'}
            </span>
            {demoActive && <span className="xls-marker xls-marker-demo">DEMO DATA LOADED</span>}
          </div>
        </div>

        <div className="xls-session-box">
          <span
            className={`xls-status-dot${sessionConnected ? ' xls-online' : ''}`}
            aria-hidden="true"
          />
          <div className="xls-session-label">
            <strong>{sessionConnected ? 'X SESSION ONLINE' : 'X SESSION OFFLINE'}</strong>
            <small>CAMPAIGN: {activeCampaign?.name || '—'}</small>
          </div>
          <div className="xls-session-box-actions">
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
        </div>
      </aside>

      <div className="xls-main">
        <ModuleBanner
          variant="xls"
          src={xlsBanner}
          blurSrc={xlsBannerBlur}
          alt="CYBERVS DOMINATVS"
        />

        <header className="xls-topbar">
          <div className="xls-topbar-titles">
            <span className="xls-eyebrow">
              CYBERVS DOMINATVS X LISTENING STATION // ENTERPRISE v3.4.1
            </span>
            <h1 className="xls-topbar-title">{XLS_NAV_LABEL[tab]}</h1>
            <small className="xls-topbar-context">
              ACTIVE CAMPAIGN: {activeCampaign?.name || 'Unknown'} · {activeCampaignPurpose}
            </small>
          </div>
          <div className="xls-topbar-actions">
            <button
              className={`xls-btn xls-image-toggle${imagesOn ? ' xls-image-on' : ' xls-image-off'}`}
              onClick={() => setTab('system')}
              title="Image collection is configured per campaign in SYSTEM"
            >
              IMAGES: {imagesOn ? 'ON' : 'OFF'}
            </button>
            <button
              className="xls-btn"
              onClick={() => setTab('system')}
              title="X capture session — manage in SYSTEM"
            >
              {sessionConnected ? 'SESSION CONNECTED' : 'CONNECT X'}
            </button>
            <button
              className="xls-btn xls-btn-primary"
              onClick={() => setTab('live')}
              disabled={!activeCampaignId}
              title="Open the LIVE FEED to run a capture sweep"
            >
              RUN SWEEP
            </button>
          </div>
        </header>

        <div className="xls-notice" role="status">
          {notice}
        </div>

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
                      <span className="xls-health-counts">
                        {h.postCount ?? 0} posts · {h.followerCount ?? 0} followers · {h.followingCount ?? 0} following
                        {h.oldestPostAt ? ` · oldest ${h.oldestPostAt.slice(0, 10)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="xls-panel">
              <h3 className="xls-panel-title">RECENT CAPTURES</h3>
              <div className="xls-feed">
                {posts.slice(0, 5).map((p) => renderPost(p))}
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
              {livePosts.map((p) => renderPost(p))}
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
              <div className="xls-entity-grid">
                {filteredEntities.map((e) => {
                  const isMention = e.type === 'mention';
                  // Canonical handle for a mention drives the card avatar + OPEN X PROFILE; fall back
                  // to the display value with any leading '@' stripped for a legacy/partial payload.
                  const handle = (e.normalizedValue || e.value || '').replace(/^@+/, '');
                  const sources = e.sourceUsernames ?? [];
                  return (
                    <article className="xls-entity-card" key={e.id}>
                      <div className="xls-entity-heading">
                        {isMention && handle && renderIdentAvatar(handle, 'sm')}
                        <div className="xls-entity-headtext">
                          <span className="xls-entity-type">{e.type}</span>
                          <strong>{e.value}</strong>
                        </div>
                      </div>
                      <b className="xls-entity-count">{e.count} FINDINGS</b>
                      <div className="xls-entity-sources">
                        {sources.length ? (
                          sources.map((u) => (
                            <span className="xls-entity-source" key={u}>
                              {renderIdentAvatar(u, 'xs')}@{u.replace(/^@+/, '')}
                            </span>
                          ))
                        ) : (
                          <small>sources: —</small>
                        )}
                      </div>
                      <small className="xls-entity-when">
                        first {formatWhen(e.firstObservedAt ?? '')} · last{' '}
                        {formatWhen(e.lastObservedAt ?? '')}
                      </small>
                      {isMention && handle && (
                        <button
                          type="button"
                          className="xls-btn"
                          title="Open this account's X profile in a Tor-gated in-app window"
                          onClick={() => void handleOpenInX('profile', handle)}
                        >
                          OPEN X PROFILE
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
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
                            {/* completedPasses includes the +1 initial read, so it can exceed the
                                requested budget; clamp the displayed ratio so no >100% figure shows
                                (FB1 carried Phase-A minor). */}
                            {Math.min(run.completedPasses, run.requestedPasses || run.completedPasses)}/
                            {run.requestedPasses || '—'} passes · {statusLabel}
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
                searchResults.map((p) => renderPost(p, { highlightTerms: [searchQuery.trim()] }))
              )}
            </div>

            {/* Audit HIGH #9 — the full highlight-preset editor: name, keyword TEXTAREA (comma OR
                newline), MATCH ANY/ALL, CASE SENSITIVE, and per-source SCOPE checkboxes, plus EDIT. */}
            <div className="xls-panel xls-preset-editor">
              <h3 className="xls-panel-title">
                {editingPresetId ? 'EDIT HIGHLIGHT PRESET' : 'NEW HIGHLIGHT PRESET'}
              </h3>
              <div className="xls-add-source">
                <input
                  className="xls-input xls-preset-name"
                  aria-label="Preset name"
                  placeholder="Preset name…"
                  value={presetNameDraft}
                  onChange={(e) => setPresetNameDraft(e.target.value)}
                />
              </div>
              <textarea
                className="xls-input xls-preset-keywords"
                aria-label="Preset keywords"
                placeholder="Keywords or phrases — one per line or comma separated…"
                value={presetKeywordsDraft}
                onChange={(e) => setPresetKeywordsDraft(e.target.value)}
              />
              <div className="xls-preset-editor-row">
                <label className="xls-preset-mode">
                  MODE
                  <select
                    className="xls-input"
                    aria-label="Preset match mode"
                    value={presetModeDraft}
                    onChange={(e) => setPresetModeDraft(e.target.value === 'all' ? 'all' : 'any')}
                  >
                    <option value="any">MATCH ANY</option>
                    <option value="all">MATCH ALL</option>
                  </select>
                </label>
                <label className="xls-check">
                  <input
                    type="checkbox"
                    aria-label="Case sensitive"
                    checked={presetCaseDraft}
                    onChange={(e) => setPresetCaseDraft(e.target.checked)}
                  />
                  CASE SENSITIVE
                </label>
              </div>
              {sourceGroups.length > 0 && (
                <div className="xls-preset-scope">
                  <span className="xls-preset-scope-label">
                    SCOPE TO SOURCES <em>(none = all campaign sources)</em>
                  </span>
                  <div className="xls-preset-profile-grid">
                    {sourceGroups.map((g) => {
                      const handle = g.channelId.replace(/^@/, '');
                      return (
                        <label className="xls-check xls-preset-profile" key={g.channelId}>
                          <input
                            type="checkbox"
                            aria-label={`Scope to @${handle}`}
                            checked={presetProfilesDraft.includes(g.channelId)}
                            onChange={(e) =>
                              setPresetProfilesDraft(
                                e.target.checked
                                  ? [...presetProfilesDraft, g.channelId]
                                  : presetProfilesDraft.filter((id) => id !== g.channelId),
                              )
                            }
                          />
                          @{handle}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="xls-source-actions">
                <button
                  className="xls-btn xls-btn-primary"
                  onClick={() => void handleSavePreset()}
                  disabled={presetsBusy || !activeCampaignId}
                >
                  {editingPresetId ? 'Save Changes' : 'Save Preset'}
                </button>
                {editingPresetId && (
                  <button className="xls-btn" onClick={clearPresetEditor} disabled={presetsBusy}>
                    Cancel
                  </button>
                )}
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
                        <span className="xls-count xls-preset-meta">
                          {p.mode === 'all' ? 'MATCH ALL' : 'MATCH ANY'}
                          {p.caseSensitive ? ' · case sensitive' : ''}
                          {' · '}
                          {p.profileIds && p.profileIds.length
                            ? `${p.profileIds.length} scoped source(s)`
                            : 'all sources'}
                        </span>
                      </span>
                      <span className="xls-source-actions">
                        <button className="xls-btn" onClick={() => void handleRunPreset(p)} disabled={presetsBusy}>
                          Run
                        </button>
                        <button className="xls-btn" onClick={() => handleEditPreset(p)} disabled={presetsBusy}>
                          Edit
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

            {/* Audit HIGH #8 — the matched posts from the last RUN, with keyword highlighting and a
                MATCH:<preset name> row (PostCard's presetNames path). */}
            {presetRun && (
              <div className="xls-panel xls-preset-results">
                <h3 className="xls-panel-title">
                  PRESET MATCHES — {presetRun.name}{' '}
                  <span className="xls-count">{presetMatchedPosts.length} post(s)</span>
                </h3>
                <div className="xls-feed">
                  {presetMatchedPosts.length === 0 ? (
                    <div className="xls-empty">
                      No captured post currently matches “{presetRun.name}”.
                    </div>
                  ) : (
                    presetMatchedPosts.map((p) => {
                      const match = presetMatchByPost.get(p.id)!;
                      return renderPost(p, { highlightTerms: match.terms, presetNames: match.names });
                    })
                  )}
                </div>
              </div>
            )}
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
                Follower/following accounts as formula-guarded CSV, or a self-describing JSON
                envelope embedding the common-connection analysis + a SHA-256 manifest hash —
                demo/synthetic accounts excluded from both.
              </p>
              <div className="xls-dock-row">
                <button
                  className="xls-btn xls-btn-primary"
                  onClick={() => void handleExportNetwork()}
                  disabled={exportBusy || !activeCampaignId}
                >
                  Export Network CSV…
                </button>
                <button
                  className="xls-btn xls-btn-primary"
                  title="Export the captured network as JSON embedding the common-connection analysis (synthetic excluded, deterministic manifest hash, SHA-256 sidecar)."
                  onClick={() => void handleExportNetworkJson()}
                  disabled={exportBusy || !activeCampaignId}
                >
                  Export Network JSON…
                </button>
              </div>
            </div>
          </section>
        )}

        {tab === 'campaigns' && (
          <section className="xls-tab-panel xls-campaigns">
            <div className="xls-panel-title-row">
              <h3 className="xls-panel-title">ALL CAMPAIGNS</h3>
              <button
                className="xls-btn xls-btn-primary"
                onClick={handleOpenCreateEditor}
                disabled={campaignBusy}
              >
                New Campaign
              </button>
            </div>
            <p className="xls-help">
              Each campaign keeps its own sources, collected findings, follower network, presets,
              analyst notes, and archive settings. DUPLICATE SETUP starts a fresh investigation with
              the same presets and collection settings but zero collected counts.
            </p>
            {campaigns.length === 0 ? (
              <div className="xls-empty">No campaigns yet — create one to start collecting.</div>
            ) : (
              <ul className="xls-source-list xls-campaign-list">
                {campaigns.map((c) => {
                  const meta = campaignMeta[c.id] ?? EMPTY_CAMPAIGN_META;
                  const isActive = c.id === activeCampaignId;
                  return (
                    <li className="xls-source-row xls-campaign-card" key={c.id}>
                      <div className="xls-campaign-info">
                        <span className="xls-campaign-name">
                          {c.name}
                          {isActive && (
                            <span className="xls-marker xls-marker-active"> ACTIVE</span>
                          )}
                        </span>
                        <span className="xls-campaign-purpose">
                          {meta.purpose || 'No purpose defined'}
                        </span>
                        {meta.description && (
                          <span className="xls-campaign-description">{meta.description}</span>
                        )}
                      </div>
                      <span className="xls-source-actions">
                        <button
                          className="xls-btn"
                          onClick={() => void handleSwitchCampaign(c.id)}
                          disabled={campaignBusy || isActive}
                        >
                          Activate
                        </button>
                        <button
                          className="xls-btn"
                          onClick={() => handleOpenEditEditor(c)}
                          disabled={campaignBusy}
                        >
                          Edit
                        </button>
                        <button
                          className="xls-btn"
                          onClick={() => void handleDuplicateCampaign(c)}
                          disabled={campaignBusy}
                        >
                          Duplicate Setup
                        </button>
                        <button
                          className="xls-btn xls-btn-danger"
                          onClick={() => void handleDeleteCampaign(c)}
                          disabled={campaignBusy || campaigns.length <= 1}
                          title={
                            campaigns.length <= 1
                              ? 'At least one campaign must remain.'
                              : undefined
                          }
                        >
                          Delete
                        </button>
                      </span>
                    </li>
                  );
                })}
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
                <div className="xls-schedule-status" role="status">
                  {schedule?.sweepEnabled ? (
                    <>
                      <span className="xls-schedule-dot xls-schedule-on" aria-hidden="true" />
                      <span className="xls-schedule-text">
                        Auto-sweep ON · every {schedule.sweepIntervalMinutes} min ·{' '}
                        {sessionConnected
                          ? `next sweep ${schedule.nextSweepAt ? formatWhen(schedule.nextSweepAt) : 'soon'}`
                          : 'paused until an X session is connected'}
                      </span>
                      <button
                        type="button"
                        className="xls-btn"
                        onClick={() => void handlePauseSweeps()}
                        disabled={collectionSettingsBusy || !activeCampaignId}
                      >
                        Pause sweeps
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="xls-schedule-dot" aria-hidden="true" />
                      <span className="xls-schedule-text">
                        Auto-sweep is OFF — enable it above and Save to start the timer.
                      </span>
                    </>
                  )}
                </div>
                {schedule?.archiveEnabled && (
                  <p className="xls-help">
                    Incremental archive ON · every {schedule.archiveIntervalMinutes} min ·{' '}
                    {schedule.nextArchiveAt ? `next cycle ${formatWhen(schedule.nextArchiveAt)}` : 'soon'}.
                  </p>
                )}
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
      {campaignEditor && (
        <CampaignEditorDialog
          mode={campaignEditor.mode}
          busy={campaignBusy}
          initial={
            campaignEditor.mode === 'edit' && campaignEditor.target
              ? {
                  name: campaignEditor.target.name,
                  purpose: (campaignMeta[campaignEditor.target.id] ?? EMPTY_CAMPAIGN_META).purpose,
                  description: (campaignMeta[campaignEditor.target.id] ?? EMPTY_CAMPAIGN_META).description,
                }
              : { name: '', purpose: '', description: '' }
          }
          onSubmit={(v) => void handleSubmitEditor(v)}
          onCancel={() => setCampaignEditor(null)}
        />
      )}
    </div>
  );
}
