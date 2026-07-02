/**
 * GhostScrape (Task T2) — honest capture-attach failure surfacing.
 *
 * A job that ends with captured:0 because the CDP capture never attached (Network.enable
 * failed / debugger never attached) previously reported a SILENT successful empty result —
 * indistinguishable from a genuinely empty timeline. This test pins the two behaviours:
 *
 *   1. capture-attach failure  -> a DISTINCT, actionable message (not empty-success, not the
 *      generic "Scrape failed" catch-all).
 *   2. capture DID attach + zero tweets -> empty-success (no error).
 *
 * It also exercises the capture.ts signal wiring (`attached` / `sawMatchedResponse`) with a fake
 * webContents.debugger so the branch has a real source of truth, not a hand-set flag.
 */
import { describe, it, expect } from 'vitest';
import { attachGraphqlCapture } from '../src/main/x/ghostscrape/capture';
import {
  GhostScrapeCaptureFailedError,
  isCaptureFailure,
  safeJobErrorMessage,
} from '../src/main/x/ghostscrape/errors';

/** Flush all pending micro/macro tasks so the async Network.enable settle lands. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type MsgListener = (event: unknown, method: string, params: unknown) => void;

/** Minimal fake of the bits of Electron.WebContents that attachGraphqlCapture touches. */
function makeFakeWc(opts: { attachThrows?: boolean; enableRejects?: boolean }): {
  wc: Electron.WebContents;
  emit(method: string, params: unknown): void;
} {
  const listeners: MsgListener[] = [];
  const debuggerObj = {
    on(_ev: string, cb: MsgListener): void {
      listeners.push(cb);
    },
    off(): void {
      /* no-op */
    },
    attach(): void {
      if (opts.attachThrows) throw new Error('already attached');
    },
    detach(): void {
      /* no-op */
    },
    sendCommand(method: string): Promise<unknown> {
      if (method === 'Network.enable') {
        return opts.enableRejects ? Promise.reject(new Error('no debugger')) : Promise.resolve({});
      }
      return Promise.resolve({});
    },
  };
  const wc = { debugger: debuggerObj } as unknown as Electron.WebContents;
  return {
    wc,
    emit(method: string, params: unknown): void {
      for (const l of [...listeners]) l({}, method, params);
    },
  };
}

describe('capture signal wiring', () => {
  it('leaves attached=false when Network.enable rejects (debugger never attached)', async () => {
    const { wc } = makeFakeWc({ attachThrows: true, enableRejects: true });
    const cap = attachGraphqlCapture(wc, () => true);
    await flush();
    expect(cap.attached).toBe(false);
    expect(cap.sawMatchedResponse).toBe(false);
    cap.detach();
  });

  it('sets attached=true once Network.enable resolves and sawMatchedResponse on a MATCHED response', async () => {
    // The predicate matches only X GraphQL profile/timeline URLs — mirrors the real job wiring.
    const isGraphql = (url: string): boolean =>
      url.includes('/UserByScreenName') || url.includes('/UserTweets');
    const { wc, emit } = makeFakeWc({});
    const cap = attachGraphqlCapture(wc, isGraphql);
    await flush();
    expect(cap.attached).toBe(true);
    expect(cap.sawMatchedResponse).toBe(false);

    // A NON-matched response (the logged-out shell serves assets/other URLs, never GraphQL) must
    // NOT flip the flag — this is the whole point of the fix: an expired session is not a success.
    emit('Network.responseReceived', { requestId: 'a1', response: { url: 'https://x.com/home' } });
    emit('Network.responseReceived', {
      requestId: 'a2',
      response: { url: 'https://abs.twimg.com/asset.js' },
    });
    expect(cap.sawMatchedResponse).toBe(false);

    // A MATCHED GraphQL response (UserByScreenName always fires on a valid profile nav) flips it.
    emit('Network.responseReceived', {
      requestId: 'r1',
      response: { url: 'https://x.com/i/api/graphql/abc/UserByScreenName?x=1' },
    });
    expect(cap.sawMatchedResponse).toBe(true);
    cap.detach();
  });
});

describe('isCaptureFailure — genuine-empty vs failed-capture', () => {
  it('flags a capture-attach failure (never attached, zero results, not cancelled)', () => {
    expect(isCaptureFailure({ attached: false, sawMatchedResponse: false }, false, false)).toBe(true);
  });

  it('flags attached-but-silent (no response ever delivered, zero results)', () => {
    expect(isCaptureFailure({ attached: true, sawMatchedResponse: false }, false, false)).toBe(true);
  });

  it('treats attached + saw responses + zero tweets as an EMPTY SUCCESS, not a failure', () => {
    expect(isCaptureFailure({ attached: true, sawMatchedResponse: true }, false, false)).toBe(false);
  });

  it('never flags a failure when any result was captured', () => {
    expect(isCaptureFailure({ attached: false, sawMatchedResponse: false }, true, false)).toBe(false);
  });

  it('never flags a failure on a cancelled (partial) job, even with zero results', () => {
    expect(isCaptureFailure({ attached: false, sawMatchedResponse: false }, false, true)).toBe(false);
  });
});

describe('safeJobErrorMessage — capture failure is a distinct, actionable sentence', () => {
  it('maps GhostScrapeCaptureFailedError to a distinct message (not the generic catch-all)', () => {
    const msg = safeJobErrorMessage(new GhostScrapeCaptureFailedError());
    expect(msg).toMatch(/capture the timeline/i);
    expect(msg).toMatch(/re-add.*cookies|X Intel/i);
    expect(msg).not.toBe('Scrape failed. Check the app log for details.');
  });

  it('does not leak the raw internal error message to the renderer', () => {
    const msg = safeJobErrorMessage(new GhostScrapeCaptureFailedError());
    expect(msg).not.toContain('CDP');
    expect(msg).not.toContain('debugger');
  });
});
