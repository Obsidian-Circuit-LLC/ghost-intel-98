/**
 * The "Access" menu (renamed Start). Reads its entries from settings.shortcuts
 * so the user can add/edit/remove from Settings.
 */

import { useState } from 'react';
import { useSettings, useWindows, type ModuleKey } from '../state/store';
import { getModule, listModules } from '../state/registry';
import { buildOsintDirectory } from '../modules/osint-toolkit/directory';
import { glyphFor } from './Icon';
import { playClick } from '../audio/synth';
import { confirmDialog } from '../state/dialogs';
import { CLOCK_ENABLED_KEY } from './ClockWidget';
import logoUrl from '../assets/logo.png';

interface AccessMenuProps {
  onClose(): void;
}

/** Games live in their own "Games ▸" submenu (not on the desktop, not flat in the menu). */
const GAMES: { module: ModuleKey; label: string }[] = [
  { module: 'solitaire', label: 'Solitaire' },
  { module: 'minesweeper', label: 'Mine Detector' },
  { module: 'chess', label: 'Chess' },
  { module: 'pinball', label: 'Ghost Space Ball' }
];
const GAME_TARGETS = new Set<string>(GAMES.map((g) => g.module));

export function AccessMenu({ onClose }: AccessMenuProps): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const open = useWindows((s) => s.open);
  const [gamesOpen, setGamesOpen] = useState(false);
  const [osintOpen, setOsintOpen] = useState(false);
  // OSINT modules live in the "OSINT Toolkit ▸" submenu (grouped by subcategory), not flat in the
  // menu. Derived from the live registry at render time (like the flat-items filter below) so it
  // reflects modules registered after this file was imported, and covers new OSINT modules for free.
  const modules = listModules();
  const osintGroups = buildOsintDirectory(modules);
  const OSINT_TARGETS = new Set<string>(modules.filter((m) => m.category === 'osint').map((m) => m.key));
  let clockOn = false;
  try { clockOn = localStorage.getItem(CLOCK_ENABLED_KEY) === '1'; } catch { /* storage off */ }

  // Drop the footer 'Settings' launcher's duplicate, and any game shortcuts (games live in the Games
  // submenu now). Done at render time so existing installs are fixed too, not just fresh ones.
  const items = (settings?.shortcuts ?? []).filter(
    (s) => !(s.kind === 'module' && (s.target === 'settings' || GAME_TARGETS.has(s.target) || OSINT_TARGETS.has(s.target)))
  );

  function openModule(mod: ModuleKey, label: string): void {
    if (settings?.soundEnabled) playClick();
    open({ module: mod, title: getModule(mod)?.title ?? label });
    onClose();
  }

  function activate(id: string): void {
    const s = items.find((x) => x.id === id);
    if (!s) return;
    if (settings?.soundEnabled) playClick();
    if (s.kind === 'module') {
      const mod = s.target as ModuleKey;
      open({ module: mod, title: getModule(mod)?.title ?? s.label });
    } else {
      void window.api.system.openExternal(s.target);
    }
    onClose();
  }

  return (
    <div className="ga98-access-menu" role="menu" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ga98-access-rail">
        <img src={logoUrl} alt="" className="ga98-access-rail-logo" />
        <span>Ghost Intel 98</span>
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
        {/* Games submenu — hover (or click) to fan out. The flyout is a DOM descendant of this
            wrapper, so moving onto it does not fire the wrapper's mouseleave (stays open). */}
        <div style={{ position: 'relative' }} onMouseEnter={() => setGamesOpen(true)} onMouseLeave={() => setGamesOpen(false)}>
          <div
            className="ga98-access-entry"
            role="menuitem"
            tabIndex={0}
            aria-haspopup="true"
            aria-expanded={gamesOpen}
            onClick={() => setGamesOpen((o) => !o)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') setGamesOpen(true); }}
          >
            <span className="ga98-access-entry-glyph" aria-hidden="true">🎮</span>
            <span style={{ flex: 1 }}>Games</span>
            <span aria-hidden="true" style={{ opacity: 0.7 }}>▸</span>
          </div>
          {gamesOpen && (
            <div role="menu" style={{ position: 'absolute', left: '100%', top: 0, minWidth: 160, background: '#c0c0c0', border: '2px outset #f5f5f5', boxShadow: '2px 2px 5px rgba(0,0,0,0.4)', zIndex: 30 }}>
              {GAMES.map((g) => (
                <div
                  key={g.module}
                  className="ga98-access-entry"
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => openModule(g.module, g.label)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openModule(g.module, g.label); }}
                >
                  <span className="ga98-access-entry-glyph" aria-hidden="true">{glyphFor(g.module)}</span>
                  <span>{g.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="ga98-access-separator" />
        {/* OSINT Toolkit submenu — hover (or click) to fan out. ONE hop only: grouped subcategory
            headings + one big clickable row per tool, each launching that module immediately (no
            nested sub-submenu). Grouping/ordering is buildOsintDirectory's, shared with the toolkit
            window. The flyout is a DOM descendant of this wrapper, so moving onto it does not fire
            the wrapper's mouseleave (stays open). */}
        <div style={{ position: 'relative' }} onMouseEnter={() => setOsintOpen(true)} onMouseLeave={() => setOsintOpen(false)}>
          <div
            className="ga98-access-entry"
            role="menuitem"
            tabIndex={0}
            aria-haspopup="true"
            aria-expanded={osintOpen}
            onClick={() => setOsintOpen((o) => !o)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') setOsintOpen(true); }}
          >
            <span className="ga98-access-entry-glyph" aria-hidden="true">{glyphFor('osint-toolkit')}</span>
            <span style={{ flex: 1 }}>OSINT Toolkit</span>
            <span aria-hidden="true" style={{ opacity: 0.7 }}>▸</span>
          </div>
          {/* Anchor the flyout to the BOTTOM of the parent row so it grows UPWARD: the Access menu
              is bottom-anchored near the taskbar, and this flyout (4 headings + up to 10 tool rows)
              is far taller than the Games one — opening downward from top:0 would run its lower
              groups off the bottom of the screen and make them unclickable. maxHeight/overflow cap
              the rare case it's taller than the space above. */}
          {osintOpen && (
            <div role="menu" style={{ position: 'absolute', left: '100%', bottom: 0, minWidth: 180, background: '#c0c0c0', border: '2px outset #f5f5f5', boxShadow: '2px 2px 5px rgba(0,0,0,0.4)', zIndex: 30, maxHeight: '70vh', overflowY: 'auto' }}>
              {osintGroups.map((group) => (
                <div key={group.subcategory}>
                  <div className="ga98-access-osint-group" style={{ padding: '2px 8px', fontWeight: 'bold', opacity: 0.75, fontSize: '0.85em' }}>
                    {group.subcategory}
                  </div>
                  {group.tools.map((tool) => (
                    <div
                      key={tool.key}
                      className="ga98-access-entry"
                      role="menuitem"
                      tabIndex={0}
                      data-osint-key={tool.key}
                      onClick={() => openModule(tool.key as ModuleKey, tool.title)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openModule(tool.key as ModuleKey, tool.title); }}
                    >
                      <span className="ga98-access-entry-glyph" aria-hidden="true">{tool.glyph}</span>
                      <span>{tool.title}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="ga98-access-separator" />
        <div
          className="ga98-access-entry"
          role="menuitem"
          tabIndex={0}
          onClick={() => {
            if (settings?.soundEnabled) playClick();
            window.dispatchEvent(new Event('ga98:toggle-clock'));
            onClose();
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { window.dispatchEvent(new Event('ga98:toggle-clock')); onClose(); } }}
        >
          <span className="ga98-access-entry-glyph" aria-hidden="true">🕐</span>
          <span style={{ flex: 1 }}>Desktop Clock</span>
          {clockOn && <span aria-hidden="true" style={{ opacity: 0.8 }}>✓</span>}
        </div>
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
    const ok = await confirmDialog('Close Ghost Intel 98?', 'Shut Down');
    if (ok) await window.api.system.quit();
  }
}
