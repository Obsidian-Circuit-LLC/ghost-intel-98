/**
 * GhostScrape (Task 4) — CDP GraphQL response capture.
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
 * makes a network call of its own — this module only observes responses the
 * hidden browser (browser.ts) already received.
 *
 * Attaches Chrome DevTools Protocol (`webContents.debugger`) to a hidden
 * BrowserWindow's webContents and buffers the JSON bodies of GraphQL responses
 * whose URL passes the caller-supplied `match` predicate (see graphql-urls.ts —
 * always a literal substring check, never a RegExp over runtime input).
 */

export interface Capture {
  readonly raw: unknown[];
  /**
   * True once the CDP debugger session is confirmed live — i.e. `Network.enable` resolved.
   * When this stays false the debugger never attached (or the command was rejected), so no
   * response could ever have been observed: a `captured:0` outcome is then a capture FAILURE,
   * NOT a genuinely empty timeline. The job path branches on this to surface an honest error.
   */
  readonly attached: boolean;
  /**
   * True once at least one `Network.responseReceived` for a MATCHED GraphQL URL was delivered
   * (i.e. a response the `match` predicate accepted — `UserByScreenName`/`UserTweets`/…), NOT on
   * every response. This is the honest live-session signal: `UserByScreenName` always fires on a
   * valid profile navigation, whereas an EXPIRED/invalid session is redirected to the logged-out
   * login SPA shell, which serves assets but no GraphQL — so it produces no matched response.
   * Keying on ANY response would misclassify that expired-session shell as a genuine-empty success.
   *
   * Residual limitation: a matched URL that returns a GraphQL *error* body (200/401) would still
   * flip this flag. Accepted — this addresses the dominant expired-session case (no matched
   * response at all), and the parse layer already tolerates error/empty bodies.
   */
  readonly sawMatchedResponse: boolean;
  detach(): void;
}

/**
 * Attaches a CDP session to `wc` and records every GraphQL response body whose
 * URL passes `match`. Uses `Network.responseReceived` to note which in-flight
 * requests matter, then `Network.loadingFinished` (body only available once
 * loading is finished) to fetch + parse the body via `Network.getResponseBody`.
 *
 * Never throws on a malformed/undecodable body — it is simply skipped, so one
 * bad response can't abort the whole capture.
 */
export function attachGraphqlCapture(
  wc: Electron.WebContents,
  match: (url: string) => boolean,
): Capture {
  const raw: unknown[] = [];
  const pendingRequestIds = new Set<string>();
  let attached = false;
  let sawMatchedResponse = false;

  const onMessage = (
    _event: Electron.Event,
    method: string,
    params: unknown,
  ): void => {
    if (method === 'Network.responseReceived') {
      const p = params as { requestId?: unknown; response?: { url?: unknown } };
      const requestId = typeof p.requestId === 'string' ? p.requestId : undefined;
      const url = typeof p.response?.url === 'string' ? p.response.url : undefined;
      if (requestId && url && match(url)) {
        // Only a MATCHED GraphQL response proves a live session (see interface docstring). An
        // expired session redirected to the logged-out shell serves assets but no GraphQL, so it
        // never reaches here — which is exactly the failure we want isCaptureFailure to catch.
        sawMatchedResponse = true;
        pendingRequestIds.add(requestId);
      }
      return;
    }
    if (method === 'Network.loadingFinished') {
      const p = params as { requestId?: unknown };
      const requestId = typeof p.requestId === 'string' ? p.requestId : undefined;
      if (!requestId || !pendingRequestIds.has(requestId)) return;
      pendingRequestIds.delete(requestId);
      void wc.debugger
        .sendCommand('Network.getResponseBody', { requestId })
        .then((result: { body?: unknown; base64Encoded?: unknown }) => {
          if (typeof result?.body !== 'string') return;
          const body = result.base64Encoded === true
            ? Buffer.from(result.body, 'base64').toString('utf8')
            : result.body;
          try {
            raw.push(JSON.parse(body));
          } catch {
            // Malformed/non-JSON body — skip, never throw.
          }
        })
        .catch(() => {
          // Body no longer available (e.g. navigation) or CDP error — skip.
        });
    }
  };

  wc.debugger.on('message', onMessage);

  try {
    wc.debugger.attach('1.3');
  } catch {
    // Already attached (e.g. devtools open) — attach() throws in that case;
    // proceed, the existing session still delivers 'message' events.
  }
  void wc.debugger
    .sendCommand('Network.enable')
    .then(() => {
      // Confirmed live: the session accepted a command and will now deliver events. This is
      // the single source of truth for `attached` — attach() alone can throw on an already-
      // attached session (devtools) yet still work, so we key off the command actually landing.
      attached = true;
    })
    .catch(() => {
      // Rejected — the debugger never attached / the command failed. `attached` stays false so
      // the job path surfaces an HONEST capture failure instead of a silent empty result.
    });

  return {
    raw,
    get attached(): boolean {
      return attached;
    },
    get sawMatchedResponse(): boolean {
      return sawMatchedResponse;
    },
    detach(): void {
      wc.debugger.off('message', onMessage);
      try {
        wc.debugger.detach();
      } catch {
        // Not attached / already detached — nothing to do.
      }
    },
  };
}
