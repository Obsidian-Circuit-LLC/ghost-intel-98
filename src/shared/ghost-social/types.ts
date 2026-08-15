/**
 * Ghost Social Media Manager (hardened GI98 port) — shared types.
 *
 * Ported from GhostExodus's `src/types.ts` + `electron/core/types.ts` (quarantine
 * `social-mgr-quar/ghost-social-media-manager/`), merged into one shared surface the
 * main process, preload, and (Phase 4) renderer all import. His behaviour is reproduced
 * faithfully; the hardening additions are marked:
 *   - `SocialAccount.torEnabled` — G8 per-account egress toggle (clearnet DEFAULT, Tor opt-in).
 *   - `GhostState.autoPostArmed` — G7 default-OFF auto-post ARM gate (safety-critical; the
 *     scheduled queue may only auto-click Publish on a live account when this is true).
 * No colour/UI/behaviour is invented here — this is his data model, hardened.
 */

/** His nine platform keys (electron/core/types.ts). `custom` is the user-defined fallback. */
export type PlatformKey =
  | 'facebook'
  | 'messenger'
  | 'instagram'
  | 'tiktok'
  | 'linkedin'
  | 'x'
  | 'youtube'
  | 'bluesky'
  | 'custom';

/** Follower/following stats read from a profile's VISIBLE DOM (never a platform API). */
export interface AccountStats {
  followers: number | null;
  following: number | null;
  followersLabel?: string;
  followingLabel?: string;
  rawFollowers?: string;
  rawFollowing?: string;
  refreshedAt?: string;
  status?: 'ok' | 'partial' | 'unavailable' | 'error';
  message?: string;
  resolvedProfileUrl?: string;
}

/** What a platform lets an account do (drives the Composer destination affordances). */
export interface AccountCapabilities {
  text: boolean;
  image: boolean;
  video: boolean;
  messages: boolean;
  comments: boolean;
}

/**
 * One authenticated social account inside a campaign. Each account is isolated to its own
 * persistent Electron session partition (see `accountPartition`) so cookies never cross
 * accounts. `name` is his display label (kept verbatim — his UI + DOM adapters read `.name`).
 */
export interface SocialAccount {
  id: string;
  platform: PlatformKey;
  name: string;
  url: string;
  profileUrl?: string;
  username?: string;
  enabled: boolean;
  composeEnabled?: boolean;
  favicon?: string;
  stats?: AccountStats;
  capabilities: AccountCapabilities;
  /**
   * Hardening G8: per-account egress. `false`/absent ⇒ CLEARNET (the default — logged-in
   * social posting over Tor trips platform checkpoints). `true` ⇒ route this account's
   * partition over Tor (opt-in, behind a one-time warning). Persisted in the vault state.
   */
  torEnabled?: boolean;
}

/** A campaign groups a set of accounts the user fans a post out across. */
export interface Campaign {
  id: string;
  name: string;
  accounts: SocialAccount[];
  notes?: string;
  composeTileOrder?: string[];
}

/** A completed publish/fan-out, kept for the History page. */
export interface PostRecord {
  id: string;
  at: string;
  text: string;
  destinations: string[];
  status?: 'queued' | 'complete' | 'partial' | 'failed';
}

/** One destination's outcome inside a scheduled job's `results` map. */
export interface ScheduledDestinationResult {
  status: 'pending' | 'published' | 'failed' | 'unsupported';
  message?: string;
  at?: string;
}

/**
 * A scheduled queue job (his `ScheduledPost`): compose text + fire time + destination accounts,
 * with per-destination results. The scheduler ticks these; auto-clicking Publish on a due job
 * is gated by `GhostState.autoPostArmed` (G7).
 */
export interface ScheduledPost {
  id: string;
  campaignId: string;
  text: string;
  scheduledFor: string;
  destinationAccountIds: string[];
  status: 'scheduled' | 'paused' | 'running' | 'complete' | 'partial' | 'failed';
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  results?: Record<string, ScheduledDestinationResult>;
}

/** The Phase-1 task's `QueueJob` name for the scheduled-queue record — an alias of his
 *  `ScheduledPost` so both the plan vocabulary and his source vocabulary resolve. */
export type QueueJob = ScheduledPost;

export type BrowserCacheMode = 'all' | 'recent3' | 'reload';

