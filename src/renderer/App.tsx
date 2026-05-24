/**
 * App root. Owns the Desktop, Taskbar, and the multi-window manager.
 * No router — the "modules" are windows, not URLs.
 */

import { useEffect } from 'react';
import { useSettings, useWindows } from './state/store';
import { Desktop } from './shell/Desktop';
import { Taskbar } from './shell/Taskbar';
import { Window } from './shell/Window';
import { ModuleHost } from './shell/ModuleHost';
import { playStartup, playReminder } from './audio/synth';

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

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

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

  // Diagnostic events from main (broken reminders, etc.) surface as a Settings → About visit.
  useEffect(() => {
    const off = window.api.system.onDiagnostic((payload) => {
      // eslint-disable-next-line no-console
      console.warn('[diagnostic]', payload);
      if (payload.kind === 'reminders-broken') {
        useWindows.getState().open({
          module: 'settings',
          title: 'Settings — diagnostics',
          width: 720,
          height: 520
        });
      }
    });
    return () => off();
  }, []);

  return (
    <div className="ga98-screen">
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
    </div>
  );
}
