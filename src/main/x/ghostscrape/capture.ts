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
  void wc.debugger.sendCommand('Network.enable').catch(() => {
    // Best-effort; if this fails no responses will match and raw stays empty
    // (surfaced to the caller as zero captured items, not a thrown error).
  });

  return {
    raw,
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
