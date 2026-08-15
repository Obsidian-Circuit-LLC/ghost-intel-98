/**
 * Ghost Social Media Manager (hardened GI98 port) — profile-stats service (Phase 3, G4).
 *
 * Ports his `electron/core/ProfileStatsService.ts` VERBATIM: to read an account's follower/
 * following counts it opens a HIDDEN Chromium window on that account's OWN authenticated
 * `persist:` partition, discovers the profile URL (explicit profileUrl → username-derived →
 * DOM-discovered), navigates there, runs the per-platform DOM adapter script (adapters.ts), and
 * parses the visible counts. NEVER a platform API.
 *
 * The one invariant the port hardens is lifecycle discipline (constraint 9): the hidden window is
 * ALWAYS closed after a scrape — in a `finally`, so an adapter script that throws, a navigation
 * that rejects, or a parse error can never leak a native window over the desktop. Ported pure over
 * injected seams (no electron/node import) so "the window is always closed, even on adapter error"
 * is a unit test; `publishing-ipc.ts` wires the production `BrowserWindow`.
 *
 * Determinism: the only non-pure inputs are the injected `sleep` (his fixed settle delays) and the
 * `refreshedAt` timestamp, which is cosmetic (display only) and taken from `new Date()` exactly as
 * his did — no correctness path depends on it.
 */

import { getAdapter } from './adapters';
import type { AccountLike, AccountStats } from '@shared/ghost-social/types';

// ---- injectable electron-shaped seams ----------------------------------

export interface StatsWc {
  loadURL(url: string): Promise<unknown>;
  getURL(): string;
  executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>;
}

export interface StatsWindow {
  webContents: StatsWc;
  destroy(): void;
  isDestroyed(): boolean;
}

export interface StatsDeps {
  partitionFor(campaignId: string, accountId: string): string;
  /** Build a HIDDEN window on the account partition (his `new BrowserWindow({show:false,…})`). */
  createWindow(partition: string): StatsWindow;
  /** Injected settle delay (his `setTimeout` awaits); tests pass a no-op. */
  sleep(ms: number): Promise<void>;
}

export interface ProfileStatsService {
  refresh(campaignId: string, account: AccountLike): Promise<AccountStats>;
}

// ---- his helpers, ported VERBATIM --------------------------------------

/** His `parseCompact` — "1.2K"/"3,456"/"7M" → an integer, or null. */
export function parseCompact(input: string | null | undefined): number | null {
  if (!input) return null;
  const s = String(input).trim().replace(/\s/g, '').replace(/_/g, '').replace(/,/g, '');
  const m = s.match(/^([0-9]*\.?[0-9]+)([KMB])?/i);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = !m[2] ? 1 : m[2].toUpperCase() === 'K' ? 1e3 : m[2].toUpperCase() === 'M' ? 1e6 : 1e9;
  return Number.isFinite(n) ? Math.round(n * mult) : null;
}

function cleanUser(v?: string): string {
  return (v || '').trim().replace(/^@/, '');
}

/** His `fromUsername` — a username-derived profile URL where the platform supports it. */
export function fromUsername(account: AccountLike): string | null {
  const u = cleanUser(account.username);
  if (!u) return null;
  const enc = encodeURIComponent(u);
  switch (account.platform) {
    case 'x':
      return `https://x.com/${enc}`;
    case 'instagram':
      return `https://www.instagram.com/${enc}/`;
    case 'tiktok':
      return `https://www.tiktok.com/@${enc}`;
    case 'youtube':
      return `https://www.youtube.com/@${enc}`;
    case 'bluesky':
      return `https://bsky.app/profile/${enc}`;
    default:
      return null;
  }
}

function errMessage(e: unknown, fallback: string): string {
  return (e as { message?: string })?.message || fallback;
}

// ---- factory -----------------------------------------------------------

