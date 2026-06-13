/**
 * Types added for the v1.0.0 modules (Mail / DialTerm / EyeSpy / AI Assistant).
 * Kept in a separate file so the v0.1.0 surface stays grokable.
 */

import type { CaseId } from './types';

// ---------- Mail ----------

export interface MailAccount {
  id: string;
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  user: string;
  /** Reference into secrets.enc for the IMAP/SMTP password. Never the password itself. */
  passwordRef: string;
}

export interface MailMessageSummary {
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  preview: string;
  unseen: boolean;
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  size: number;
  /** Base64-encoded content. Only populated on demand for inbound mail. */
  contentBase64?: string;
}

export interface MailMessage extends MailMessageSummary {
  body: string;
  html?: string;
  attachments: MailAttachment[];
}

export interface MailSendAttachment {
  /** Absolute path on disk to attach. */
  path: string;
  /** Optional override filename — defaults to basename(path). */
  filename?: string;
}

export interface MailSendInput {
  accountId: string;
  to: string;
  subject: string;
  body: string;
  attachments?: MailSendAttachment[];
}

// ---------- DialTerm (SSH) ----------

export type SshAuthKind = 'password' | 'key';

/** DialTerm transport. 'ssh' + 'telnet' are terminal sessions; 'ftp' opens a file browser. */
export type DialTermProtocol = 'ssh' | 'telnet' | 'ftp';

export interface SshHostProfile {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  authKind: SshAuthKind;
  /** Absolute path to a private key file on disk. Empty for password auth. */
  keyPath: string;
  /** Reference into secrets.enc for password OR key passphrase. Never the secret itself. */
  secretRef: string;
  /** Transport. Optional for backward-compat — legacy profiles without it are treated as 'ssh'. */
  protocol?: DialTermProtocol;
}

export interface SshConnectResult {
  sessionId: string;
}

export interface FtpEntry {
  name: string;
  type: 'file' | 'dir' | 'link' | 'other';
  size: number;
  modifiedAt?: string;
}

export interface FtpListing {
  cwd: string;
  entries: FtpEntry[];
}

export interface FtpConnectResult extends FtpListing {
  sessionId: string;
}

// ---------- EyeSpy ----------

export type StreamKind = 'hls' | 'mjpeg' | 'rtsp' | 'http' | 'mp4';

export interface CameraStream {
  id: string;
  label: string;
  url: string;
  kind: StreamKind;
  caseId: CaseId | null;
  addedAt: string;
  notes: string;
  // ---- Optional geo metadata ----
  // Populated opportunistically when a stream is imported (the corpus pull supplies it where
  // known). Carried here so the library can be grouped/searched by location later WITHOUT
  // re-tagging the corpus. All optional; absent keys are simply not written. No code path
  // derives these by probing the network — they come only from the imported feed list.
  country?: string;
  region?: string;
  city?: string;
  lat?: number;
  lon?: number;
  /** Provenance: the dataset/feed name this stream was pulled from. */
  source?: string;
}

export interface Wall {
  id: string;
  name: string;
  slots: (string | null)[]; // fixed length 9; each is a CameraStream id or null (empty)
  createdAt: string;
  updatedAt: string;
  // ---- Optional location category ----
  // The wall's Country→State/Region→City scope, entered in the Wall Setup dialog. Names the board
  // and is the category an "Import CCTV file into this category" stamps imported feeds under. All
  // optional; absent/blank keys are simply not written (mirrors CameraStream geo + streams pickGeo).
  country?: string;
  region?: string;
  city?: string;
}

// ---------- Jukebox (media player) ----------

export interface MediaTrack {
  /** Absolute path on disk. Served only via ga98media:// after authorization. */
  path: string;
  /** fs mtimeMs at index time (used to skip re-parsing unchanged files). */
  mtime: number;
  size: number;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  /** Filename of cached cover art under media-art/, if the file had embedded art. */
  artRef?: string;
}

export interface MediaStation {
  id: string;
  label: string;
  url: string;
}

export interface MediaLibrarySnapshot {
  roots: string[];
  tracks: MediaTrack[];
  stations: MediaStation[];
}

// ---------- GeoINT ----------

export type GeoSourceType = 'rss' | 'atom' | 'geojson';

export interface GeoSource {
  id: string;
  label: string;
  url: string;
  type: GeoSourceType;
  enabled: boolean;
  lastFetched?: string;
  lastError?: string;
}

export interface GeoItem {
  id: string;
  sourceId: string;
  title: string;
  link?: string;
  summary?: string;
  published?: string;
  lat?: number;
  lon?: number;
  /** Matched gazetteer place name when located:'gazetteer' (drives the auto location-entity). */
  place?: string;
  /** How this item got its coordinates (if any). */
  located: 'geo' | 'gazetteer' | 'manual' | 'none';
}

export interface GeoSnapshot {
  sources: GeoSource[];
  items: GeoItem[];
}

