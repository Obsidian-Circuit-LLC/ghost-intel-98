/**
 * Pushes settings.json changes to the renderer as soon as ANY main-side handler writes
 * them — not just the settings.update handler the renderer itself calls. Without this,
 * the renderer's useSettings cache only refreshes on an explicit load()/patch() from THIS
 * window, so a write from another handler (shell enable/disable, bgconn config, searchlight
 * ML toggle, local-ai provider switch) leaves the cache silently stale until the user
 * happens to reopen Settings. `initSettingsNotify` is called once from registerIpc with the
 * same getWindow accessor every other main->renderer push channel uses (see chat.ts, ai.ts,
 * mail-poller.ts); notifySettingsChanged is then callable from anywhere without threading
 * getWindow through every call site.
 */
import type { BrowserWindow } from 'electron';
import type { AppSettings } from '../../shared/types';
import { channels } from '../../shared/ipc-contracts';

let getWindowFn: (() => BrowserWindow | null) | null = null;

export function initSettingsNotify(getWindow: () => BrowserWindow | null): void {
  getWindowFn = getWindow;
}

export function notifySettingsChanged(next: AppSettings): void {
  getWindowFn?.()?.webContents.send(channels.settings.changed, next);
}
