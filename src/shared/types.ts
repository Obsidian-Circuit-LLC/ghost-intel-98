/**
 * Shared types crossing the IPC boundary.
 * Imported by both main and renderer processes.
 */

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
  repeat?: 'none' | 'daily' | 'weekly';
  fired?: boolean;
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
  | 'organisation' | 'social-profile' | 'vehicle' | 'location' | 'crypto-wallet' | 'other';

export const ENTITY_TYPES: readonly EntityType[] = [
  'person', 'alias', 'email', 'phone', 'domain', 'ip',
  'organisation', 'social-profile', 'vehicle', 'location', 'crypto-wallet', 'other'
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
}

export interface SearchHit { field: string; snippet: string }
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

export interface AppSettings {
  soundEnabled: boolean;
  themeIntensity: 'lite' | 'classic' | 'maximum';
  /** Desktop background colour (CSS hex). Defaults to the classic Win98 teal. */
  wallpaperColor: string;
  /** Optional desktop background image as a data: URI (covers the colour when set). */
  wallpaperImage: string | null;
  startupSoundEnabled: boolean;
  /** Opt-in "Legacy sound pack": when true, the startup chime and DialTerm dial-up use bundled
   *  AI-reworked recordings of the classic Windows jingle + dial-up handshake instead of the
   *  default synthesized sounds. Off by default. */
  legacySounds: boolean;
  caseFolderOverride: string | null;
  hasSeenWelcome: boolean;
  caseSortBy: 'updatedAt' | 'createdAt' | 'priority' | 'status' | 'title';
  caseSortDir: 'asc' | 'desc';
  shortcuts: AccessShortcut[];
  /** Targets of REQUIRED_MODULE_SHORTCUTS that have been seeded into `shortcuts` at least once.
   *  Lets the reconciler introduce new built-in modules to existing installs exactly once,
   *  without re-adding a shortcut the user later deletes. */
  seededShortcuts: string[];
  ai: {
    provider: 'ollama' | 'openai-compatible' | 'none';
    endpoint: string;
    model: string;
    defaultSystemPrompt: string;
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
  };
  mail: {
    accounts: { id: string; label: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number; user: string; secureRef: string | null }[];
  };
  browser: {
    homepage: string;
  };
  media: {
    /** Opt-in egress gate for the Jukebox. When false (default) the player never
     *  resolves a remote stream URL. App-layer enforced (see Jukebox spec). */
    streamingEnabled: boolean;
    /** Show the spectrum visualizer in the Jukebox. */
    visualizer: boolean;
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
  /** EXPERIMENTAL P2P chat (Tor onion). Off by default ⇒ tor is never spawned and no onion is
   *  published. The handshake crypto is pending formal verification — see the in-app banner. */
  chat: {
    networkEnabled: boolean;
  };
}

export const defaultShortcuts: AccessShortcut[] = [
  { id: 'cases', label: 'My Cases', kind: 'module', target: 'cases', icon: 'folder' },
  { id: 'notepad', label: 'Notepad 98', kind: 'module', target: 'notepad', icon: 'note' },
  { id: 'briefcase', label: 'Briefcase', kind: 'module', target: 'briefcase', icon: 'briefcase' },
  { id: 'browser', label: 'Net Explorer', kind: 'module', target: 'net-explorer', icon: 'globe' },
  { id: 'mail', label: 'Mail', kind: 'module', target: 'mail', icon: 'mail' },
  { id: 'dialterm', label: 'DialTerm', kind: 'module', target: 'dialterm', icon: 'modem' },
  { id: 'eyespy', label: 'EyeSpy', kind: 'module', target: 'eyespy', icon: 'cam' },
  { id: 'media-player', label: 'Jukebox', kind: 'module', target: 'media-player', icon: 'music' },
  { id: 'geoint', label: 'GeoINT', kind: 'module', target: 'geoint', icon: 'globe' },
  { id: 'bookmarks', label: 'Bookmarks', kind: 'module', target: 'bookmarks', icon: 'bookmark' },
  { id: 'calendar', label: 'Calendar', kind: 'module', target: 'calendar', icon: 'calendar' },
  { id: 'reminders', label: 'Reminders', kind: 'module', target: 'reminders', icon: 'bell' },
  { id: 'alarm', label: 'Alarm', kind: 'module', target: 'alarm', icon: 'alarm' },
  { id: 'ai', label: 'AI Assistant', kind: 'module', target: 'ai-assistant', icon: 'sparkle' },
  { id: 'search', label: 'Search', kind: 'module', target: 'search', icon: 'search' },
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
  { id: 'bookmarks', label: 'Bookmarks', kind: 'module', target: 'bookmarks', icon: 'bookmark' },
  { id: 'briefcase', label: 'Briefcase', kind: 'module', target: 'briefcase', icon: 'briefcase' }
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
  wallpaperColor: '#008080',
  wallpaperImage: null,
  startupSoundEnabled: true,
  legacySounds: false,
  caseFolderOverride: null,
  hasSeenWelcome: false,
  caseSortBy: 'updatedAt',
  caseSortDir: 'desc',
  shortcuts: defaultShortcuts,
  seededShortcuts: [],
  ai: {
    provider: 'none',
    endpoint: 'http://localhost:11434',
    model: 'qwen3-abliterated:4b',
    defaultSystemPrompt: 'You are an investigative case-management assistant. Use only the case data the user has explicitly shared. Be concise.',
    apiKeyRef: null,
    ttsEnabled: false,
    ttsVoiceUri: null,
    ttsRate: 1,
    ttsEngine: 'auto'
  },
  mail: { accounts: [] },
  browser: { homepage: 'about:blank' },
  media: { streamingEnabled: false, visualizer: true },
  geoint: { networkEnabled: false, tileServerUrl: '', tileAttribution: '', basemap: 'street' },
  markets: {
    networkEnabled: false,
    watchlist: {
      crypto: ['bitcoin', 'ethereum', 'monero'],
      fx: ['EUR', 'GBP', 'JPY'],
      symbols: ['^GSPC', 'AAPL', 'GC=F']
    },
    customFeeds: []
  },
  chat: { networkEnabled: false }
};
