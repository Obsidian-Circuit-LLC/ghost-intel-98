/**
 * Electron main entry. Owns the single BrowserWindow, wires IPC, starts the reminder ticker.
 */

import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { ensureDataLayout } from './storage/paths';
import { registerIpc, startReminderTicker } from './ipc/register';

const isDev = !!process.env['ELECTRON_RENDERER_URL'];

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#008080',
    title: 'Ghost Access 98',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // safeStorage is invoked from preload-bound IPC, not the renderer
      webviewTag: true // Net Explorer (post-MVP) uses <webview>
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // External links open in the OS browser, not in our shell
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  await ensureDataLayout();
  registerIpc(() => mainWindow);
  createWindow();
  startReminderTicker(() => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
