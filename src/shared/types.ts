/**
 * Shared types crossing the IPC boundary.
 * Imported by both main and renderer processes.
 */

import type { Units } from './weather/types';

export type CaseId = string;
export type ISODate = string;

export type CaseStatus = 'new' | 'open' | 'pending' | 'closed' | 'archived';
export type CasePriority = 'low' | 'medium' | 'high' | 'critical';

export interface CaseSummary {
  id: CaseId;
  title: string;
  reference: string;
  status: CaseStatus;
  priority: CasePriority;
  tags: string[];
  createdAt: ISODate;
  updatedAt: ISODate;
  archived: boolean;
  /** Small base64 data-URI of the case's primary bio thumbnail, if any. Optional + null-safe:
   *  legacy summaries and bio-less cases omit it; the list UI must tolerate undefined. */
  primaryBioThumb?: string;
  /** User-assigned grouping bucket for the case list. Optional + null-safe: legacy summaries
   *  omit it; the list UI treats undefined/'' as the "Uncategorized" group. */
  category?: string;
}

/** A scraping case: a self-contained store for one social-collection run, kept apart from the
 *  core investigation cases. Persisted under scrapingCaseFile(ns, id) via the encrypt-at-rest
 *  IO layer. Namespace (socmint | x) is the path key, not a field on the record. */
export interface ScrapingCase {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  note?: string;
}

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
export const IMAGE_MIMES: readonly ImageMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** A bio/profile image attached to a case. Original + a generated thumbnail live under
 *  caseDir/bio-images/ and bio-thumbs/; metadata is indexed in bio-images.json. No hashing. */
export interface BioImage {
  id: string;
  fileName: string;
  thumbName: string;
  originalName: string;
  mime: ImageMime;
  width: number;
  height: number;
  size: number;
  importedAt: ISODate;
  caption?: string;
  /** Transient: thumbnail data-URI, inlined on read for direct <img> rendering. Never persisted. */
  thumbDataUri?: string;
  /** Transient: true if this is the case's primary image. Never persisted. */
  isPrimary?: boolean;
}

export type TimelineKind =
  | 'created' | 'note' | 'file' | 'link' | 'reminder' | 'task' | 'status' | 'custom'
  | 'updated' | 'archive' | 'rename' | 'view' | 'entity' | 'bio-image' | 'geo-event';

/** Widened additively over time — old timeline.json files only contain earlier kinds and keep
 *  loading; render does no enum-check so forward-version events still display. */
export const TIMELINE_KINDS: readonly TimelineKind[] = [
  'created', 'note', 'file', 'link', 'reminder', 'task', 'status', 'custom',
  'updated', 'archive', 'rename', 'view', 'entity', 'bio-image', 'geo-event'
];

export interface TimelineEvent {
  id: string;
  at: ISODate;
  kind: TimelineKind;
  message: string;
}

export interface TaskItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: ISODate;
  dueAt?: ISODate;
}

export interface Reminder {
  id: string;
  caseId?: CaseId;
  title: string;
  body?: string;
  fireAt: ISODate;
  repeat?: 'none' | 'daily' | 'weekly' | 'monthly';
  lastFiredAt?: ISODate;
  fired?: boolean;
  /** Optional colour (hex, e.g. "#800000") for the calendar event chip. Undefined = default navy. */
  color?: string;
  /** Optional free-text note shown on hover over the calendar event; edited via its right-click menu. */
  note?: string;
}

export interface Alarm {
  id: string;
  label: string;
  fireAt: ISODate;
  enabled: boolean;
  repeat?: 'none' | 'daily' | 'weekly';
}

export interface WebLink {
  id: string;
  url: string;
  title: string;
  addedAt: ISODate;
}

export interface AttachmentMeta {
  fileName: string;
  originalName: string;
  importedAt: ISODate;
  size: number;
  sourcePath: string | null;
  sha256?: string;
}

/** Result of reading an attachment's text for AI context. `text` is null when the
 *  file is binary, empty, or unreadable — the reason says which. Size caps + binary
 *  detection happen in the main process; the renderer never receives binary blobs. */
export interface AttachmentTextResult {
  fileName: string;
  text: string | null;
  /** Total size on disk, bytes. */
  size: number;
  /** Bytes actually read (<= per-file cap). */
  bytesRead: number;
  /** True when the file is larger than the per-file read cap. */
  truncated: boolean;
  reason?: 'binary' | 'empty' | 'read-error' | 'locked' | 'decrypt-failed';
}

/** A page of raw attachment bytes (base64) for the in-app document viewer.
 *  Path-confined + range-clamped in the main process; never persisted. */
export interface AttachmentBytesResult {
  fileName: string;
  /** base64 of the requested slice, or null on error / out-of-range. */
  base64: string | null;
  /** Total file size on disk, bytes. */
  size: number;
  /** Offset this slice started at. */
  offset: number;
  /** Bytes in this slice (decoded length). */
  length: number;
  /** True when there are more bytes past this slice. */
  hasMore: boolean;
  reason?: 'read-error' | 'out-of-range' | 'locked' | 'decrypt-failed';
}

