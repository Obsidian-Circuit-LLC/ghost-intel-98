/**
 * GhostScrape (Task 5) — scrape job orchestration: config → hidden browser →
 * navigate/click/scroll → captured GraphQL → parsed, filtered result.
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
 * All egress is the hidden browser's own clearnet HTTPS to x.com (browser.ts);
 * this module makes no network call of its own. Credentials are read via the
 * INJECTED `getSecret` dep (never a direct secretStore/keyring import here) —
 * mirrors how x/collector.ts receives its deps. Reuses the SAME shared X
 * credential shape as X Intel (`x.accounts.<accountId>.{auth_token,ct0}`) — no
 * new cookie store, no new settings namespace.
 *
 * This is glue, not logic: every decision it makes (scroll continuation,
 * timeline/profile parsing, type/date/dedupe/cap filtering) is delegated to
 * the pure, unit-tested helpers from Tasks 1-3. It is not headlessly testable
 * itself (no X login in CI) — verified by `pnpm typecheck` + manual smoke +
 * the whole-branch review.
 */

import type { GhostScrapeConfig, GhostScrapeResult, ScrapedProfile } from './types';
import { buildXCookies } from './cookies';
import { openScrapeWindow } from './browser';
import { attachGraphqlCapture } from './capture';
import { isProfileGraphqlUrl, isTimelineGraphqlUrl } from './graphql-urls';
import { applyFilters, parseProfile, parseTimeline } from './parse';
import { shouldContinueScroll, type ScrollState } from './scroll-control';
import { GhostScrapeNoCredsError } from './errors';

// GhostScrapeNoCredsError now lives in ./errors; re-exported for callers importing it from here.
export { GhostScrapeNoCredsError };

export interface JobDeps {
  getSecret(key: string): Promise<string | null>;
  onProgress(p: { captured: number; scrollsDone: number }): void;
}

/**
 * Sanitise an account ID before it is interpolated into a secret-store key:
 * strips path separators and dots so a hostile `accountId` can't reach outside
 * the `x.accounts.` namespace (mirrors safeAccountId in x/ipc.ts).
 */
function safeAccountId(raw: string): string {
  return raw.replace(/[/\\.:]/g, '_');
}

/** Resolves after `ms` milliseconds, or immediately if `signal` is already
 * aborted / fires 'abort' during the wait — never left waiting past a cancel. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolveDelay) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolveDelay();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolveDelay();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs one GhostScrape job end-to-end: reads the account's shared X session
 * cookies, opens a hidden cookie-authenticated browser window, navigates to
 * the target profile, optionally clicks "Latest" and scrolls to accumulate
 * timeline responses (bounded by `cfg.scrolls`/`cfg.max`/two empty rounds —
 * `shouldContinueScroll`), then parses + filters everything captured.
 *
 * Honors `signal`: if aborted before or during the scroll loop, the loop stops
 * immediately and the result is returned with `partial: true` rather than
 * throwing — cancellation is a normal, reportable outcome, not an error.
 *
 * The hidden window is ALWAYS destroyed (`finally`), even on error or cancel.
 */
export async function runScrapeJob(
  cfg: GhostScrapeConfig,
  deps: JobDeps,
  signal: AbortSignal,
): Promise<GhostScrapeResult> {
  const accountId = safeAccountId(cfg.accountId);
  const [authToken, ct0] = await Promise.all([
    deps.getSecret(`x.accounts.${accountId}.auth_token`),
    deps.getSecret(`x.accounts.${accountId}.ct0`),
  ]);
  if (!authToken || !ct0) {
    throw new GhostScrapeNoCredsError(cfg.accountId);
  }

  const cookies = buildXCookies(authToken, ct0);
  const win = await openScrapeWindow(cookies);
  const capture = attachGraphqlCapture(
    win.webContents,
    (url) => isTimelineGraphqlUrl(url) || isProfileGraphqlUrl(url),
  );

  let partial = false;

  try {
    const username = cfg.username.replace(/^@/, '').trim();
    await win.navigate(`https://x.com/${encodeURIComponent(username)}`);
    await delay(cfg.delayMs, signal);

    const wantsTimeline = cfg.type === 'all' || cfg.type === 'tweets' || cfg.type === 'retweets';

    if (signal.aborted) {
      partial = true;
    } else if (wantsTimeline) {
      await win.clickLatest();
      await delay(cfg.delayMs, signal);

      const state: ScrollState = {
        scrollsDone: 0,
        newItemsLastRound: 0,
        totalCaptured: parseTimeline(capture.raw).length,
        maxScrolls: cfg.scrolls,
        maxItems: cfg.max,
        emptyRoundsInARow: 0,
      };

      while (!signal.aborted && shouldContinueScroll(state)) {
        const before = state.totalCaptured;
        await win.scrollToBottom();
        await delay(cfg.delayMs, signal);

        const after = parseTimeline(capture.raw).length;
        const newItems = after - before;

        state.scrollsDone += 1;
        state.newItemsLastRound = newItems;
        state.totalCaptured = after;
        state.emptyRoundsInARow = newItems > 0 ? 0 : state.emptyRoundsInARow + 1;

        deps.onProgress({ captured: state.totalCaptured, scrollsDone: state.scrollsDone });
      }

      if (signal.aborted) partial = true;
    }

    // Let any in-flight CDP response-body fetches (from the final navigation/scroll) land before
    // we parse and tear the window down — otherwise the last batch can be dropped.
    if (!signal.aborted) await delay(cfg.delayMs, signal);

    // A 'bio'-only scrape returns the profile alone — tweets captured incidentally during the
    // initial profile navigation are not what the user asked for.
    const tweets = cfg.type === 'bio' ? [] : applyFilters(parseTimeline(capture.raw), cfg);

    let profile: ScrapedProfile | undefined;
    for (const raw of capture.raw) {
      const parsed = parseProfile(raw);
      if (parsed) {
        profile = parsed;
        break;
      }
    }

    return {
      ...(profile !== undefined && { profile }),
      tweets,
      partial,
      captured: tweets.length,
    };
  } finally {
    capture.detach();
    win.destroy();
  }
}
