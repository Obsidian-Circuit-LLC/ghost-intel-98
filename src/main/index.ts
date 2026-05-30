/**
 * Electron main entry. Owns the single BrowserWindow, wires IPC, starts the reminder ticker.
 *
 * v1.0.1 hardening:
 *  - sandbox: true (was false based on a wrong premise; safeStorage is invoked from main, not preload)
 *  - app.on('web-contents-created') strips dangerous attrs from any <webview> the renderer creates
 *  - app.on('before-quit') drains SSH sessions + cancels AI streams cleanly
 *  - setWindowOpenHandler on the webview's webContents so popups can't escape the partition
 *  - permission request handler denies camera/mic/geo/notifications by default
 */

import { app, BrowserWindow, protocol, session, shell } from 'electron';
import { join } from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';
import { channels } from '@shared/ipc-contracts';
import { ensureDataLayout } from './storage/paths';
import { registerMediaProtocol } from './media/protocol';

// Custom scheme for local audio playback. Must be declared before app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'ga98media', privileges: { stream: true, supportFetchAPI: true, secure: true, standard: true } }
]);
import { registerIpc, startReminderTicker } from './ipc/register';
import * as vault from './services/vault';
import { shutdownAllSessions } from './services/ssh';
import { shutdownAll as shutdownAllFtp } from './services/ftp';
import { cancelAll as cancelAllAiStreams } from './services/ai';
import * as localAi from './services/local-ai';

const isDev = !!process.env['ELECTRON_RENDERER_URL'];

let mainWindow: BrowserWindow | null = null;
let reminderInterval: NodeJS.Timeout | null = null;

/**
 * Defense-in-depth crash guard. Electron's default uncaughtException handler pops a fatal
 * "A JavaScript error occurred in the main process" dialog and kills the app. A single
 * unhandled async error from any library (e.g. an EventEmitter emitting 'error' with no
 * listener — see mail.ts) would otherwise take the whole app down. We log and surface a
 * diagnostic toast instead; operation-level try/catch still handles real failure paths.
 * This is NOT a license to swallow errors — it is a backstop so a transient background
 * fault degrades gracefully rather than crashing a desktop app mid-session.
 */
function installCrashGuards(): void {
  const report = (label: string, err: unknown): void => {
    // eslint-disable-next-line no-console
    console.error(label, err);
    try {
      mainWindow?.webContents.send(channels.system.onDiagnostic, {
        kind: 'main-error',
        message: (err as Error)?.message ?? String(err)
      });
    } catch { /* window may be torn down */ }
    // Persist a developer log (best-effort) so a background fault is diagnosable after the fact.
    try {
      const dir = app.getPath('logs');
      const line = `${new Date().toISOString()} ${label} ${(err as Error)?.stack ?? String(err)}\n`;
      void mkdir(dir, { recursive: true }).then(() => appendFile(join(dir, 'ga98-main.log'), line)).catch(() => undefined);
    } catch { /* logs path unavailable pre-ready */ }
  };
  process.on('uncaughtException', (err) => report('[main.uncaughtException]', err));
  process.on('unhandledRejection', (reason) => report('[main.unhandledRejection]', reason));
}

installCrashGuards();

function createWindow(): void {
  const iconPath = isDev
    ? join(__dirname, '../../resources/icon.png')
    : join(process.resourcesPath, 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#008080',
    title: 'Ghost Access 98',
    icon: iconPath,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only let real web URLs escape to the OS browser; everything else gets denied.
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch { /* malformed URL — drop */ }
    return { action: 'deny' };
  });

  // Main-window-only permission allowlist for clipboard access (DialTerm paste needs it).
  // Round-3 audit Critical H5 fix: previous attempt in lockDownWebContents had a startup
  // race where `mainWindow` was still null when web-contents-created fired synchronously
  // from new BrowserWindow(). Setting it directly on mainWindow.webContents.session here
  // runs AFTER construction so there is no race.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'clipboard-read' || (permission as string) === 'clipboard-sanitized-write') {
      callback(true);
      return;
    }
    callback(false);
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/** Defence-in-depth: lock down every webContents the app spawns (renderer + any <webview>).
 *
 *  v1.0.1 round-3 fix: explicitly overwrite EVERY dangerous webPreferences key (not just the
 *  three we set before). A renderer-injected `<webview disablewebsecurity webpreferences="..."
 *  nodeintegrationinsubframes>` previously left several flags at the renderer's chosen values. */
function lockDownWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      // Wholesale rewrite — anything the renderer set is suspect.
      const safe: Record<string, unknown> = {
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        enableBlinkFeatures: '',
        disableBlinkFeatures: '',
        webviewTag: false,
        plugins: false,
        javascript: true
      };
      for (const k of Object.keys(webPreferences)) {
        if (!(k in safe)) delete (webPreferences as Record<string, unknown>)[k];
      }
      Object.assign(webPreferences, safe);
      // The renderer must not be able to inject a preload script into the webview.
      delete (webPreferences as Record<string, unknown>).preload;
      // Only allow http(s) initial loads. about:blank is fine.
      const src = (params.src ?? '').trim();
      if (src && !/^https?:/i.test(src) && src !== 'about:blank') {
        event.preventDefault();
      }
    });
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const u = new URL(url);
        if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(url);
      } catch { /* drop */ }
      return { action: 'deny' };
    });
    // Permission handlers are set on sessions, not on each webContents — see
    // createWindow() (main window's session) and lockDownPartitionSessions()
    // (the persist:netexplorer session used by Net Explorer tabs).
    // Forbid in-place navigation away from the original origin via main-process redirect tricks.
    contents.on('will-navigate', (e, url) => {
      try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'about:') {
          e.preventDefault();
        }
      } catch {
        e.preventDefault();
      }
    });
  });
}

/** Lock down the webview-tab partition session (camera/mic/geo/notif all denied).
 *  Called after createWindow so mainWindow exists; the partition is created on first
 *  use (mounting a <webview partition="persist:netexplorer">), but setting the handler
 *  in advance is safe — fromPartition creates it on demand. */
function lockDownPartitionSessions(): void {
  const webviewSession = session.fromPartition('persist:netexplorer');
  webviewSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}

app.whenReady().then(async () => {
  await ensureDataLayout();
  await vault.refreshEnabled(); // populate the lock-gate cache before any IPC can fire
  lockDownWebContents();
  registerMediaProtocol(); // ga98media:// for local audio playback
  registerIpc(() => mainWindow);
  createWindow();
  lockDownPartitionSessions();
  reminderInterval = startReminderTicker(() => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', async () => {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
  await cancelAllAiStreams();
  await shutdownAllSessions();
  await shutdownAllFtp();
});

app.on('will-quit', () => { localAi.stop(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
