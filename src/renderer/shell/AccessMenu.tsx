/**
 * The "Access" menu (renamed Start). Renders five fixed category flyouts (Programs / Creativity /
 * Music / Network / Organizer) plus the Games and OSINT Toolkit flyouts. `settings.shortcuts`
 * no longer drives any rendering here — the field stays in the schema (Settings still reads/writes
 * it) purely so existing installs / the settings migration path don't break; this menu just no
 * longer consumes it.
 */

import { useEffect, useState } from 'react';
import { useSettings, useWindows, type ModuleKey } from '../state/store';
import { getModule, listModules } from '../state/registry';
import { buildOsintDirectory } from '../modules/osint-toolkit/directory';
import { glyphFor } from './Icon';
import { playClick } from '../audio/synth';
import { confirmDialog } from '../state/dialogs';
import { CLOCK_ENABLED_KEY } from './ClockWidget';
import { toast } from '../state/toasts';
import type { ExternalProgramsScanResult } from '@shared/external-programs/types';
import logoUrl from '../assets/logo.png';

const EMPTY_EXTERNAL_SCAN: ExternalProgramsScanResult = { programs: [], diagnostics: [] };

interface AccessMenuProps {
  onClose(): void;
}

/** The External Apps flyout's one fixed row that opens a module (the other two fixed rows are
 *  direct IPC actions, not module opens) — kept as a typed entry, same shape as every other
 *  launcher row, so `module-reachability.test.ts`'s scan of AccessMenu.tsx sees it for real. */
export const MANAGE_PROGRAMS_ITEM: { module: ModuleKey; label: string } = { module: 'external-programs', label: 'Manage Programs' };

/** Games live in their own "Games ▸" submenu (not on the desktop, not flat in the menu). */
export const GAMES: { module: ModuleKey; label: string }[] = [
  { module: 'solitaire', label: 'Solitaire' },
  { module: 'minesweeper', label: 'Mine Detector' },
  { module: 'chess', label: 'Chess' },
  { module: 'pinball', label: 'Ghost Space Ball' }
];
/** The five fixed category flyouts. Verified against the `ModuleKey` union in `state/store.ts`. */
export const CATEGORIES: { label: string; glyph: string; items: { module: ModuleKey; label: string }[] }[] = [
  { label: 'Programs', glyph: '📁', items: [
    { module: 'cases', label: 'My Cases' }, { module: 'notepad', label: 'Notepad 98' },
    { module: 'briefcase', label: 'Briefcase' }, { module: 'markets', label: 'Markets' },
    { module: 'weather', label: 'Weather' },
    { module: 'search', label: 'Search' }, { module: 'ai-assistant', label: 'Q' } ] },
  { label: 'Creativity', glyph: '🎨', items: [
    { module: 'notepad', label: 'Notepad 98' }, { module: 'journal', label: 'Journal Jots' },
    { module: 'ghost-social', label: 'Ghost Social' } ] },
  { label: 'Music', glyph: '🎵', items: [ { module: 'media-player', label: 'Jukebox' } ] },
  { label: 'Network', glyph: '🖧', items: [
    { module: 'dialterm', label: 'DialTerm' }, { module: 'mail', label: 'Mail' },
    { module: 'chat', label: 'Chat (beta)' }, { module: 'bookmarks', label: 'Bookmarks' } ] },
  { label: 'Organizer', glyph: '📅', items: [
    { module: 'address-book', label: 'HumanDB' },
    { module: 'invoices', label: 'Invoices' }, { module: 'report', label: 'Reports' },
    { module: 'calendar', label: 'Calendar' }, { module: 'reminders', label: 'Reminders' },
    { module: 'alarm', label: 'Alarm' }, { module: 'number-muncher', label: 'Number Muncher' },
    { module: 'pdf-signer', label: 'PDF Signer' } ] }
];

/** Shared flyout shell for a category — extracted from the original Games submenu markup so
 *  Games/OSINT/the five fixed categories all render identically. The flyout panel is a DOM
 *  descendant of the trigger wrapper, so moving onto it does not fire the wrapper's mouseleave
 *  (stays open). */
