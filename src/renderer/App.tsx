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
import { playStartup, playReminder } from './audio/synth';
import { toast } from './state/toasts';

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
      playStartup();
    }
  }, [settings?.startupSoundEnabled, settings?.soundEnabled]);

  useEffect(() => {
    const off = window.api.system.onReminderFired(({ reminder }) => {
      if (useSettings.getState().settings?.soundEnabled) playReminder();
      useWindows.getState().open({
        module: 'reminders',
        title: `Reminder — ${reminder.title}`,
        props: { highlight: reminder.id },
        width: 540,
        height: 360
      });
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
        background: settings?.wallpaperImage
          ? `${settings.wallpaperColor ?? '#008080'} url(${JSON.stringify(settings.wallpaperImage)}) center / cover no-repeat`
          : (settings?.wallpaperColor ?? '#008080')
      }}
    >
      {ready && locked && <LockScreen />}
      {ready && !locked && (
        <>
          <Shortcuts />
          <Desktop />
          {windows
            .filter((w) => !w.minimized)
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
          <Taskbar />
          <Welcome />
        </>
      )}
      <Toaster />
      <DialogHost />
    </div>
  );
}
