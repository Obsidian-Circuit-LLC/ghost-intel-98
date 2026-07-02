/**
 * GhostScrape (Task 4) — hidden, locked-down scrape browser window.
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
 * The ONLY network this module opens is the hidden BrowserWindow's own clearnet
 * HTTPS to x.com, using the operator's own session cookies and IP — the same
 * intrinsic egress as the X Intel collector. No Tor. No telemetry.
 *
 * The window runs on a UNIQUE, NON-persistent per-job session partition
 * (`ghostscrape-<jobId>`): (a) UNIQUE, so no two jobs ever share a cookie jar —
 * concurrent jobs can never race on, leak into, or read each other's injected
 * credentials (nor the main window's session); and (b) NON-persistent — the
 * absence of a `persist:` prefix means Electron never writes the jar to disk,
 * so a job's X auth_token/ct0 never survive onto storage.
 *
 * Electron 33 has NO `Session.destroy()` and retains every `fromPartition`
 * session for the app lifetime, so `win.destroy()` alone would leave the
 * injected cookies resident in the in-memory session jar indefinitely. To close
 * that, the job EXPLICITLY clears the session's storage on completion
 * (`dispose()` → `ses.clearStorageData()`), so the injected credentials do not
 * linger in process memory after the job ends. The empty Session object itself
 * still lingers (an Electron limitation with no API to release it), but it holds
 * no credentials once cleared.
 *
 * The partition's permission handlers deny every request/check (mirrors the
 * `persist:netexplorer` lockdown in src/main/index.ts), `sandbox`+
 * `contextIsolation` are on, `nodeIntegration` is off, and `webviewTag` is
 * disabled.
 */

import { BrowserWindow, session } from 'electron';
import type { XCookie } from './cookies';

/**
 * Derive the per-job session-partition name. UNIQUE per jobId, so no two jobs
 * share a cookie jar. NON-persistent by construction — the absence of a
 * `persist:` prefix makes Electron treat it as an in-memory partition that is
 * never written to disk, so a job's cookie jar never survives onto storage or
 * into a sibling job. (Electron still retains the Session object itself for the
 * app lifetime — see the module header — which is why the job clears the
 * session's storage on dispose rather than relying on GC.) Pure + deterministic
 * so it can be unit-tested without Electron.
 */
export function partitionForJob(jobId: string): string {
  return `ghostscrape-${jobId}`;
}

export interface ScrapeWindow {
  navigate(url: string): Promise<void>;
  scrollToBottom(): Promise<void>;
  clickLatest(): Promise<void>;
  readonly webContents: Electron.WebContents;
  dispose(): Promise<void>;
}

/** Deny every permission request/check on the scrape partition — it should never
 *  need camera/mic/geo/notifications/clipboard, and denying-by-default is the
 *  safe posture for a hidden, cookie-authenticated session the user doesn't see. */
function lockDownGhostScrapeSession(ses: Electron.Session): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

/**
 * Opens the hidden scrape `BrowserWindow` on this job's UNIQUE, non-persistent
 * `ghostscrape-<jobId>` partition, injects the supplied X session cookies into
 * that job-private jar, and returns a thin navigation/scroll handle. The window
 * is never shown. On `dispose()` the window is destroyed AND the session's
 * storage is explicitly cleared, purging the injected cookies from the resident
 * in-memory jar (Electron 33 keeps the Session alive for the app lifetime, so
 * closing the window is not enough — see the module header).
 */
export async function openScrapeWindow(jobId: string, cookies: XCookie[]): Promise<ScrapeWindow> {
  const ses = session.fromPartition(partitionForJob(jobId));
  lockDownGhostScrapeSession(ses);

  for (const cookie of cookies) {
    await ses.cookies.set(cookie);
  }

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      session: ses,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
      images: true,
      javascript: true,
    },
  });

  const wc = win.webContents;

  return {
    webContents: wc,
    async navigate(url: string): Promise<void> {
      await wc.loadURL(url);
    },
    async scrollToBottom(): Promise<void> {
      try {
        await wc.executeJavaScript('window.scrollTo(0, document.body.scrollHeight);');
      } catch {
        // Best-effort — a transient navigation/detach shouldn't abort the job.
      }
    },
    async clickLatest(): Promise<void> {
      // Best-effort: X's "Latest" tab is unreliable to select by any single stable
      // hook, so this walks visible tab-role elements and clicks the one whose text
      // says "Latest" — if it isn't found (layout/copy change), this is a no-op and
      // the scrape proceeds against whatever tab is already selected.
      const script = `(() => {
        try {
          const tabs = document.querySelectorAll('[role="tab"]');
          for (const tab of tabs) {
            if ((tab.textContent || '').trim() === 'Latest') {
              tab.click();
              return true;
            }
          }
        } catch (e) { /* ignore */ }
        return false;
      })();`;
      try {
        await wc.executeJavaScript(script);
      } catch {
        // Best-effort — never abort the job over the "Latest" tab not being found.
      }
    },
    async dispose(): Promise<void> {
      if (!win.isDestroyed()) {
        win.destroy();
      }
      try {
        // Electron 33 has no Session.destroy() and retains fromPartition sessions for the app
        // lifetime, so win.destroy() alone leaves the injected X cookies resident in the in-memory
        // jar. Explicitly purge them so credentials do not linger in process memory after the job.
        await ses.clearStorageData();
      } catch {
        // Best-effort — a failed clear must never turn a completed/cancelled job into a throw.
      }
    },
  };
}