/**
 * The module's whole persisted application state. Ported from his `defaultState` +
 * `GhostState`, plus the hardening ARM flag. Persisted encrypted-at-rest (secure-fs) and
 * additionally gated by his password vault.
 */
export interface GhostState {
  campaigns: Campaign[];
  selectedCampaignId: string;
  postHistory: PostRecord[];
  messageNotes: Array<{ id: string; accountId: string; contact: string; note: string; at: string }>;
  browserCacheMode?: BrowserCacheMode;
  scheduledPosts?: ScheduledPost[];
  /**
   * Hardening G7 (SAFETY-CRITICAL): the default-OFF master "auto-posting armed" switch. When
   * `false`/absent, the scheduler may PREPARE due jobs but MAIN refuses to click a live
   * Publish button. Only `true` (set through the one-time arm confirm) permits auto-publish.
   */
  autoPostArmed?: boolean;
}

/** Inbox item shape — the Inbox stays STUBBED (returns []); kept for type parity only. */
export interface InboxItem {
  id: string;
  accountId: string;
  platform: string;
  sender: string;
  preview: string;
  timestamp: string;
  unread: boolean;
  type: 'message' | 'comment' | 'mention';
}

/** In-memory job snapshot (his JobQueue) surfaced to the History/Jobs view. */
export interface GhostJob {
  id: string;
  type: 'refresh-stats' | 'publish' | 'inbox-refresh' | 'scheduled-publish';
  accountId?: string;
  platform?: PlatformKey;
  status: 'queued' | 'running' | 'complete' | 'failed';
  createdAt: string;
  finishedAt?: string;
  error?: string;
}

/** A per-platform DOM stat reader (adapters.ts). `extractStatsScript` returns a string of JS
 *  executed in the authenticated profile page to scrape the VISIBLE follower/following counts. */
export interface PlatformAdapter {
  key: PlatformKey;
  labels?: { followers?: string; following?: string };
  extractStatsScript(): string;
}

/** A platform's default home URL + capabilities (his `platformDefaults` map, main.ts). */
export interface PlatformDefault {
  name: string;
  url: string;
  capabilities: AccountCapabilities;
}

/** The minimal account shape the stats/publish services need (his `AccountLike`). */
export interface AccountLike {
  id: string;
  platform: PlatformKey;
  name: string;
  url: string;
  profileUrl?: string;
  username?: string;
}

/** A compose request. `mediaPath`/`mediaType` are name/type-only — media is NEVER uploaded. */
export interface PublishRequest {
  text: string;
  mediaPath?: string;
  mediaType?: string;
}

/**
 * The outcome of a publish. `prepared` = his prepare-only manual publish; `published` = an
 * armed scheduled auto-publish that actually clicked the platform's Publish button.
 * `blocked_disarmed` (hardening G7, safety-critical) = MAIN refused to auto-click Publish because
 * auto-posting is DISARMED — no window was opened, no composer touched, no Publish clicked. It is
 * NOT a failure: the job is simply waiting for the user to arm auto-posting (or publish manually).
 */
export interface PublishResult {
  status: 'published' | 'prepared' | 'unsupported' | 'failed' | 'blocked_disarmed';
  message: string;
  url?: string;
}

/** His vault metadata file shape (plaintext-safe: contains only salt + verifiers + a random
 *  marker — no key material is recoverable from it without the password or recovery key). */
export interface VaultMeta {
  /** base64 password-KDF salt. */
  salt: string;
  /** `encrypt(marker, passwordKey)` — a GCM ciphertext JSON string. */
  verifier: string;
  /** base64 recovery-KDF salt. */
  recoverySalt: string;
  /** `encrypt(marker, recoveryKey)` — a GCM ciphertext JSON string. */
  recoveryVerifier: string;
  /** base64 random marker both verifiers decrypt to on a correct key. */
  marker: string;
}

/**
 * Derive an account's persistent Electron session partition (his `accountPartition`, verbatim).
 * Each campaign/account pair gets its own `persist:` partition so authenticated cookies never
 * bleed between accounts. Pure — no electron, no clock, no RNG.
 */
export function accountPartition(campaignId: string, accountId: string): string {
  return `persist:ghost-${campaignId.replace(/[^a-z0-9_-]/gi, '')}-${accountId.replace(/[^a-z0-9_-]/gi, '')}`;
}
