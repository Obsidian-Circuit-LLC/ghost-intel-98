/**
 * GhostScrape (Task 1) — pure GraphQL response-URL matchers.
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
 * All egress is the hidden browser's own clearnet HTTPS to x.com; nothing here
 * makes a network call.
 *
 * These matchers run against attacker-influenced runtime strings (the URL of every
 * response the hidden browser receives), so they use literal substring checks only —
 * NEVER `new RegExp(url)` or any other pattern built from runtime input.
 */

/**
 * True when `url` is an X GraphQL response for the user timeline endpoints
 * (`UserTweets` or `UserTweetsAndReplies`).
 */
export function isTimelineGraphqlUrl(url: string): boolean {
  return url.includes('/UserTweets') || url.includes('/UserTweetsAndReplies');
}

/**
 * True when `url` is an X GraphQL response for the profile endpoint
 * (`UserByScreenName`).
 */
export function isProfileGraphqlUrl(url: string): boolean {
  return url.includes('/UserByScreenName');
}