export function makeProfileStatsService(deps: StatsDeps): ProfileStatsService {
  /** His `discoverProfile` — explicit URL → username-derived → per-platform DOM discovery. */
  async function discoverProfile(win: StatsWindow, account: AccountLike): Promise<string | null> {
    if (account.profileUrl && /^https?:\/\//i.test(account.profileUrl)) return account.profileUrl;
    const byUser = fromUsername(account);
    if (byUser) return byUser;
    if (account.platform === 'facebook') {
      await win.webContents.loadURL('https://www.facebook.com/');
      await deps.sleep(3500);
      const fb = await win.webContents
        .executeJavaScript(
          `(() => {
        const abs=(h)=>{try{return new URL(h,location.origin).href}catch{return null}};
        const sels=['a[aria-label*="profile" i]','a[href*="profile.php?id="]','a[href^="/me/"]'];
        for(const s of sels){for(const a of document.querySelectorAll(s)){const h=a.getAttribute('href');if(h){const u=abs(h);if(u&&!/facebook\\.com\\/(?:groups|pages|watch|marketplace)\\//i.test(u))return u}}}
        return null;
      })()`,
          true,
        )
        .catch(() => null);
      return typeof fb === 'string' && fb ? fb : 'https://www.facebook.com/me';
    }
    await win.webContents.loadURL(account.url);
    await deps.sleep(3000);
    const discovered = await win.webContents
      .executeJavaScript(
        `(() => {
      const abs=(href)=>{try{return new URL(href,location.origin).href}catch{return null}};
      const first=(sels)=>{for(const s of sels){const e=document.querySelector(s);if(e){const a=e.closest('a')||e;const h=a.getAttribute?.('href');if(h)return abs(h)}}return null};
      const platform=${JSON.stringify(account.platform)};
      if(platform==='x') return first(['a[data-testid="AppTabBar_Profile_Link"]']);
      if(platform==='instagram') return first(['a[href^="/"] img[alt*="profile picture" i]','nav a[href^="/"] img']);
      if(platform==='tiktok') return first(['a[data-e2e="profile-icon"]','a[href*="/@"]']);
      if(platform==='linkedin') return first(['a[href*="/in/"][aria-label*="profile" i]','.feed-identity-module a[href*="/in/"]','.global-nav__me-photo[alt]','a[href*="/in/"] img','a[href*="/in/"]']);
      if(platform==='bluesky') return first(['a[href^="/profile/"] img','a[href^="/profile/"]']);
      return null;
    })()`,
        true,
      )
      .catch(() => null);
    return typeof discovered === 'string' ? discovered : null;
  }

  return {
    async refresh(campaignId, account) {
      const adapter = getAdapter(account.platform);
      const win = deps.createWindow(deps.partitionFor(campaignId, account.id));
      try {
        const target = await discoverProfile(win, account);
        if (!target)
          return {
            followers: null,
            following: null,
            status: 'unavailable',
            message:
              'Ghost could not identify this account profile yet. Open the account once or add the username/profile URL.',
            refreshedAt: new Date().toISOString(),
          };
        await win.webContents.loadURL(target);
        await deps.sleep(4500);
        const finalUrl = win.webContents.getURL();
        const raw = (await win.webContents.executeJavaScript(adapter.extractStatsScript(), true)) as {
          followers?: string | null;
          following?: string | null;
        };
        const followers = parseCompact(raw?.followers);
        const following = parseCompact(raw?.following);
        const status =
          followers !== null && (following !== null || ['youtube', 'linkedin'].includes(account.platform))
            ? 'ok'
            : followers !== null || following !== null
              ? 'partial'
              : 'unavailable';
        return {
          followers,
          following,
          followersLabel: adapter.labels?.followers || 'Followers',
          followingLabel: adapter.labels?.following || 'Following',
          rawFollowers: raw?.followers || undefined,
          rawFollowing: raw?.following || undefined,
          resolvedProfileUrl: finalUrl,
          refreshedAt: new Date().toISOString(),
          status,
          message:
            status === 'unavailable'
              ? 'Profile loaded, but no visible follower/following count was detected. The platform may hide it or its page layout may have changed.'
              : undefined,
        };
      } catch (e) {
        return {
          followers: null,
          following: null,
          status: 'error',
          message: errMessage(e, 'Could not read profile statistics.'),
          refreshedAt: new Date().toISOString(),
        };
      } finally {
        // Constraint 9: the hidden window is ALWAYS closed after a scrape — even on adapter error.
        if (!win.isDestroyed()) win.destroy();
      }
    },
  };
}
