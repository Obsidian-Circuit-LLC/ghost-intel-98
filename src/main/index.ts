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

import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { ensureDataLayout } from './storage/paths';
import { registerIpc, startReminderTicker } from './ipc/register';
import { shutdownAllSessions } from './services/ssh';
import { cancelAll as cancelAllAiStreams } from './services/ai';

const isDev = !!process.env['ELECTRON_RENDERER_URL'];

let mainWindow: BrowserWindow | null = null;
let reminderInterval: NodeJS.Timeout | null = null;

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
    contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
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

app.whenReady().then(async () => {
  await ensureDataLayout();
  lockDownWebContents();
  registerIpc(() => mainWindow);
  createWindow();
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
