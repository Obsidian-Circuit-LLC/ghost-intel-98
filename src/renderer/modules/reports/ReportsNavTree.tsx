/** ReportsNavTree — the Reports shell's left Explorer pane, styled as two Win98 MDI-style panels
 *  ("Navigation" + "Quick Actions", each with a blue title bar). The Navigation panel is a collapsible
 *  tree over the nav nodes (Dashboard · Reports[All / Recent / Drafts / Archived] · Contacts[My
 *  Contacts] · Templates[My Templates]) with classic folder / house / page glyphs; selecting a node
 *  calls `onSelect(node)` and
 *  the active node carries `ga98-report-nav-active` (dark-blue-on-white). Quick Actions offers
 *  "Start New Report" (→ onNewReport), "Manage Contacts" (→ onManageContacts) and "Use Template"
 *  (→ onViewTemplates, opening the Templates library). The title-bar "×" is a decorative aria-hidden
 *  span (window chrome), NOT an operable control. */
import { useState } from 'react';
import type { NavNode } from './reports-filters';

export interface ReportsNavTreeProps {
  active: NavNode;
  onSelect: (node: NavNode) => void;
  onNewReport: () => void;
  onManageContacts: () => void;
  /** Open the Templates library view. Optional so older callers/test stubs stay valid; when absent
   *  the "My Templates" leaf simply does nothing (never a crashing handler). */
  onViewTemplates?: () => void;
  /** Whether the Templates library view is the active center view (drives the selection highlight —
   *  the Templates node isn't a report NavNode, so it can't ride the `active` prop). */
  templatesActive?: boolean;
}

const REPORT_NODES: { node: NavNode; label: string }[] = [
  { node: 'all', label: 'All Reports' },
  { node: 'recent', label: 'Recent' },
  { node: 'drafts', label: 'Drafts' },
  { node: 'archived', label: 'Archived' }
];

/** Decorative Win98 title bar. The "×" is chrome, not a control (aria-hidden span). */
function PanelTitle({ label }: { label: string }): JSX.Element {
  return (
    <div className="ga98-report-titlebar">
      <span>{label}</span>
      <span className="ga98-report-titlebar-x" aria-hidden="true">×</span>
    </div>
  );
}

export function ReportsNavTree({ active, onSelect, onNewReport, onManageContacts, onViewTemplates, templatesActive }: ReportsNavTreeProps): JSX.Element {
  const [reportsOpen, setReportsOpen] = useState(true);
  const [contactsOpen, setContactsOpen] = useState(true);
  const [templatesOpen, setTemplatesOpen] = useState(true);

  const leafClass = (node: NavNode): string =>
    `ga98-report-nav-leaf${active === node ? ' ga98-report-nav-active' : ''}`;

  return (
    <div className="ga98-report-nav">
      <div className="ga98-report-panel">
        <PanelTitle label="Navigation" />
        <div className="ga98-report-nav-tree" role="tree">
          <button
            type="button"
            data-nav="dashboard"
            className={leafClass('dashboard')}
            onClick={() => onSelect('dashboard')}
          >
            <span className="ga98-report-nav-ico" aria-hidden="true">🏠</span> Dashboard
          </button>

          <div className="ga98-report-nav-branch">
            <button
              type="button"
              data-nav-toggle="reports"
              className="ga98-report-nav-branch-head"
              aria-expanded={reportsOpen}
              onClick={() => setReportsOpen((o) => !o)}
            >
              <span className="ga98-report-nav-twisty">{reportsOpen ? '−' : '+'}</span>
              <span className="ga98-report-nav-ico" aria-hidden="true">📁</span> Reports
            </button>
            {reportsOpen && (
              <div className="ga98-report-nav-children">
                {REPORT_NODES.map(({ node, label }) => (
                  <button
                    key={node}
                    type="button"
                    data-nav={node}
                    className={leafClass(node)}
                    onClick={() => onSelect(node)}
                  >
                    <span className="ga98-report-nav-ico" aria-hidden="true">📄</span> {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="ga98-report-nav-branch">
            <button
              type="button"
              data-nav-toggle="contacts"
              className="ga98-report-nav-branch-head"
              aria-expanded={contactsOpen}
              onClick={() => setContactsOpen((o) => !o)}
            >
              <span className="ga98-report-nav-twisty">{contactsOpen ? '−' : '+'}</span>
              <span className="ga98-report-nav-ico" aria-hidden="true">📁</span> Contacts
            </button>
            {contactsOpen && (
              <div className="ga98-report-nav-children">
                <button
                  type="button"
                  data-nav="my-contacts"
                  className="ga98-report-nav-leaf"
                  onClick={onManageContacts}
                >
                  <span className="ga98-report-nav-ico" aria-hidden="true">👤</span> My Contacts
                </button>
              </div>
            )}
          </div>

          <div className="ga98-report-nav-branch">
            <button
              type="button"
              data-nav-toggle="templates"
              className="ga98-report-nav-branch-head"
              aria-expanded={templatesOpen}
              onClick={() => setTemplatesOpen((o) => !o)}
            >
              <span className="ga98-report-nav-twisty">{templatesOpen ? '−' : '+'}</span>
              <span className="ga98-report-nav-ico" aria-hidden="true">📁</span> Templates
            </button>
            {templatesOpen && (
              <div className="ga98-report-nav-children">
                <button
                  type="button"
                  data-nav="templates"
                  className={`ga98-report-nav-leaf${templatesActive ? ' ga98-report-nav-active' : ''}`}
                  onClick={() => onViewTemplates?.()}
                >
                  <span className="ga98-report-nav-ico" aria-hidden="true">📋</span> My Templates
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="ga98-report-panel">
        <PanelTitle label="Quick Actions" />
        <div className="ga98-report-nav-quick">
          <div className="ga98-report-nav-quick-title">Quick Actions</div>
          <button type="button" className="ga98-report-nav-quick-btn" onClick={onNewReport}>
            <span className="ga98-report-btn-ico" aria-hidden="true">📝</span> Start New Report
          </button>
          <button type="button" className="ga98-report-nav-quick-btn" onClick={onManageContacts}>
            <span className="ga98-report-btn-ico" aria-hidden="true">👥</span> Manage Contacts
          </button>
          <button type="button" className="ga98-report-nav-quick-btn" title="Create a report from a saved template" onClick={() => onViewTemplates?.()}>
            <span className="ga98-report-btn-ico" aria-hidden="true">📋</span> Use Template
          </button>
        </div>
      </div>
    </div>
  );
}