/** Result of requesting a streamable ga98media:// URL for a case attachment (large
 *  video/audio that must NOT be base64-loaded into the renderer). `url` is null when the
 *  file can't be streamed; `reason` says why. `encrypted` means encrypt-at-rest is on and
 *  whole-file GCM can't be range-streamed — the viewer falls back to "use Reveal". */
export interface MediaUrlResult {
  url: string | null;
  reason?: 'encrypted' | 'missing' | 'forbidden';
}

/** Inner attachment of a parsed .eml — metadata ONLY (never the bytes). */
export interface EmlAttachmentInfo {
  filename: string;
  contentType: string;
  size: number;
}

/** Parsed preview of an .eml file for the viewer. Body html is RAW — the renderer
 *  must run it through sanitizeHtml before display. Never persisted. */
export interface EmlPreview {
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  headers: { key: string; value: string }[];
  text: string;
  html: string | null;
  attachments: EmlAttachmentInfo[];
}

/** Extracted, displayable metadata for an attachment (no hashing). Cached on disk
 *  next to the file as `<fileName>.extracted.json`; that cache file is skipped by
 *  listAttachmentsImpl so it never appears as a phantom attachment. */
export interface ExtractedAttachmentMeta {
  fileName: string;
  fileType: string;
  size: number;
  importedAt?: ISODate;
  modifiedAt?: ISODate;
  createdAt?: ISODate;
  originalPath?: string | null;
  /** Selected EXIF tags (images only), stringified for transport. */
  exif?: Record<string, string>;
  /** GPS coordinates if the image carried them. Stored, but the UI hides it behind
   *  an explicit "Show location" toggle (operator decision). */
  gps?: { lat: number; lon: number };
  /** Email headers (EML only). */
  emlHeaders?: { key: string; value: string }[];
}

export type EntityType =
  | 'person' | 'alias' | 'email' | 'phone' | 'domain' | 'ip'
  | 'organisation' | 'social-profile' | 'vehicle' | 'location' | 'crypto-wallet' | 'other'
  | 'url' | 'hostname' | 'asn' | 'certificate' | 'username' | 'file-hash';

export const ENTITY_TYPES: readonly EntityType[] = [
  'person', 'alias', 'email', 'phone', 'domain', 'ip',
  'organisation', 'social-profile', 'vehicle', 'location', 'crypto-wallet', 'other',
  'url', 'hostname', 'asn', 'certificate', 'username', 'file-hash'
];

export type EntityRelationship = 'family' | 'associate' | 'other';
export const ENTITY_RELATIONSHIPS: readonly EntityRelationship[] = ['family', 'associate', 'other'];

/** A global, cross-case entity. Lives once in dataRoot/entities.json; referenced by id from
 *  any number of cases. Merging folds one record into another and records the provenance. */
export interface EntityRecord {
  id: string;
  type: EntityType;
  value: string;
  notes: string;
  aliases: string[];
  createdAt: ISODate;
  updatedAt: ISODate;
  mergedFrom?: string[];
}

/** A per-case link to a global entity, with the optional Family/Associates/Other bucket and
 *  references to the case's own web links + attachments. Persisted in caseDir/entity-links.json. */
export interface EntityLink {
  entityId: string;
  relationship?: EntityRelationship;
  linkIds: string[];
  attachmentFileNames: string[];
  addedAt: ISODate;
}

/** A case's entity link resolved against the global registry, for display. */
export interface ResolvedEntity {
  entity: EntityRecord;
  relationship?: EntityRelationship;
  linkIds: string[];
  attachmentFileNames: string[];
}

export interface CaseRecord extends CaseSummary {
  description: string;
  notes: { name: string; updatedAt: ISODate }[];
  attachments: AttachmentMeta[];
  links: WebLink[];
  timeline: TimelineEvent[];
  tasks: TaskItem[];
  reminders: Reminder[];
  entities: ResolvedEntity[];
  bioImages: BioImage[];
}

export interface CreateCaseInput {
  title: string;
  reference?: string;
  description?: string;
  status?: CaseStatus;
  priority?: CasePriority;
  tags?: string[];
  category?: string;
}

export interface SearchHit {
  field: string;
  snippet: string;
  /** Structured navigation target so the UI can deep-link to the exact hit. */
  kind?: 'case' | 'note' | 'file';
  noteName?: string; // when kind === 'note'
  fileName?: string; // when kind === 'file' — internal storage name (doc-viewer needs this)
  originalName?: string; // when kind === 'file' — user-facing name
}
export interface SearchResult { caseId: string; caseTitle: string; hits: SearchHit[] }

export type WhiteboardNodeType = 'text' | 'link' | 'image' | 'file';

export interface WhiteboardNode {
  id: string;
  type: WhiteboardNodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Text content (text node), title (link/file/image caption). */
  text?: string;
  /** Link node URL. */
  url?: string;
  /** image/file node → references a case attachment by its on-disk fileName. */
  fileName?: string;
  /** Optional node accent colour (CSS hex). */
  color?: string;
  /** Optional user-given label shown in the node header; falls back to the type. */
  name?: string;
}

export interface WhiteboardEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

