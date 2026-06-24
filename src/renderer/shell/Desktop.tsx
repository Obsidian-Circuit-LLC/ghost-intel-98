/**
 * Desktop background + pixel-icon grid. Double-click an icon to open its module.
 * Left column auto-flows the app icons; Shred is pinned bottom-right like the Recycle Bin.
 */

import { useEffect, useState } from 'react';
import { Icon, glyphFor, glyphNodeFor } from './Icon';
import { useSettings, useWindows, type ModuleKey } from '../state/store';
import { getModule } from '../state/registry';
import { playClick } from '../audio/synth';

// Left-column desktop icons (auto-flow grid). Shred is intentionally NOT here — it's pinned to
// the bottom-right corner like the classic Windows Recycle Bin (cornerShortcuts below).
const desktopShortcutDefaults: { module: ModuleKey; label: string }[] = [
  { module: 'cases', label: 'My Cases' },
  { module: 'notepad', label: 'Notepad 98' },
  { module: 'briefcase', label: 'Briefcase' },
  { module: 'bookmarks', label: 'Bookmarks' },
  { module: 'calendar', label: 'Calendar' },
  { module: 'reminders', label: 'Reminders' },
  { module: 'chat', label: 'Chat (beta)' },
  { module: 'searchlight', label: 'Searchlight' }
];

// Pinned to the bottom-right corner (Recycle Bin position).
const cornerShortcuts: { module: ModuleKey; label: string }[] = [
  { module: 'shred', label: 'Shred' }
];


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
        open({ module: s.module, title: getModule(s.module)?.title ?? s.module });
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

