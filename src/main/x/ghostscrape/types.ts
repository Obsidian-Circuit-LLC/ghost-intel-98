/**
 * GhostScrape (Task 1) — shared scrape types.
 *
 * Adapted from ZenScraper by 0Day3xpl0it (MIT). Reimplemented on native Electron
 * primitives.
 *
 * Clearnet quarantine (spec §3.2, mirrored from src/main/x/ipc.ts) — this module
 * MUST NOT import from:
 *   src/main/bgconn/*
 *   src/main/chat/transport-tor
 *   src/main/chat/socks5
 *   src/main/searchlight/tor-socks
 *   src/main/socmint/collector
 * All egress is the hidden browser's own clearnet HTTPS to x.com; nothing in
 * src/main/x/ghostscrape/ makes a network call directly. Secrets/settings/storage
 * are injected from register.ts, never imported here.
 *
 * Pure types only — no runtime logic.
 */

export type ScrapeType = 'all' | 'tweets' | 'retweets' | 'bio';

export interface ScrapedTweet {
  id: string;
  text: string;
  createdAt: string;
  isRetweet: boolean;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  url: string;
}

export interface ScrapedProfile {
  handle: string;
  displayName: string;
  bio: string;
  followers: number;
  following: number;
  joined: string;
}

export interface GhostScrapeConfig {
  accountId: string;
  username: string;
  type: ScrapeType;
  sinceAfter?: string;
  before?: string;
  scrolls: number;
  max: number;
  delayMs: number;
}

export interface GhostScrapeResult {
  profile?: ScrapedProfile;
  tweets: ScrapedTweet[];
  partial: boolean;
  captured: number;
}
