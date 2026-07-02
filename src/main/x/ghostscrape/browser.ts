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
 * The window runs on the isolated `persist:ghostscrape` session partition
 * (never the main window's session) so injected cookies never leak into, or
 * out of, any other part of the app; the partition's permission handlers deny
 * every request/check (mirrors the `persist:netexplorer` lockdown in
 * src/main/index.ts), `sandbox`+`contextIsolation` are on, `nodeIntegration`
 * is off, and `webviewTag` is disabled.
 */

import { BrowserWindow, session } from 'electron';
import type { XCookie } from './cookies';

const GHOSTSCRAPE_PARTITION = 'persist:ghostscrape';

export interface ScrapeWindow {
  navigate(url: string): Promise<void>;
  scrollToBottom(): Promise<void>;
  clickLatest(): Promise<void>;
  readonly webContents: Electron.WebContents;
  destroy(): void;
}

/** Deny every permission request/check on the scrape partition — it should never
 *  need camera/mic/geo/notifications/clipboard, and denying-by-default is the
 *  safe posture for a hidden, cookie-authenticated session the user doesn't see. */
function lockDownGhostScrapeSession(ses: Electron.Session): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

/**
 * Opens the hidden scrape `BrowserWindow` on the isolated `persist:ghostscrape`
 * partition, injects the supplied X session cookies into that partition, and
 * returns a thin navigation/scroll handle. The window is never shown.
 */
export async function openScrapeWindow(cookies: XCookie[]): Promise<ScrapeWindow> {
  const ses = session.fromPartition(GHOSTSCRAPE_PARTITION);
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
    destroy(): void {
      if (!win.isDestroyed()) {
        win.destroy();
      }
    },
  };
}
