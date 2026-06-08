/**
 * Desktop background + pixel-icon grid. Double-click an icon to open its module.
 * Left column auto-flows the app icons; Shred is pinned bottom-right like the Recycle Bin.
 */

import { useEffect, useState } from 'react';
import { Icon, glyphFor, glyphNodeFor } from './Icon';
import { useSettings, useWindows, type ModuleKey } from '../state/store';
import { playClick } from '../audio/synth';

// Left-column desktop icons (auto-flow grid). Shred is intentionally NOT here — it's pinned to
// the bottom-right corner like the classic Windows Recycle Bin (cornerShortcuts below).
const desktopShortcutDefaults: { module: ModuleKey; label: string }[] = [
  { module: 'cases', label: 'My Cases' },
  { module: 'notepad', label: 'Notepad 98' },
  { module: 'briefcase', label: 'Briefcase' },
  { module: 'media-player', label: 'Jukebox' },
  { module: 'geoint', label: 'GeoINT' },
  { module: 'bookmarks', label: 'Bookmarks' },
  { module: 'markets', label: 'Markets' },
  { module: 'calendar', label: 'Calendar' },
  { module: 'reminders', label: 'Reminders' },
  { module: 'chat', label: 'Chat (beta)' }
];

// Pinned to the bottom-right corner (Recycle Bin position).
const cornerShortcuts: { module: ModuleKey; label: string }[] = [
  { module: 'shred', label: 'Shred' }
];

const moduleTitles: Record<ModuleKey, string> = {
  cases: 'My Cases',
  notepad: 'Notepad 98',
  briefcase: 'Briefcase',
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
  whiteboard: 'Whiteboard',
  'media-player': 'Jukebox',
  geoint: 'GeoINT',
  bookmarks: 'Bookmarks',
  markets: 'Markets',
  solitaire: 'Solitaire',
  minesweeper: 'Minesweeper',
  chess: 'Chess',
  pinball: 'Pinball',
  chat: 'Chat (beta)',
  help: 'RTFM'
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

  const renderIcon = (s: { module: ModuleKey; label: string }): JSX.Element => (
    <Icon
      key={s.module}
      label={s.label}
      glyph={glyphFor(s.module)}
      glyphNode={glyphNodeFor(s.module)}
      selected={selected === s.module}
      onSelect={() => setSelected(s.module)}
      onActivate={() => {
        if (settings?.soundEnabled) playClick();
        open({ module: s.module, title: moduleTitles[s.module] });
      }}
    />
  );

  return (
    <div className="ga98-desktop" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ga98-desktop-grid">
        {desktopShortcutDefaults.map(renderIcon)}
      </div>
      <div className="ga98-desktop-corner">
        {cornerShortcuts.map(renderIcon)}
      </div>
    </div>
  );
}

export { moduleTitles };
