/**
 * GhostExodus's X Listening Station in its own top-level window.
 *
 * His request: "when I click the icon or name from the drop-down menu, it just launches outside
 * Ghost Intel 98." This is that — a real OS window, its own document, none of the retro shell
 * around it, which is how his app was designed to be seen.
 *
 * It is NOT a second application, and that distinction is the whole point. Shipping his raw app as
 * a separate portable binary would give the same window while reintroducing plaintext evidence on
 * disk, his own clearnet-default Tor handling, and the unanchored avatar fetch flagged in the
 * security review — the posture the operator locked in on 2026-08-14. This window runs on THIS
 * process: same `window.xls` boundary, same sender validation, same encrypted state document, same
 * Tor gate on every byte that leaves the machine.
 *
 * Hardening mirrors the main window exactly (contextIsolation, no node integration, sandbox, no
 * webview tag), plus a deny-by-default navigation and window-open policy: the station renders local
 * content only, so any attempt to navigate it elsewhere is a bug or an attack, never a feature.
 */
import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

let stationWindow: BrowserWindow | null = null;

export interface StationWindowDeps {
  /** Dev server URL when running under electron-vite; absent in a packaged build. */
  rendererUrl?: string;
  /** Directory of the compiled main bundle (`__dirname` at the call site). */
  mainDir: string;
  iconPath?: string;
}

function safeProtocol(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}

/** Open the station window, or focus it if it is already open (his app is a singleton). */
export function openStationWindow(deps: StationWindowDeps): BrowserWindow {
  if (stationWindow && !stationWindow.isDestroyed()) {
    if (stationWindow.isMinimized()) stationWindow.restore();
    stationWindow.focus();
    return stationWindow;
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    // His console surface, so the window does not flash the app's teal before his CSS paints.
    backgroundColor: '#05090d',
    title: 'X Listening Station',
    icon: deps.iconPath,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(deps.mainDir, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false
    }
  });

  stationWindow = win;
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (stationWindow === win) stationWindow = null;
  });

  // Deny-by-default: this window renders local content only. A scraped link must go to the OS
  // browser through the guarded opener, never navigate the station itself.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const protocol = safeProtocol(url);
    if (protocol === 'http:' || protocol === 'https:') void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = deps.rendererUrl ? url.startsWith(deps.rendererUrl) : false;
    if (!url.startsWith('file:') && !allowed) event.preventDefault();
  });

  if (deps.rendererUrl) void win.loadURL(`${deps.rendererUrl}/station.html`);
  else void win.loadFile(join(deps.mainDir, '../renderer/station.html'));

  return win;
}

/** The live station window, if any (used to push his state:changed events at it). */
export function getStationWindow(): BrowserWindow | null {
  return stationWindow && !stationWindow.isDestroyed() ? stationWindow : null;
}

/** Test seam. */
export function __resetStationWindowForTests(): void {
  stationWindow = null;
}
