/**
 * Desktop background + pixel-icon grid. Double-click an icon to open its module.
 */

import { useEffect, useState } from 'react';
import { Icon, glyphFor } from './Icon';
import { useSettings, useWindows, type ModuleKey } from '../state/store';
import { playClick } from '../audio/synth';

const desktopShortcutDefaults: { module: ModuleKey; label: string }[] = [
  { module: 'cases', label: 'Case Files' },
  { module: 'notepad', label: 'Notepad 98' },
  { module: 'calendar', label: 'Calendar' },
  { module: 'reminders', label: 'Reminders' },
  { module: 'shred', label: 'Shred' }
];

const moduleTitles: Record<ModuleKey, string> = {
  cases: 'Case Files',
  notepad: 'Notepad 98',
  calendar: 'Calendar',
  reminders: 'Reminders',
  alarm: 'Alarm',
  shred: 'Shred',
  settings: 'Settings',
  'net-explorer': 'Net Explorer',
  mail: 'Mail',
  dialterm: 'DialTerm',
  eyespy: 'EyeSpy',
  'ai-assistant': 'AI Assistant',
  'doc-viewer': 'Document Viewer',
  search: 'Search',
  help: 'Help'
};

export function Desktop(): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);
  const open = useWindows((s) => s.open);
  const settings = useSettings((s) => s.settings);

  useEffect(() => {
    const off = () => setSelected(null);
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, []);

  return (
    <div className="ga98-desktop" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ga98-desktop-grid">
        {desktopShortcutDefaults.map((s) => (
          <Icon
            key={s.module}
            label={s.label}
            glyph={glyphFor(s.module)}
            selected={selected === s.module}
            onSelect={() => setSelected(s.module)}
            onActivate={() => {
              if (settings?.soundEnabled) playClick();
              open({ module: s.module, title: moduleTitles[s.module] });
            }}
          />
        ))}
      </div>
    </div>
  );
}

export { moduleTitles };
