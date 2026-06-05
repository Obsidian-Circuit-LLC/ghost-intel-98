/**
 * App root. Owns the Desktop, Taskbar, and the multi-window manager.
 * No router — the "modules" are windows, not URLs.
 */

import { useEffect } from 'react';
import { useAuth, useSettings, useWindows } from './state/store';
import { Desktop } from './shell/Desktop';
import { Taskbar } from './shell/Taskbar';
import { Window } from './shell/Window';
import { ModuleHost } from './shell/ModuleHost';
import { DialogHost } from './shell/Dialog';
import { Toaster } from './shell/Toaster';
import { Shortcuts } from './shell/Shortcuts';
import { Welcome } from './shell/Welcome';
import { LockScreen } from './shell/LockScreen';
import { StickyNotes } from './shell/StickyNotes';
import { playBoot, playReminder, playMouseClick } from './audio/synth';
import { toast } from './state/toasts';
import defaultWallpaper from './assets/wallpaper.jpg';

export function App(): JSX.Element {
  const windows = useWindows((s) => s.windows);
  const focusStack = useWindows((s) => s.focusStack);
  const focus = useWindows((s) => s.focus);
  const close = useWindows((s) => s.close);
  const minimize = useWindows((s) => s.minimize);
  const toggleMaximize = useWindows((s) => s.toggleMaximize);
  const update = useWindows((s) => s.update);
  const loadSettings = useSettings((s) => s.load);
  const settings = useSettings((s) => s.settings);
  const authStatus = useAuth((s) => s.status);
  const refreshAuth = useAuth((s) => s.refresh);

  useEffect(() => {
    void loadSettings();
    void refreshAuth();
  }, [loadSettings, refreshAuth]);

  useEffect(() => {
    if (settings?.startupSoundEnabled && settings.soundEnabled) {
      playBoot();
    }
  }, [settings?.startupSoundEnabled, settings?.soundEnabled]);

  // Global retro mouse-click on every <button>. Delegated at the document so it covers
  // buttons in any module/dialog without per-component wiring. Read soundEnabled live
  // (getState) so the listener binds once and never goes stale. Desktop icons and Access
  // menu entries are <div role="menuitem">, not <button>, so they keep their own playClick
  // call without double-triggering here.
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('button')) return;
      // Don't click-sound (or lazily spin up the AudioContext) behind the lock screen.
      const auth = useAuth.getState().status;
      if (auth?.enabled === true && auth.unlocked === false) return;
      if (useSettings.getState().settings?.soundEnabled) playMouseClick();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // Reflect the theme-intensity setting onto the document root so the CSS in
  // theme.css can style the whole shell (desktop, windows, lock screen) per level.
  useEffect(() => {
    document.documentElement.dataset.ga98Intensity = settings?.themeIntensity ?? 'classic';
  }, [settings?.themeIntensity]);

  useEffect(() => {
    const off = window.api.system.onReminderFired(({ reminder }) => {
      if (useSettings.getState().settings?.soundEnabled) playReminder();
      // The sticky-notes layer surfaces the reminder as a desktop note (OK to complete);
      // a toast covers the case where notes are globally hidden.
      toast.info(`Reminder: ${reminder.title}`);
    });
    return () => off();
  }, []);

  // Diagnostic events from main (broken reminders, etc.) surface as a toast + log.
  useEffect(() => {
    const off = window.api.system.onDiagnostic((payload) => {
      // eslint-disable-next-line no-console
      console.warn('[diagnostic]', payload);
      if (payload.kind === 'reminders-broken') {
        const n = payload.cases?.length ?? 0;
        toast.warn(`Reminders failed to fire for ${n} case${n === 1 ? '' : 's'}. Open Settings → diagnostics for details.`);
      } else if (payload.kind === 'main-error') {
        toast.error(`Background error: ${payload.message ?? 'unknown'} — the app stayed up; retry the last action.`);
      }
    });
    return () => off();
  }, []);

  // Gate the desktop behind the vault: enabled-but-locked shows the lock screen; until the
  // first auth.status returns we render only the wallpaper (no flash of either UI).
  const locked = authStatus?.enabled === true && authStatus.unlocked === false;
  const ready = authStatus !== null;

  return (
    <div
      className="ga98-screen"
      style={{
        // Default to the DCS98 flame wallpaper; a user-set wallpaperImage overrides it. The
        // color paints behind the image so edges blend on aspect ratios that don't fill.
        background: `${settings?.wallpaperColor ?? '#008080'} url(${JSON.stringify(settings?.wallpaperImage ?? defaultWallpaper)}) center / cover no-repeat`
      }}
    >
      {ready && locked && <LockScreen />}
      {ready && !locked && (
        <>
          <Shortcuts />
          <Desktop />
          {/* Render EVERY open window — including minimized ones — and let the Window
              frame hide minimized ones via display:none. Unmounting a minimized window
              (the old behavior) destroyed its live state: the Jukebox <audio> element,
              the AI conversation, unsaved Notepad text. Keeping it mounted-but-hidden
              preserves all of that while still removing it from view and the focus order.
              .slice() because .sort() mutates in place and the store array is shared. */}
          {windows
            .slice()
            .sort((a, b) => focusStack.indexOf(a.id) - focusStack.indexOf(b.id))
            .map((w) => (
              <Window
                key={w.id}
                spec={w}
                focused={focusStack[focusStack.length - 1] === w.id}
                onFocus={() => focus(w.id)}
                onClose={() => close(w.id)}
                onMinimize={() => minimize(w.id)}
                onToggleMaximize={() => toggleMaximize(w.id)}
                onMove={(x, y) => update(w.id, { x, y })}
                onResize={(width, height) => update(w.id, { width, height })}
              >
                <ModuleHost spec={w} />
              </Window>
            ))}
          <StickyNotes />
          <Taskbar />
          <Welcome />
        </>
      )}
      <Toaster />
      <DialogHost />
    </div>
  );
}
