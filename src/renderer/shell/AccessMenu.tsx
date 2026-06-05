/**
 * The "Access" menu (renamed Start). Reads its entries from settings.shortcuts
 * so the user can add/edit/remove from Settings.
 */

import { useSettings, useWindows, type ModuleKey } from '../state/store';
import { moduleTitles } from './Desktop';
import { glyphFor } from './Icon';
import { playClick } from '../audio/synth';
import { confirmDialog } from '../state/dialogs';
import logoUrl from '../assets/logo.png';

interface AccessMenuProps {
  onClose(): void;
}

export function AccessMenu({ onClose }: AccessMenuProps): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const open = useWindows((s) => s.open);

  // The footer "Settings…" entry (below the divider) is the canonical Settings launcher,
  // so drop any settings-target shortcut from the editable list to avoid a duplicate entry.
  // Done at render time so existing installs (which persisted a 'settings' shortcut on disk)
  // are fixed too, not just fresh installs.
  const items = (settings?.shortcuts ?? []).filter((s) => !(s.kind === 'module' && s.target === 'settings'));

  function activate(id: string): void {
    const s = items.find((x) => x.id === id);
    if (!s) return;
    if (settings?.soundEnabled) playClick();
    if (s.kind === 'module') {
      const mod = s.target as ModuleKey;
      open({ module: mod, title: moduleTitles[mod] ?? s.label });
    } else {
      void window.api.system.openExternal(s.target);
    }
    onClose();
  }

  return (
    <div className="ga98-access-menu" role="menu" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ga98-access-rail">
        <img src={logoUrl} alt="" className="ga98-access-rail-logo" />
        <span>Dead Cyber Society 98</span>
      </div>
      <div className="ga98-access-list">
        {items.length === 0 && <div className="ga98-access-entry">(no shortcuts — open Settings)</div>}
        {items.map((s, i) => (
          <div key={s.id}>
            {i > 0 && s.kind === 'url' && items[i - 1]?.kind === 'module' && <div className="ga98-access-separator" />}
            <div
              className="ga98-access-entry"
              role="menuitem"
              tabIndex={0}
              onClick={() => activate(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') activate(s.id);
              }}
            >
              <span className="ga98-access-entry-glyph" aria-hidden="true">
                {s.kind === 'module' ? glyphFor(s.target as ModuleKey) : '🔗'}
              </span>
              <span>{s.label}</span>
            </div>
          </div>
        ))}
        <div className="ga98-access-separator" />
        <div
          className="ga98-access-entry"
          role="menuitem"
          tabIndex={0}
          onClick={() => {
            if (settings?.soundEnabled) playClick();
            useWindows.getState().open({ module: 'settings', title: 'Settings' });
            onClose();
          }}
        >
          <span className="ga98-access-entry-glyph" aria-hidden="true">⚙</span>
          <span>Settings…</span>
        </div>
        <div className="ga98-access-separator" />
        <div
          className="ga98-access-entry"
          role="menuitem"
          tabIndex={0}
          onClick={() => { void shutDown(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') void shutDown(); }}
        >
          <span className="ga98-access-entry-glyph" aria-hidden="true">⏻</span>
          <span>Shut Down…</span>
        </div>
      </div>
    </div>
  );

  async function shutDown(): Promise<void> {
    if (settings?.soundEnabled) playClick();
    onClose();
    const ok = await confirmDialog('Close Dead Cyber Society 98?', 'Shut Down');
    if (ok) await window.api.system.quit();
  }
}
