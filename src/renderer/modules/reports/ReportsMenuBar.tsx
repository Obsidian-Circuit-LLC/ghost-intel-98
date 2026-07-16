/** ReportsMenuBar — the Reports shell's Win98 menu bar (File / Edit / View / Reports / Templates /
 *  Tools / Help). It's a `role="menubar"` row of top-level buttons; clicking one opens a
 *  `ga98-context-menu`-style dropdown whose items dispatch a shared action-id union via
 *  `onAction(id)`. Editor-only items (Save/Save As/Export/Print/Close + all Edit ops) are `disabled`
 *  unless a report is open (`hasOpenReport`); every Templates item is `disabled` — Templates are
 *  deferred to sub-project B, so they're greyed, never a no-op handler. An outside mousedown closes
 *  the open dropdown (mirrors the TextBlock descriptor-popover close). The `ReportsActionId` union is
 *  the shell's canonical action vocabulary — `ReportsToolbar` and the Task 6 dispatcher both use it. */
import { useEffect, useState } from 'react';

export type ReportsActionId =
  | 'new' | 'open' | 'save' | 'saveAs' | 'exportPdf' | 'exportDocx' | 'print' | 'close'
  | 'undo' | 'redo' | 'cut' | 'copy' | 'paste'
  | 'dashboard' | 'refresh'
  | 'contacts' | 'options' | 'about'
  | 'templateSave' | 'templateLibrary' | 'templateUse';

export interface ReportsMenuBarProps {
  /** True when a report is open in the editor view — gates the editor-only items. */
  hasOpenReport: boolean;
  onAction: (id: ReportsActionId) => void;
}

interface MenuItem {
  /** undefined `action` → a divider row. */
  action?: ReportsActionId;
  label?: string;
  /** disabled unless a report is open. */
  editorOnly?: boolean;
  /** always disabled — deferred to sub-project B. */
  templates?: boolean;
}

interface Menu {
  label: string;
  items: MenuItem[];
}

const SEP: MenuItem = {};

const MENUS: Menu[] = [
  {
    label: 'File',
    items: [
      { action: 'new', label: 'New Report' },
      { action: 'open', label: 'Open Report…' },
      SEP,
      { action: 'save', label: 'Save', editorOnly: true },
      { action: 'saveAs', label: 'Save As…', editorOnly: true },
      SEP,
      { action: 'exportPdf', label: 'Export as PDF…', editorOnly: true },
      { action: 'exportDocx', label: 'Export as DOCX…', editorOnly: true },
      { action: 'print', label: 'Print…', editorOnly: true },
      SEP,
      { action: 'close', label: 'Close Report', editorOnly: true }
    ]
  },
  {
    label: 'Edit',
    items: [
      { action: 'undo', label: 'Undo', editorOnly: true },
      { action: 'redo', label: 'Redo', editorOnly: true },
      SEP,
      { action: 'cut', label: 'Cut', editorOnly: true },
      { action: 'copy', label: 'Copy', editorOnly: true },
      { action: 'paste', label: 'Paste', editorOnly: true }
    ]
  },
  {
    label: 'View',
    items: [
      { action: 'dashboard', label: 'Dashboard' },
      { action: 'refresh', label: 'Refresh' }
    ]
  },
  {
    label: 'Reports',
    items: [
      { action: 'new', label: 'New Report' },
      { action: 'open', label: 'Open Report…' },
      SEP,
      { action: 'contacts', label: 'Manage Contacts…' }
    ]
  },
  {
    label: 'Templates',
    items: [
      { action: 'templateSave', label: 'Save as Template…', templates: true },
      { action: 'templateLibrary', label: 'Template Library…', templates: true },
      { action: 'templateUse', label: 'Use Template…', templates: true }
    ]
  },
  {
    label: 'Tools',
    items: [
      { action: 'contacts', label: 'Contact Book…' },
      { action: 'options', label: 'Options…' }
    ]
  },
  {
    label: 'Help',
    items: [
      { action: 'about', label: 'About Reports' }
    ]
  }
];

export function ReportsMenuBar({ hasOpenReport, onAction }: ReportsMenuBarProps): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);

  // Close the open dropdown on any outside mousedown — mirrors the TextBlock descriptor-popover
  // close. Items live in a bar that can scroll/transform independently of the viewport, so a
  // window-level listener is more reliable than a fixed backdrop.
  useEffect(() => {
    if (open === null) return;
    function onDocDown(e: MouseEvent): void {
      const t = e.target as HTMLElement | null;
      // A mousedown whose target isn't an element inside the menu bar (or isn't an element at all —
      // e.g. window/document) is "outside" and closes the dropdown.
      if (!t || typeof t.closest !== 'function' || !t.closest('.ga98-report-menu')) setOpen(null);
    }
    window.addEventListener('mousedown', onDocDown);
    return () => window.removeEventListener('mousedown', onDocDown);
  }, [open]);

  function isDisabled(item: MenuItem): boolean {
    if (item.templates) return true;
    if (item.editorOnly && !hasOpenReport) return true;
    return false;
  }

  return (
    <div className="ga98-report-menubar" role="menubar">
      {MENUS.map((menu) => (
        <div key={menu.label} className="ga98-report-menu">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={open === menu.label}
            data-menu={menu.label}
            className={`ga98-report-menu-top${open === menu.label ? ' ga98-report-menu-top-open' : ''}`}
            onClick={() => setOpen((o) => (o === menu.label ? null : menu.label))}
            onMouseEnter={() => setOpen((o) => (o === null ? o : menu.label))}
          >
            {menu.label}
          </button>
          {open === menu.label && (
            <div className="ga98-context-menu ga98-report-menu-dropdown" role="menu">
              {menu.items.map((item, i) => {
                if (item.action === undefined) {
                  return <div key={`sep-${i}`} className="ga98-report-menu-sep" role="separator" />;
                }
                const disabled = isDisabled(item);
                const action = item.action;
                return (
                  <button
                    key={`${item.action}-${i}`}
                    type="button"
                    role="menuitem"
                    className="ga98-context-menu-item"
                    data-menu-action={item.action}
                    disabled={disabled}
                    onClick={() => { setOpen(null); onAction(action); }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
