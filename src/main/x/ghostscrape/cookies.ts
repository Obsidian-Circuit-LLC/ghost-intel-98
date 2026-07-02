/**
 * GhostScrape (Task 3) — pure X session-cookie builder.
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
 * Reuses the SAME shared X credential shape as X Intel
 * (`x.accounts.<accountId>.{auth_token,ct0}`, injected via register.ts) — no new
 * cookie store, no new settings namespace. Cookies built here are injected only
 * into the isolated `persist:ghostscrape` session partition (browser.ts, Task 4);
 * they are never logged and never sent to the renderer.
 */

export interface XCookie {
  url: string;
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
}

/**
 * Builds the X session cookies (`auth_token`, `ct0`) for the hidden scrape
 * browser. Only non-empty values produce a cookie — never emits a cookie with
 * an empty value.
 */
export function buildXCookies(authToken: string, ct0: string): XCookie[] {
  const cookies: XCookie[] = [];
  if (authToken) {
    cookies.push({
      url: 'https://x.com',
      name: 'auth_token',
      value: authToken,
      domain: '.x.com',
      path: '/',
      secure: true,
      httpOnly: true,
    });
  }
  if (ct0) {
    cookies.push({
      url: 'https://x.com',
      name: 'ct0',
      value: ct0,
      domain: '.x.com',
      path: '/',
      secure: true,
      httpOnly: false,
    });
  }
  return cookies;
}