function CategoryFlyout({ label, glyph, items, onOpen }: {
  label: string; glyph: string; items: { module: ModuleKey; label: string }[]; onOpen: (m: ModuleKey, l: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div
        className="ga98-access-entry"
        role="menuitem"
        tabIndex={0}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') setOpen(true); }}
      >
        <span className="ga98-access-entry-glyph" aria-hidden="true">{glyph}</span>
        <span style={{ flex: 1 }}>{label}</span>
        <span aria-hidden="true" style={{ opacity: 0.7 }}>▸</span>
      </div>
      {open && (
        <div role="menu" style={{ position: 'absolute', left: '100%', top: 0, minWidth: 160, background: 'var(--ga98-grey)', border: '2px outset var(--ga98-flyout-outset)', boxShadow: '2px 2px 5px rgba(0,0,0,0.4)', zIndex: 30 }}>
          {items.map((it) => (
            <div
              key={`${it.module}:${it.label}`}
              className="ga98-access-entry"
              role="menuitem"
              tabIndex={0}
              onClick={() => onOpen(it.module, it.label)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(it.module, it.label); }}
            >
              <span className="ga98-access-entry-glyph" aria-hidden="true">{glyphFor(it.module)}</span>
              <span>{it.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AccessMenu({ onClose }: AccessMenuProps): JSX.Element {
  const settings = useSettings((s) => s.settings);
  const open = useWindows((s) => s.open);
  const [osintOpen, setOsintOpen] = useState(false);
  // OSINT modules live in the "OSINT Toolkit ▸" submenu (grouped by subcategory), not flat in the
  // menu. Derived from the live registry at render time so it reflects modules registered after
  // this file was imported, and covers new OSINT modules for free.
  const modules = listModules();
  const osintGroups = buildOsintDirectory(modules);
  let clockOn = false;
  try { clockOn = localStorage.getItem(CLOCK_ENABLED_KEY) === '1'; } catch { /* storage off */ }

  // External Apps — GhostExodus's "connect ANY app" ask. NEVER hard-coded: this is whatever the
  // main process's live folder scan finds, re-fetched every time the Access menu itself is opened
  // (it's remounted fresh each open — see Taskbar.tsx) so a program dropped in moments ago shows
  // up without hunting for a separate refresh action first. "Refresh Programs" below re-runs the
  // same scan in place for the rare case the menu was left open.
  const [externalOpen, setExternalOpen] = useState(false);
  const [externalScan, setExternalScan] = useState<ExternalProgramsScanResult>(EMPTY_EXTERNAL_SCAN);
  useEffect(() => {
    try {
      window.api.externalPrograms.list().then(setExternalScan).catch(() => { /* main process not ready yet */ });
    } catch { /* window.api not wired (e.g. a render harness that doesn't need it) */ }
  }, []);

  function openModule(mod: ModuleKey, label: string): void {
    if (settings?.soundEnabled) playClick();
    open({ module: mod, title: getModule(mod)?.title ?? label });
    onClose();
  }

  async function refreshExternalPrograms(): Promise<void> {
    try {
      setExternalScan(await window.api.externalPrograms.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function openProgramsFolder(): Promise<void> {
    try {
      await window.api.externalPrograms.openFolder();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function launchExternalProgram(id: string, name: string): Promise<void> {
    if (settings?.soundEnabled) playClick();
    onClose();
    try {
      await window.api.externalPrograms.launch(id);
      toast.success(`Launched ${name}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="ga98-access-menu" role="menu" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ga98-access-rail">
        <img src={logoUrl} alt="" className="ga98-access-rail-logo" />
        <span>Ghost Intel 98</span>
      </div>
      <div className="ga98-access-list">
        {CATEGORIES.map((c) => (
          <CategoryFlyout key={c.label} label={c.label} glyph={c.glyph} items={c.items} onOpen={openModule} />
        ))}
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
            <div role="menu" style={{ position: 'absolute', left: '100%', bottom: 0, minWidth: 180, background: 'var(--ga98-grey)', border: '2px outset var(--ga98-flyout-outset)', boxShadow: '2px 2px 5px rgba(0,0,0,0.4)', zIndex: 30, maxHeight: '70vh', overflowY: 'auto' }}>
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
        {/* External Apps — GhostExodus's "connect ANY app" feature. Same bottom-anchored,
            DOM-descendant flyout shape as OSINT Toolkit above (a submenu row on its own doesn't
            trigger the wrapper's mouseleave). Three fixed actions first, then one row per
            discovered program — clicking a program row launches it directly, it does not open a
            module window, so it deliberately does NOT go through `openModule`. */}
        <div style={{ position: 'relative' }} onMouseEnter={() => setExternalOpen(true)} onMouseLeave={() => setExternalOpen(false)}>
          <div
            className="ga98-access-entry"
            role="menuitem"
            tabIndex={0}
            aria-haspopup="true"
            aria-expanded={externalOpen}
            onClick={() => setExternalOpen((o) => !o)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') setExternalOpen(true); }}
          >
            <span className="ga98-access-entry-glyph" aria-hidden="true">🗂</span>
            <span style={{ flex: 1 }}>External Apps</span>
            <span aria-hidden="true" style={{ opacity: 0.7 }}>▸</span>
          </div>
          {externalOpen && (
            <div role="menu" style={{ position: 'absolute', left: '100%', bottom: 0, minWidth: 200, background: 'var(--ga98-grey)', border: '2px outset var(--ga98-flyout-outset)', boxShadow: '2px 2px 5px rgba(0,0,0,0.4)', zIndex: 30, maxHeight: '70vh', overflowY: 'auto' }}>
              <div className="ga98-access-entry" role="menuitem" tabIndex={0} onClick={() => { void openProgramsFolder(); }}>
                <span className="ga98-access-entry-glyph" aria-hidden="true">📁</span>
                <span>Open Programs Folder</span>
              </div>
              <div className="ga98-access-entry" role="menuitem" tabIndex={0} onClick={() => { void refreshExternalPrograms(); }}>
                <span className="ga98-access-entry-glyph" aria-hidden="true">🔄</span>
                <span>Refresh Programs</span>
              </div>
              <div className="ga98-access-entry" role="menuitem" tabIndex={0} onClick={() => openModule(MANAGE_PROGRAMS_ITEM.module, MANAGE_PROGRAMS_ITEM.label)}>
                <span className="ga98-access-entry-glyph" aria-hidden="true">🗂</span>
                <span>{MANAGE_PROGRAMS_ITEM.label}</span>
              </div>
              <div className="ga98-access-separator" />
              {externalScan.programs.length === 0 && (
                <div style={{ padding: '4px 8px', fontSize: '0.85em', opacity: 0.75 }}>No programs found.</div>
              )}
              {externalScan.programs.map((p) => (
                <div
                  key={p.id}
                  className="ga98-access-entry"
                  role="menuitem"
                  tabIndex={0}
                  data-external-program-id={p.id}
                  title={p.description}
                  onClick={() => { void launchExternalProgram(p.id, p.name); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') void launchExternalProgram(p.id, p.name); }}
                >
                  <span className="ga98-access-entry-glyph" aria-hidden="true">▶</span>
                  <span>{p.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="ga98-access-separator" />
        <CategoryFlyout label="Games" glyph="🎮" items={GAMES} onOpen={openModule} />
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
        <div
          className="ga98-access-entry"
          role="menuitem"
          tabIndex={0}
          onClick={() => {
            if (settings?.soundEnabled) playClick();
            open({ module: 'help', title: 'RTFM' });
            onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (settings?.soundEnabled) playClick();
              open({ module: 'help', title: 'RTFM' });
              onClose();
            }
          }}
        >
          <span className="ga98-access-entry-glyph" aria-hidden="true">❔</span>
          <span>RTFM</span>
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