/** A per-case canvas board (Obsidian-Canvas / Freeform style), stored in caseDir/whiteboard.json. */
export interface Whiteboard {
  nodes: WhiteboardNode[];
  edges: WhiteboardEdge[];
}

export interface AccessShortcut {
  id: string;
  label: string;
  /** Either a built-in module key or 'url' for a web link. */
  kind: 'module' | 'url';
  /** Module name (e.g. 'cases') for kind=module; URL string for kind=url. */
  target: string;
  icon?: string;
}

/** A Journal Jots block — structurally identical to Reports' text/image blocks (reused verbatim so
 *  the Reports `TextBlock`/`ImageBlock` renderer components work against journal entries without
 *  adapters). Journal omits the table block — Reports has no block-reorder either, matching scope. */
export type JournalBlock = Extract<import('./reports-types').ReportBlock, { kind: 'text' | 'image' }>;

/** A Journal Jots entry — a personal journal note consolidated INSIDE the Journal app. Persisted
 *  in the journal store (encrypted at rest when login is on); never written to a case or the
 *  Briefcase. The 4-digit PIN gating the UI is a rate-limited convenience boundary, NOT this
 *  data's encryption key (the vault DEK is). Zero network. */
export interface JournalEntry {
  id: string;
  /** Legacy plain-text body — present ONLY on records persisted before the block-editor model
   *  shipped. Superseded by `blocks`; the store's read()/readAll() always populate `blocks`
   *  (synthesizing a single HTML-ESCAPED text block from `body` when a record predates this
   *  field — the legacy text is never interpreted as HTML). Read-only: save() never writes it. */
  body?: string;
  title: string;
  blocks: JournalBlock[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Lightweight row for the Journal list — blocks fetched on open. */
export interface JournalEntrySummary { id: string; title: string; updatedAt: ISODate; bytes: number }

/** What the renderer sends to persist a journal entry (id minted + timestamps managed by the store). */
export interface JournalEntryInput { id: string; title: string; blocks: JournalBlock[] }

/** Jukebox shade state: strip (deck only) → deck (+playlist) → full (+stations drawer). */
export type JukeboxMode = 'strip' | 'deck' | 'full';

export interface AppSettings {
  soundEnabled: boolean;
  themeIntensity: 'lite' | 'classic' | 'maximum';
  themeName: string;
  /** Desktop background colour (CSS hex). Defaults to the classic Win98 teal. */
  wallpaperColor: string;
  /** Optional desktop background image as a data: URI (covers the colour when set). */
  wallpaperImage: string | null;
  /** Button face colour (CSS hex). '' = keep the active theme's own button look. The label ink is
   *  derived from it, never chosen separately — see shared/theme/button-color.ts. */
  buttonColor: string;
  /** Saved button-colour swatches, newest first. */
  buttonColorPresets: string[];
  /** Optional custom boot-splash / lock-screen image as a data: URI; falls back to the bundled
   *  boot-splash.jpg when null. Top-level scalar — mergeSettings' base-spread heals it on its own. */
  bootSplashImage: string | null;
  startupSoundEnabled: boolean;
  /** Opt-in "Legacy sound pack": when true, the startup chime and DialTerm dial-up use bundled
   *  AI-reworked recordings of the classic Windows jingle + dial-up handshake instead of the
   *  default synthesized sounds. Off by default. */
  legacySounds: boolean;
  caseFolderOverride: string | null;
  hasSeenWelcome: boolean;
  hasSeenSearchlightIntro: boolean;
  caseSortBy: 'updatedAt' | 'createdAt' | 'priority' | 'status' | 'title';
  caseSortDir: 'asc' | 'desc';
  /** Per-category collapse state for the My Cases sidebar, keyed by category name.
   *  Absent key = collapsed (closed by default). */
  caseCategoryCollapsed: Record<string, boolean>;
  shortcuts: AccessShortcut[];
  /** Targets of REQUIRED_MODULE_SHORTCUTS that have been seeded into `shortcuts` at least once.
   *  Lets the reconciler introduce new built-in modules to existing installs exactly once,
   *  without re-adding a shortcut the user later deletes. */
  seededShortcuts: string[];
  /** DialTerm local shell — opt-in (default off). When false the main process refuses
   *  shell.connect even if the renderer asks. */
  localShellEnabled: boolean;
  /** Which local shell to spawn when localShellEnabled. Mapped to a fixed executable by
   *  the main process; the renderer never supplies an executable path. */
  localShellProgram: 'cmd' | 'powershell';
  ai: {
    provider: 'ollama' | 'openai-compatible' | 'none';
    endpoint: string;
    model: string;
    defaultSystemPrompt: string;
    /** Render assistant replies as formatted markdown (bold/italics/bullets/headings) instead of
     *  raw text. Default true; off shows the plain raw text. */
    formattedOutput: boolean;
    /** Reference into secrets.enc; the API key itself is never stored here. */
    apiKeyRef: string | null;
    /** Text-to-speech (offline, Web Speech / OS voices). Flat fields so partial settings
     *  patches through the shallow `ai` merge can't drop sibling values. */
    ttsEnabled: boolean;
    /** Chosen voice's voiceURI, or null to use the OS default voice. */
    ttsVoiceUri: string | null;
    /** Speech rate, 0.5–2.0. */
    ttsRate: number;
    /** TTS engine: 'system' = Web Speech / OS voices; 'piper' = bundled offline neural voice; 'auto'
     *  = prefer Piper when installed, else system. Default 'auto'. */
    ttsEngine: 'auto' | 'system' | 'piper';
    /** Chosen user-supplied Piper voice id (the `.onnx` filename), or null for the bundled voice. */
    piperVoice: string | null;
    /** When true, the assistant retrieves relevant case/conversation memory (local vector search
     *  over the bundled embedding model) and injects it as context. Offline; default off. */
    useMemory: boolean;
    /** When true (and `useMemory` is on), note/case/conversation saves trigger a debounced
     *  background reindex so recall reflects the latest content without a manual rebuild.
     *  Local-only; no-op for non-Ollama providers. Default true. */
    autoReindex: boolean;
    /** When true (and `useMemory` is on), the assistant also injects a self-updating, inspectable
     *  long-term profile (durable facts + a rolling summary) learned from conversations, and
     *  learns from each conversation after it settles. Local-only, encrypted at rest, fully
     *  user-editable/erasable; no-op for non-Ollama providers. Default off. */
    adaptiveMemory: boolean;
    /** When true (Ollama only), the assistant may emit a `[SEARCH: query]` directive that triggers a
     *  Tor-routed DuckDuckGo-onion web search; results are fed back as untrusted data, then it answers.
     *  Onion-to-onion (no exit node, no clearnet). Default off. */
    webSearch: boolean;
    /** Operator-authorized, hard-gated fallback: when true AND a Tor web search (webSearch) returns
     *  zero results, the assistant may fall back to a plain clearnet DuckDuckGo query. This exposes
     *  the real IP to the query and result hosts — a deanonymization warning is always shown in the
     *  chat stream when it fires. Off by default; the Tor-only path is never weakened by this flag. */
    webSearchClearnet: boolean;
    /** When clearnet is enabled, whether it runs as a FALLBACK (Tor first; clearnet only on an empty
     *  Tor result — the default, safer) or FIRST (skip Tor; query clearnet DDG directly — faster but
     *  exposes the real IP on every search). Meaningful only when webSearchClearnet is true and the
     *  selected engine has a clearnet path (DDG). Default 'fallback'. */
    webSearchClearnetMode: 'fallback' | 'first';
    /** One-time acknowledgment that opening a link from Q's replies launches the default browser
     *  over the clearnet, exposing the real IP (not Tor). False until the user confirms the first
     *  clearnet-link warning; once true, subsequent link clicks open directly. Default false. */
    linkClearnetAcknowledged: boolean;
    /** Selected web-search engine id for Q's `[SEARCH:]` directive — resolved through the
     *  `SEARCH_ENGINES` registry (`web-search/registry.ts`). Ships `'ddg'` (DuckDuckGo onion) and
     *  `'searxng'` (SearXNG onion metasearch); an unknown id falls back to DDG. Default `'ddg'`. */
    searchEngine: string;
    /** SearXNG onion instance URL used when `searchEngine === 'searxng'`. Default is the operator's
     *  verified pinned instance (`DEFAULT_SEARXNG_ONION`); operator-editable, `.onion`-enforced
     *  fail-closed (a non-onion endpoint returns `[]` and never fetches). */
    searxngOnion: string;
  };
  mail: {
    accounts: { id: string; label: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number; user: string; secureRef: string | null }[];
  };
  /** Poll configured mail accounts in the background (even when the Mail window is closed).
   *  Opt-in (default off) — when on, the app makes periodic IMAP fetches while running. */
  mailBackgroundCheck: boolean;
  browser: {
    homepage: string;
  };
  media: {
    /** Opt-in egress gate for the Jukebox. When false (default) the player never
     *  resolves a remote stream URL. App-layer enforced (see Jukebox spec). */
    streamingEnabled: boolean;
    /** Show the spectrum visualizer in the Jukebox. */
    visualizer: boolean;
    /** Jukebox opens in the compact (deck-only) view by default; the caret expands it to the file
     *  toolbar + Library/Stations. Persists the user's last choice. Default false = compact. */
    jukeboxExpanded: boolean;
    /** Jukebox shade state: strip (deck only) → deck (+playlist) → full (+stations drawer). */
    jukeboxMode: JukeboxMode;
    /** 10-band graphic EQ. enabled=false ⇒ flat/transparent. gains are dB per EQ_BANDS index. */
    eq: { enabled: boolean; gains: number[]; preset: string };
  };
  geoint: {
    /** Master opt-in egress gate for GeoINT. When false (default) no feed is fetched
     *  and the map loads no tiles. App-layer enforced (see GeoINT spec). */
    networkEnabled: boolean;
    /** User-configured raster tile server URL template (e.g. https://.../{z}/{x}/{y}.png). */
    tileServerUrl: string;
    tileAttribution: string;
    /** Active basemap. 'street' uses tileServerUrl (default OSM); 'satellite' uses a built-in
     *  Esri World Imagery layer. Either way, tiles load only when networkEnabled is on. */
    basemap: 'street' | 'satellite';
    /** Live News video playlist (R12). User-managed list of news streams; HLS plays via hls.js,
     *  YouTube via a sandboxed youtube-nocookie.com iframe. Like every GeoINT egress, nothing loads
     *  unless networkEnabled is on. */
    newsStreams: { label: string; url: string; kind: 'hls' | 'youtube' }[];
    /** Index of the active stream in newsStreams. */
    newsStreamIndex: number;
    /** When true, CCTV *stream playback* in EyeSpy is routed through the ga98cctv:// main-side Tor
     *  proxy. A camera that cannot be reached over Tor will not load (no clearnet fallback).
     *  Off by default — live video over Tor is slow. Governs only the media stream, NOT the
     *  separate host-resolution recon step (see cctvResolveHosts). */
    cctvOverTor: boolean;
    /** When true, CCTV *host resolution* (the DoH + RDAP recon lookups that resolve a camera's
     *  hostname/IP and registration — an act that reveals interest in that specific camera) is
     *  performed strictly over Tor. This is a DISTINCT step from stream routing (cctvOverTor):
     *  it runs for both stream-driven playback and the standalone Host Info lookup. When false,
     *  host resolution is disabled entirely — it NEVER falls back to a clearnet lookup, since a
     *  clearnet resolve would leak the operator's real IP to the camera's DNS/registry path.
     *  On by default (resolution is cheap and Tor-safe, unlike live video). */
    cctvResolveHosts: boolean;
    /** When true, CCTV *host resolution* is performed over CLEARNET instead of Tor — opt-in, off by
     *  default. Only consulted when cctvResolveHosts is on. A clearnet DoH/RDAP lookup exposes the
     *  operator's real IP to Cloudflare/rdap.org and reveals which cameras are being investigated;
     *  the UI requires an explicit acknowledgement (cctvResolveClearnetAck) before first enabling it
     *  and shows a persistent warning whenever a lookup used clearnet. */
    cctvResolveClearnet: boolean;
    /** One-time acknowledgement that clearnet resolution exposes the real IP (mirrors the link/web-search
     *  clearnet consent). Set true when the user confirms the warning; gates re-prompting. */
    cctvResolveClearnetAck: boolean;
  };
  markets: {
    /** Master opt-in egress gate for the Markets module. Off by default ⇒ no quote is fetched. */
    networkEnabled: boolean;
    /** User watchlist — the symbols/ids tracked per class. Fully user-editable. */
    watchlist: {
      crypto: string[];   // CoinGecko ids, e.g. bitcoin, ethereum, monero
      fx: string[];       // quote currencies vs USD base, e.g. EUR, GBP, JPY
      symbols: string[];  // Yahoo/Stooq tickers: indices (^GSPC), equities (AAPL), commodities (GC=F)
    };
    /** User-added data feeds (trusted HTTPS endpoints returning a generic quote JSON shape). */
    customFeeds: { id: string; label: string; url: string }[];
  };
  /** P2P chat (Tor onion). Off by default ⇒ tor is never spawned and no onion is published.
   *  PQ-hybrid handshake, formally verified internally (symbolic + computational); independent
   *  external audit + FIPS module remain the only unmet gates. */
  chat: {
    networkEnabled: boolean;
  };
  /** Signed-plugin registry. Keys are plugin IDs; values carry per-plugin flags and
   *  free-form settings. Empty by default — no plugins are bundled. */
  plugins: Record<string, { enabled: boolean; networkEnabled: boolean; settings?: Record<string, unknown> }>;
  /** Authorized-target offensive operations. All actions remain gated behind operator
   *  confirmation; this block carries the policy for how that gate behaves. */
  offensive: {
    confirmMode: 'per-scan' | 'per-session';
    rateLimitPerSec: number;
    downstreamProxy?: string | null;
    requireSignedAuthorization: boolean;
    issuerKeys?: { keyId: string; edPubHex: string; pqPubHex: string }[];
  };
  /** Persistent background connection policy. Controls idle teardown, routing,
   *  reconnect bounds, and maximum session age. */
  bgconn: {
    /** Minutes of inactivity before the connection is torn down. null = never. */
    idleTeardownAfterMinutes: number | null;
    defaultRouting: 'tor' | 'direct';
    maxReconnects: number;
    maxSessionAgeMinutes: number;
  };
  searchlight: {
    /** Master opt-in egress gate. Off by default ⇒ no probe is sent. */
    networkEnabled: boolean;
    /** Concurrent probes over Tor (slower exits) and over clearnet. */
    torConcurrency: number;
    clearnetConcurrency: number;
    /** Structural + ML detection scorer configuration. */
    scorer: {
      /** Override the model's found-threshold (null = use model default). */
      foundThreshold: number | null;
      /** Override the model's maybe-floor threshold (null = use model default). */
      maybeFloor: number | null;
      /** When true, phase-2 body fetch (deep scan) is suppressed for faster sweeps. */
      lightweightMode: boolean;
      /** When true, blend heuristic score with ML model prediction. */
      useMl: boolean;
    };
  };
  /** SOCMINT collector (Telegram v1). Off by default ⇒ no egress is initiated,
   *  no collector is constructed, and no Tor circuit is requested. */
  socmint: {
    /** Master opt-in egress gate. When false (default) no collector connects and
     *  no Tor circuit is requested. App-layer enforced at the IPC boundary. */
    networkEnabled: boolean;
    /** Collector transport when networkEnabled. 'direct' = clearnet (DEFAULT; scope is
     *  public-channel OSINT, not darkweb). 'tor' = route via bgconn Tor with per-burner
     *  IsolateSOCKSAuth circuit isolation. ALWAYS explicit — the app never silently
     *  switches/falls back between them; in 'tor' mode a down Tor REFUSES, not clearnet. */
    transport: 'direct' | 'tor';
    /** Telegram engine config (Plan B). The mtcute client was replaced by the Tor-fail-closed
     *  authenticated-Telegram-Web VISIBLE-CAPTURE engine. Fixed-shape nested block — MUST be
     *  deep-merged in mergeSettings so an older persisted socmint block that predates it keeps
     *  the key on upgrade (v3.24.0 dataloss class). WhatsApp settings are unaffected. */
    telegram: {
      /** The Telegram collection engine. 'capture' = the Tor-fail-closed authenticated
       *  Telegram Web visible-capture engine (the only value today; supersedes mtcute). */
      engine: 'capture';
      /** Capture avatars/media to LOCAL `data:` thumbnails at collect time (never a remote
       *  URL). Off by default — the operator opts media capture in. */
      captureMedia: boolean;
    };
  };
  /** Reports module: the default author seeded onto a newly created report. Nested
   *  fixed-shape block — MUST be deep-merged in mergeSettings so an older persisted
   *  settings block that predates it keeps the key on upgrade (v3.24.0 dataloss class). */
  reports?: { author?: string };
  /** X Listening Station capture toggles. All OFF by default — capture is minimal until the
   *  operator opts each kind in. Nested fixed-shape block (with a nested `collect` sub-block);
   *  BOTH levels MUST be deep-merged in mergeSettings so a settings.json predating a sub-field
   *  heals instead of dropping it (v3.24.0 dataloss class). */
  xListening: {
    /** Which surrounding-thread kinds to capture alongside a target's own posts. */
    collect: { replies: boolean; reposts: boolean; comments: boolean };
    /** Enable bounded, low-rate archive cycles (off by default). */
    archiveCycles: boolean;
    /** Tor-default network posture opt-out. False (default) ⇒ capture is Tor-routed and FAILS
     *  CLOSED when background Tor is not bootstrapped (no clearnet fallback — session.ts).
     *  True ⇒ capture drops to clearnet (the operator's own IP, no proxy); the renderer gates
     *  the FIRST flip to true behind a one-time real-IP acknowledgement (Task 13, mirrors
     *  `ai.linkClearnetAcknowledged` / `geoint.cctvResolveClearnetAck`) before persisting it —
     *  this flag itself is trusted by session.ts as already-acknowledged. A top-level scalar
     *  inside the already-deep-merged `xListening` block, so an old settings.json that predates
     *  this field heals to `false` on upgrade with no extra mergeSettings work. */
    clearnet: boolean;
    /** One-time real-IP acknowledgement gate for `clearnet` (Task 13), mirroring
     *  `geoint.cctvResolveClearnetAck`: the renderer shows the warning confirm dialog only on
     *  the FIRST false→true flip while this is false, then persists it true so re-toggling
     *  clearnet on/off later in the same or a future session never re-prompts. Same top-level-
     *  scalar healing as `clearnet` — no extra mergeSettings work needed. */
    clearnetAck: boolean;
  };
  /** Weather tool egress + units posture (OURS — design spec 2026-08-15). A fixed-shape nested block;
   *  MUST be deep-merged in mergeSettings so a settings.json predating it (or predating a future
   *  sub-field) heals to the default instead of dropping the block (v3.24.0 dataloss class). */
  weather: {
    /** Persisted default-posture flag (default true = Tor). Surfaced by the TOR/CLEARNET marker; the
     *  ENFORCED "leave Tor" decision is `clearnet && clearnetAck` (client.ts `resolveWeatherEgress`),
     *  so this flag alone can never route over the real IP. */
    torDefault: boolean;
    /** Clearnet egress opt-out of Tor. False (default) ⇒ fetches are Tor-routed and FAIL CLOSED when
     *  background Tor is not bootstrapped (no clearnet fallback). True + `clearnetAck` ⇒ direct fetch
     *  over the operator's real IP. The renderer gates the FIRST flip behind a one-time real-IP
     *  acknowledgement (mirrors `xListening.clearnet` / `geoint.cctvResolveClearnetAck`). */
    clearnet: boolean;
    /** One-time real-IP acknowledgement gate for `clearnet` (mirrors `xListening.clearnetAck`). */
    clearnetAck: boolean;
    /** Units preference for forecasts. Persisted here so the renderer's toggle survives a restart even
     *  before the store file exists; the weather store mirrors it as the read source of truth. */
    units: Units;
  };
}

export const defaultShortcuts: AccessShortcut[] = [
  { id: 'cases', label: 'My Cases', kind: 'module', target: 'cases', icon: 'folder' },
  { id: 'notepad', label: 'Notepad 98', kind: 'module', target: 'notepad', icon: 'note' },
  { id: 'briefcase', label: 'Briefcase', kind: 'module', target: 'briefcase', icon: 'briefcase' },
  { id: 'journal', label: 'Journal Jots', kind: 'module', target: 'journal', icon: 'note' },
  { id: 'browser', label: 'Net Explorer', kind: 'module', target: 'net-explorer', icon: 'globe' },
  { id: 'mail', label: 'Mail', kind: 'module', target: 'mail', icon: 'mail' },
  { id: 'dialterm', label: 'DialTerm', kind: 'module', target: 'dialterm', icon: 'modem' },
  { id: 'eyespy', label: 'EyeSpy', kind: 'module', target: 'eyespy', icon: 'cam' },
  { id: 'media-player', label: 'Jukebox', kind: 'module', target: 'media-player', icon: 'music' },
  { id: 'geoint', label: 'GeoINT', kind: 'module', target: 'geoint', icon: 'globe' },
  { id: 'searchlight', label: 'Searchlight', kind: 'module', target: 'searchlight', icon: 'search' },
  { id: 'bookmarks', label: 'Bookmarks', kind: 'module', target: 'bookmarks', icon: 'bookmark' },
  { id: 'markets', label: 'Markets', kind: 'module', target: 'markets', icon: 'chart' },
  { id: 'calendar', label: 'Calendar', kind: 'module', target: 'calendar', icon: 'calendar' },
  { id: 'reminders', label: 'Reminders', kind: 'module', target: 'reminders', icon: 'bell' },
  { id: 'alarm', label: 'Alarm', kind: 'module', target: 'alarm', icon: 'alarm' },
  { id: 'ai', label: 'Q', kind: 'module', target: 'ai-assistant', icon: 'sparkle' },
  { id: 'chat', label: 'Chat (beta)', kind: 'module', target: 'chat', icon: 'chat' },
  { id: 'search', label: 'Search', kind: 'module', target: 'search', icon: 'search' },
  { id: 'invoices', label: 'Ghost Ledger 98', kind: 'module', target: 'invoices', icon: 'note' },
  { id: 'help', label: 'RTFM', kind: 'module', target: 'help', icon: 'help' }
  // Games (Solitaire/Minesweeper/Chess/Pinball) are surfaced via the Access "Games ▸" submenu, not
  // as desktop/flat shortcuts — see AccessMenu.tsx.
  // Settings is always available via the Access menu footer ("Settings…"), so it is
  // intentionally NOT a duplicate editable shortcut here.
];

/** Built-in module shortcuts that every install should carry. Used by the settings
 *  reconciler to repair installs whose persisted shortcuts predate a module's release
 *  (e.g. Jukebox/GeoINT were registered as modules but never seeded into older
 *  settings.json), and to migrate the legacy "Help" label to "RTFM". Appends only —
 *  it never removes a shortcut the user deleted on purpose, except by relabel. */
export const REQUIRED_MODULE_SHORTCUTS: readonly AccessShortcut[] = [
  { id: 'media-player', label: 'Jukebox', kind: 'module', target: 'media-player', icon: 'music' },
  { id: 'geoint', label: 'GeoINT', kind: 'module', target: 'geoint', icon: 'globe' },
  { id: 'searchlight', label: 'Searchlight', kind: 'module', target: 'searchlight', icon: 'search' },
  { id: 'bookmarks', label: 'Bookmarks', kind: 'module', target: 'bookmarks', icon: 'bookmark' },
  { id: 'briefcase', label: 'Briefcase', kind: 'module', target: 'briefcase', icon: 'briefcase' },
  { id: 'journal', label: 'Journal Jots', kind: 'module', target: 'journal', icon: 'note' },
  { id: 'markets', label: 'Markets', kind: 'module', target: 'markets', icon: 'chart' },
  { id: 'socmint', label: 'SOCMINT', kind: 'module', target: 'socmint', icon: 'search' },
  { id: 'invoices', label: 'Ghost Ledger 98', kind: 'module', target: 'invoices', icon: 'note' },
  { id: 'chat', label: 'Chat (beta)', kind: 'module', target: 'chat', icon: 'chat' }
  // Games are in the Access "Games ▸" submenu (AccessMenu.tsx), not seeded as shortcuts.
];

/** Repairs a persisted shortcut list (returns NEW arrays, never mutates inputs):
 *  - renames the legacy default "Help" entry to "RTFM" (only if still the default label),
 *  - seeds any REQUIRED_MODULE_SHORTCUTS missing by target — but ONLY ONCE. `seeded` records
 *    which required targets have already been introduced; a module the user then deletes stays
 *    deleted (it's in `seeded` but absent), instead of being force-re-added every launch.
 *  Returns the updated `seededShortcuts` to persist alongside. */
export function reconcileShortcuts(
  shortcuts: AccessShortcut[],
  seeded: string[] = []
): { shortcuts: AccessShortcut[]; seededShortcuts: string[] } {
  const next = shortcuts.map((s) => {
    // One-time label normalizations: rewrite ONLY the exact old default string, so a
    // user's custom rename is preserved. Same pattern as the Help → RTFM rename.
    if (s.kind === 'module' && s.target === 'help' && s.label === 'Help') return { ...s, label: 'RTFM' };
    if (s.kind === 'module' && s.target === 'cases' && s.label === 'Case Files') return { ...s, label: 'My Cases' };
    if (s.kind === 'module' && s.target === 'ai-assistant' && s.label === 'AI Assistant') return { ...s, label: 'Q' };
    return s;
  });
  const seen = new Set(seeded);
  for (const req of REQUIRED_MODULE_SHORTCUTS) {
    const present = next.some((s) => s.kind === 'module' && s.target === req.target);
    if (present) { seen.add(req.target); continue; }
    if (seen.has(req.target)) continue; // seeded once, user removed it → respect the deletion
    next.push({ ...req });
    seen.add(req.target);
  }
  return { shortcuts: next, seededShortcuts: [...seen] };
}

export const defaultSettings: AppSettings = {
  soundEnabled: true,
  themeIntensity: 'classic',
  themeName: 'classic',
  wallpaperColor: '#008080',
  wallpaperImage: null,
  buttonColor: '',
  buttonColorPresets: [],
  bootSplashImage: null,
  startupSoundEnabled: true,
  legacySounds: false,
  caseFolderOverride: null,
  hasSeenWelcome: false,
  hasSeenSearchlightIntro: false,
  caseSortBy: 'updatedAt',
  caseSortDir: 'desc',
  caseCategoryCollapsed: {},
  shortcuts: defaultShortcuts,
  seededShortcuts: [],
  localShellEnabled: false,
  localShellProgram: 'cmd',
  ai: {
    provider: 'none',
    endpoint: 'http://localhost:11434',
    model: 'qwen3-abliterated:4b',
    defaultSystemPrompt: 'You are Q, an investigative case-management assistant. Use only the case data the user has explicitly shared. Be concise.',
    formattedOutput: true,
    apiKeyRef: null,
    ttsEnabled: false,
    ttsVoiceUri: null,
    ttsRate: 1,
    ttsEngine: 'auto',
    piperVoice: null,
    useMemory: true,
    autoReindex: true,
    adaptiveMemory: false,
    webSearch: false,
    webSearchClearnet: false,
    webSearchClearnetMode: 'fallback',
    linkClearnetAcknowledged: false,
    searchEngine: 'ddg',
    // Mirrors DEFAULT_SEARXNG_ONION in src/main/services/web-search/searxng.ts (shared/ must not
    // import from main/); the settings-merge test asserts the two stay in sync.
    searxngOnion: 'http://searxokthnxmo7ndis35jpts2tawcwvbovuy47qtavwo7oq4jgcm5gqd.onion'
  },
  mail: { accounts: [] },
  mailBackgroundCheck: false,
  browser: { homepage: 'about:blank' },
  media: { streamingEnabled: false, visualizer: true, jukeboxExpanded: false,
           jukeboxMode: 'strip', eq: { enabled: false, gains: [0,0,0,0,0,0,0,0,0,0], preset: 'Flat' } },
  geoint: {
    networkEnabled: false,
    tileServerUrl: '',
    tileAttribution: '',
    basemap: 'street',
    newsStreams: [{ label: 'Bloomberg TV', url: 'https://www.bloomberg.com/media-manifest/streams/us.m3u8', kind: 'hls' }],
    newsStreamIndex: 0,
    cctvOverTor: false,
    cctvResolveHosts: true,
    cctvResolveClearnet: false,
    cctvResolveClearnetAck: false
  },
  markets: {
    networkEnabled: false,
    watchlist: {
      crypto: ['bitcoin', 'ethereum', 'monero'],
      fx: ['EUR', 'GBP', 'JPY'],
      symbols: ['^GSPC', 'AAPL', 'GC=F']
    },
    customFeeds: []
  },
  chat: { networkEnabled: false },
  searchlight: { networkEnabled: false, torConcurrency: 8, clearnetConcurrency: 16, scorer: { foundThreshold: null, maybeFloor: null, lightweightMode: false, useMl: false } },
  socmint: { networkEnabled: false, transport: 'direct', telegram: { engine: 'capture', captureMedia: false } },
  reports: { author: '' },
  xListening: {
    collect: { replies: false, reposts: false, comments: false },
    archiveCycles: false,
    clearnet: false,
    clearnetAck: false
  },
  weather: {
    torDefault: true,
    clearnet: false,
    clearnetAck: false,
    units: 'metric'
  },
  plugins: {},
  offensive: { confirmMode: 'per-scan', rateLimitPerSec: 10, downstreamProxy: null, requireSignedAuthorization: false, issuerKeys: [] },
  bgconn: { idleTeardownAfterMinutes: 120, defaultRouting: 'tor', maxReconnects: 20, maxSessionAgeMinutes: 720 }
};