export interface SavedGeoEvent extends GeoItem {
  /** When this event was saved into a case (ISO). */
  savedAt: string;
}

// ---------- AI Assistant ----------

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiChatRequest {
  /** Concatenated context to prepend (typically: selected case bundle). */
  context?: string;
  messages: AiChatMessage[];
}

/** A saved AI conversation (ChatGPT-style memory). Persisted under dataRoot, encrypted at rest
 *  when login is on. The renderer sends {id,title,messages}; the store stamps the timestamps. */
export interface AiConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AiChatMessage[];
}

/** Lightweight row for the conversation sidebar — full messages fetched on open. */
export interface AiConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

/** What the renderer sends to persist a conversation (timestamps managed by the store). */
export interface AiConversationInput {
  id: string;
  title: string;
  messages: AiChatMessage[];
}

// ---------- Bookmarks dashboard (offline start.me-style board) ----------

/** A single saved link inside a category. Icon resolution at render: `emoji` if set →
 *  `favicon` (cached data-URI, fetched only when network is enabled) → default glyph. */
export interface BookmarkLink {
  id: string;
  name: string;
  url: string;
  /** User-chosen emoji icon (offline). */
  emoji?: string;
  /** Cached favicon as a data: URI (only populated when the user fetches it with network on). */
  favicon?: string;
}

/** A category card (start.me "widget"): a titled, ordered list of links. */
export interface BookmarkCategory {
  id: string;
  title: string;
  links: BookmarkLink[];
  /** User-set height (px) of the card's link area. Undefined = auto (fits its links). The card
   *  is resizable, so a sparse category can be shortened and others stack beneath it in column. */
  height?: number;
}

/** The whole dashboard. Persisted under dataRoot, encrypted at rest when login is enabled.
 *  Exported/imported as a portable .ghostbookmarks file for sharing between users. */
export interface BookmarkBoard {
  categories: BookmarkCategory[];
  /** Off by default. Gates favicon fetching (the only network egress this module can do). */
  networkEnabled: boolean;
}

// ── Markets ──────────────────────────────────────────────────────────────────
/** Asset class for a market quote (drives grouping + symbol classification). */
export type MarketClass = 'crypto' | 'fx' | 'equity' | 'index' | 'commodity' | 'custom';

/** A normalized quote — provider responses (CoinGecko/Frankfurter/Stooq/Yahoo/custom) are all
 *  mapped to this shape so the UI is provider-agnostic. price/change may be null when a source
 *  doesn't supply them (we never fabricate a number). */
export interface MarketQuote {
  symbol: string;
  label: string;
  price: number | null;
  change: number | null;     // absolute change vs prior close/open
  changePct: number | null;  // percent change
  klass: MarketClass;
  source: string;            // provider name, for attribution
  asOf?: string;
}

/** A user-added data feed: a trusted HTTPS endpoint returning a generic quote JSON shape
 *  (array of {symbol,price,change?,changePct?,label?} or {quotes:[...]}). */
export interface MarketCustomFeed { id: string; label: string; url: string }

export interface MarketSnapshot {
  quotes: MarketQuote[];
  errors: string[];          // per-source non-fatal failures, surfaced in the UI
  fetchedAt: string;
}

// ── Sticky notes ─────────────────────────────────────────────────────────────
/** A Win95-style desktop sticky note: draggable, typed text, a chosen icon + color.
 *  Persisted under dataRoot (encrypted at rest when login is on) so the desktop survives
 *  restarts. A note spawned by a fired reminder carries `reminderId`; its OK button completes
 *  (deletes) that reminder. The desktop is OpSec-sensitive — these never leave the machine. */
export interface StickyNote {
  id: string;
  text: string;
  /** Emoji glyph from the picker allowlist (validator-bounded). */
  icon: string;
  /** Palette key: 'yellow' | 'pink' | 'blue' | 'green' | 'white'. */
  color: string;
  x: number;
  y: number;
  /** Optional user-resized dimensions (px). Absent ⇒ the CSS default size is used. */
  w?: number;
  h?: number;
  /** Present when this note represents a fired global reminder — OK marks it complete. */
  reminderId?: string;
}

/** The whole sticky-note desktop layer. `hidden` is the global Hide toggle (persisted). */
export interface StickyNotesState {
  notes: StickyNote[];
  hidden: boolean;
}

// ── Briefcase ────────────────────────────────────────────────────────────────
/** A standalone text note not tied to any case — saved from Notepad 98 when no case is
 *  selected. Persisted under dataRoot, encrypted at rest when login is on; zero network. */
export interface BriefcaseNote {
  id: string;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight row for the Briefcase list — body fetched on open. */
export interface BriefcaseNoteSummary { id: string; name: string; updatedAt: string; bytes: number }

/** What the renderer sends to persist a briefcase note (timestamps managed by the store). */
export interface BriefcaseNoteInput { id: string; name: string; body: string }
