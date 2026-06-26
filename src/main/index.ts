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

import { app, BrowserWindow, Menu, protocol, session, shell } from 'electron';
import { join } from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';
import { channels } from '@shared/ipc-contracts';
import { ensureDataLayout } from './storage/paths';
import { migrateUserDataIfNeeded } from './migrate-userdata';
import { registerMediaProtocol } from './media/protocol';
import { registerModelProtocol } from './voice/model-protocol';
import { registerCctvProxy } from './geoint/cctv-proxy';

// Custom schemes. Must be declared before app is ready.
//  - ga98media: local audio/video streaming
//  - ga98model: serve the bundled Vosk speech model to vosk-browser (offline STT)
//  - ga98cctv: proxy CCTV stream bytes through Tor (main-side egress; never clearnet)
protocol.registerSchemesAsPrivileged([
  { scheme: 'ga98media', privileges: { stream: true, supportFetchAPI: true, secure: true, standard: true } },
  { scheme: 'ga98model', privileges: { stream: true, supportFetchAPI: true, secure: true, standard: true } },
  { scheme: 'ga98cctv', privileges: { stream: true, supportFetchAPI: true, secure: true, standard: true } },
  { scheme: 'dcs98-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);
import { registerIpc, startReminderTicker } from './ipc/register';
import * as vault from './services/vault';
import { loadPlugins, disableAllPlugins } from './plugins/loader';
import { getBgConnManager } from './bgconn/singleton';
import { getBgTor } from './bgconn/tor-singleton';
import { getPluginTor } from './plugins/tor-egress';
import { registerPluginProtocol } from './plugins/protocol';
import { buildContextDeps, refreshPluginNetSnapshot } from './plugins/wire-deps';
import { settingsStore } from './storage/json-fs';
import { initEngagementController } from './offensive/controller';
import { shutdownAllSessions } from './services/ssh';
import { shutdownAllShellSessions } from './services/shell';
import { stopMailPoller } from './services/mail-poller';
import { shutdownAll as shutdownAllFtp } from './services/ftp';
import { cancelAll as cancelAllAiStreams } from './services/ai';
import * as localAi from './services/local-ai';
import * as chat from './services/chat';
import { stopAis } from './services/livefeeds/ais-stream';
import { cancelAllSweeps } from './searchlight/sweep';

const isDev = !!process.env['ELECTRON_RENDERER_URL'];

let mainWindow: BrowserWindow | null = null;
let reminderInterval: NodeJS.Timeout | null = null;
let bgconnTickInterval: NodeJS.Timeout | null = null;

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
    title: 'Ghost Intel 98',
    icon: iconPath,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Net Explorer is now an external Firefox launcher — no in-app <webview> consumer remains,
      // so disable webviewTag entirely (red-team: a leftover webview could reach the mic in an
      // attacker-chosen partition with no permission handler).
      webviewTag: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Right-click edit menu (Cut / Copy / Paste / Select All). The app hides the application menu and
  // sets a global user-select:none for the Win98 feel, so without this there is no discoverable way
  // to copy a selection or paste into a field (the Mail client motivated this). Built from Electron
  // roles, which act on the focused editable element / current selection — purely local OS-clipboard
  // operations, no network egress, no telemetry. Items are contextual: Copy needs a selection;
  // Cut/Paste need an editable field.
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const hasSelection = params.selectionText.trim().length > 0;
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable && params.editFlags.canCut) template.push({ role: 'cut' });
    if (hasSelection && params.editFlags.canCopy) template.push({ role: 'copy' });
    if (params.isEditable && params.editFlags.canPaste) template.push({ role: 'paste' });
    if ((params.isEditable && params.editFlags.canSelectAll) || hasSelection) {
      if (template.length) template.push({ type: 'separator' });
      template.push({ role: 'selectAll' });
    }
    if (template.length === 0) return;
    Menu.buildFromTemplate(template).popup({ window: mainWindow ?? undefined });
  });

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

  // AIS teardown on main-side window lifecycle events. stopAis() is idempotent (clears a null
  // timer / closes a null socket) so firing on initial navigations before AIS is started is safe.
  // cancelAllSweeps() is also idempotent — marks all active sweep jobs cancelled so probe workers
  // drain gracefully instead of pushing results to a dead renderer.
  mainWindow.webContents.on('render-process-gone', () => { stopAis(); cancelAllSweeps(); });   // renderer crash
  mainWindow.webContents.on('did-start-navigation', () => { stopAis(); cancelAllSweeps(); }); // covers reload (Ctrl+R)
  mainWindow.on('closed', () => { stopAis(); cancelAllSweeps(); });                            // window close

  // Main-window-only permission allowlist for clipboard access (DialTerm paste needs it).
  // Round-3 audit Critical H5 fix: previous attempt in lockDownWebContents had a startup
  // race where `mainWindow` was still null when web-contents-created fired synchronously
  // from new BrowserWindow(). Setting it directly on mainWindow.webContents.session here
  // runs AFTER construction so there is no race.
  const isMainWc = (wc: Electron.WebContents | null): boolean => !!wc && wc === mainWindow?.webContents;
  mainWindow.webContents.session.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission === 'clipboard-read' || (permission as string) === 'clipboard-sanitized-write') {
      callback(true);
      return;
    }
    // Microphone for offline voice (Vosk STT): main window ONLY, AUDIO ONLY — never video,
    // display-capture, or any other context. A blanket `media → true` would hand the mic to the
    // whole session; this scopes it to the app's own renderer requesting audio.
    if (
      permission === 'media' &&
      isMainWc(wc) &&
      Array.isArray((details as { mediaTypes?: string[] }).mediaTypes) &&
      (details as { mediaTypes: string[] }).mediaTypes.length > 0 &&
      (details as { mediaTypes: string[] }).mediaTypes.every((t) => t === 'audio')
    ) {
      callback(true);
      return;
    }
    callback(false);
  });
  // Electron docs: the request handler alone is incomplete — the Permissions API / pre-flight
  // capability checks consult the CHECK handler, which otherwise falls back to Chromium defaults
  // (media defaults to allowed). Mirror the request policy exactly so there's one decision.
  mainWindow.webContents.session.setPermissionCheckHandler((wc, permission, _origin, details) => {
    if (permission === 'clipboard-read') return true;
    if (permission === 'media' && isMainWc(wc) && (details as { mediaType?: string }).mediaType === 'audio') return true;
    return false;
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
  // FIRST: carry forward data from the pre-rename (Ghost Access 98) userData dir, before any
  // storage layer reads or creates files in the new (Ghost Intel 98) location.
  await migrateUserDataIfNeeded();
  await ensureDataLayout();
  await vault.refreshEnabled(); // populate the lock-gate cache before any IPC can fire

  // Load plugins after the vault is refreshed so secure-fs reads work, and before
  // IPC is registered so plugin handlers are available when the renderer connects.
  const settings = await settingsStore.read();
  refreshPluginNetSnapshot(settings.plugins);

  // Initialise the process-wide EngagementController singleton BEFORE loadPlugins so that
  // ctx.attackEgress.proxyUrl() is callable (returns '' when idle) from any plugin setup
  // that runs during loadPlugins. registerIpc reuses the same singleton — no duplicate construction.
  {
    const { mkdirSync: offMkdirSync, writeFileSync: offWriteFileSync } = await import('node:fs');
    const offensiveDir = join(app.getPath('userData'), 'offensive');
    try { offMkdirSync(offensiveDir, { recursive: true }); } catch { /* exists */ }
    const offSettings = settings.offensive;
    initEngagementController({
      auditDir: offensiveDir,
      settings: {
        confirmMode: offSettings.confirmMode,
        rateLimitPerSec: offSettings.rateLimitPerSec,
        requireSignedAuthorization: offSettings.requireSignedAuthorization,
        issuerKeys: offSettings.issuerKeys ?? [],
        downstreamProxy: offSettings.downstreamProxy
      },
      onAnchorPublicKey: (pubHex, manifestId) => {
        const anchorPath = join(offensiveDir, `${manifestId}.anchor`);
        offWriteFileSync(anchorPath, JSON.stringify({ pubHex, manifestId, anchoredAt: new Date().toISOString() }) + '\n', 'utf8');
      }
    });
  }

  // bgconn: separate Tor instance + connection manager. Constructed (tor NOT spawned here — operator-
  // started lifecycle, spec §4) so getBgConnManager() is live for IPC/tick/teardown and ctx.bgConn is
  // populated for any bgconn-capable plugin. bgTor is spawned lazily by manager.start (ensureTorBootstrapped).
  // Wrapped: this block has fallible awaits (freeBgPort can reject, dynamic imports can throw). A
  // failure here must NOT abort the rest of whenReady (window/IPC/plugins) — leave the singletons
  // unset (null), which wire-deps + IPC already fail-closed on, so bgconn is inert for the session.
  try {
    const { BgconnTor } = await import('./bgconn/tor');
    const { BackgroundConnectionManager } = await import('./bgconn/manager');
    const { setBgConnManager } = await import('./bgconn/singleton');
    const { setBgTor } = await import('./bgconn/tor-singleton');
    const { torPaths } = await import('./chat/transport-tor');
    const bgBase = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
    const bgBundleDir = join(bgBase, 'tor', 'win-x64');
    const bgDataDir = join(app.getPath('userData'), 'bgconn', 'tor-data');
    const net = await import('node:net');
    const freeBgPort = (): Promise<number> => new Promise((res, rej) => {
      const s = net.createServer();
      s.once('error', rej);
      s.listen(0, '127.0.0.1', () => { const p = (s.address() as import('node:net').AddressInfo).port; s.close(() => res(p)); });
    });
    const [bgSocksPort, bgControlPort] = await Promise.all([freeBgPort(), freeBgPort()]);
    const bgTor = new BgconnTor({ torExe: torPaths(bgBundleDir).torExe, dataDir: bgDataDir, socksPort: bgSocksPort, controlPort: bgControlPort });
    setBgTor(bgTor);
    const { coerceBgconnPolicy } = await import('./bgconn/policy');
    const policy = coerceBgconnPolicy(settings.bgconn);
    const bgManager = new BackgroundConnectionManager({
      isTorBootstrapped: () => bgTor.isBootstrapped(),
      now: () => Date.now(), // intentional real-time security timer (idle-teardown/max-session-age); injectable only for test determinism — NOT a verification path
      isVaultUnlocked: () => vault.isUnlocked(),
      socksHost: '127.0.0.1',
      socksPort: bgSocksPort,
      idleTeardownAfterMs: policy.idleTeardownAfterMs,
      maxReconnects: policy.maxReconnects,
      maxSessionAgeMs: policy.maxSessionAgeMs,
      ensureTorBootstrapped: () => bgTor.start(),
      teardownTor: () => bgTor.stop()
    });
    setBgConnManager(bgManager);
  } catch (err) {
    console.error('[bgconn] startup wiring failed; capability inert this session', err);
  }

  await loadPlugins({
    isEnabled: (id) => settings.plugins?.[id]?.enabled ?? true,
    contextDeps: buildContextDeps()
  });
  registerPluginProtocol();

  lockDownWebContents();
  registerMediaProtocol(); // ga98media:// for local audio playback
  registerModelProtocol(); // ga98model:// serves the bundled Vosk model (offline STT)
  registerCctvProxy();     // ga98cctv:// routes CCTV stream bytes through Tor (main-side egress)
  registerIpc(() => mainWindow);
  createWindow();
  lockDownPartitionSessions();
  reminderInterval = startReminderTicker(() => mainWindow);
  // bgconn tick: drives idle-teardown + max-session-age enforcement (manager.tick is a no-op
  // until a worker is live, so this is cheap while nothing is registered).
  bgconnTickInterval = setInterval(() => { getBgConnManager()?.tick(); }, 30_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Electron does NOT await an async before-quit handler. Without preventDefault the process can exit
// before our async teardown runs — which orphans the spawned tor.exe (a non-detached child is not
// killed when its parent dies on Windows). The orphan then holds a file lock on the bundled binary
// inside the install directory, and that lock makes the NSIS uninstaller fail. So: intercept the
// first quit, run teardown to completion (bounded by a timeout so a hung stop can't wedge quit),
// then actually quit. The second before-quit pass (quitCleanupDone === true) falls straight through.
let quitCleanupDone = false;
app.on('before-quit', (event) => {
  if (quitCleanupDone) return;
  event.preventDefault();
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
  if (bgconnTickInterval) {
    clearInterval(bgconnTickInterval);
    bgconnTickInterval = null;
  }
  const teardown = (async () => {
    await cancelAllAiStreams();
    await shutdownAllSessions();
    await shutdownAllShellSessions();
    stopMailPoller();
    await shutdownAllFtp();
    await chat.shutdown().catch(() => { /* tor may not be running */ }); // kills tor.exe → frees the lock
    await getBgConnManager()?.stopAll('quit').catch(() => { /* */ });   // stops workers (awaited)
    await getBgTor()?.stop().catch(() => { /* */ });                     // kills the bgconn tor.exe → frees the lock
    await disableAllPlugins().catch(() => { /* */ });                    // tears down plugin-registered workers
    localAi.stop();
  })();
  // Never let teardown wedge the quit: whichever resolves first, we then quit for real.
  const bounded = Promise.race([teardown, new Promise<void>((resolve) => setTimeout(resolve, 6000))]);
  void bounded.catch(() => { /* best-effort; quit regardless */ }).finally(() => {
    quitCleanupDone = true;
    app.quit();
  });
});

app.on('will-quit', () => { localAi.stop(); getBgTor()?.killNow(); getPluginTor()?.killNow(); }); // sync backstops (idempotent)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
