/** ReportsNavTree — the Reports shell's left Explorer pane: a collapsible navigation tree over the
 *  nav nodes (Dashboard · Reports[All / Recent / Drafts / Archived] · Contacts[My Contacts]) plus a
 *  Quick Actions panel. Selecting a node calls `onSelect(node)`; the active node carries the
 *  `ga98-report-nav-active` selection class (dark-blue-on-white, styled in Task 7). The Reports and
 *  Contacts branches expand/collapse via local state. Quick Actions offers "Start New Report"
 *  (→ onNewReport) and "Manage Contacts" (→ onManageContacts); the "Use Template" action is rendered
 *  `disabled` — Templates are deferred to sub-project B, so it is greyed rather than a no-op handler. */
import { useState } from 'react';
import type { NavNode } from './reports-filters';

export interface ReportsNavTreeProps {
  active: NavNode;
  onSelect: (node: NavNode) => void;
  onNewReport: () => void;
  onManageContacts: () => void;
}

const REPORT_NODES: { node: NavNode; label: string }[] = [
  { node: 'all', label: 'All Reports' },
  { node: 'recent', label: 'Recent' },
  { node: 'drafts', label: 'Drafts' },
  { node: 'archived', label: 'Archived' }
];

export function ReportsNavTree({ active, onSelect, onNewReport, onManageContacts }: ReportsNavTreeProps): JSX.Element {
  const [reportsOpen, setReportsOpen] = useState(true);
  const [contactsOpen, setContactsOpen] = useState(true);

  const leafClass = (node: NavNode): string =>
    `ga98-report-nav-leaf${active === node ? ' ga98-report-nav-active' : ''}`;

  return (
    <div className="ga98-report-nav">
      <div className="ga98-report-nav-tree" role="tree">
        <button
          type="button"
          data-nav="dashboard"
          className={leafClass('dashboard')}
          onClick={() => onSelect('dashboard')}
        >
          Dashboard
        </button>

        <div className="ga98-report-nav-branch">
          <button
            type="button"
            data-nav-toggle="reports"
            className="ga98-report-nav-branch-head"
            aria-expanded={reportsOpen}
            onClick={() => setReportsOpen((o) => !o)}
          >
            <span className="ga98-report-nav-twisty">{reportsOpen ? '−' : '+'}</span> Reports
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
                  {label}
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
            <span className="ga98-report-nav-twisty">{contactsOpen ? '−' : '+'}</span> Contacts
          </button>
          {contactsOpen && (
            <div className="ga98-report-nav-children">
              <button
                type="button"
                data-nav="my-contacts"
                className="ga98-report-nav-leaf"
                onClick={onManageContacts}
              >
                My Contacts
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="ga98-report-nav-quick">
        <div className="ga98-report-nav-quick-title">Quick Actions</div>
        <button type="button" className="ga98-report-nav-quick-btn" onClick={onNewReport}>Start New Report</button>
        <button type="button" className="ga98-report-nav-quick-btn" onClick={onManageContacts}>Manage Contacts</button>
        {/* Templates deferred to sub-project B — rendered disabled, never a no-op handler. */}
        <button type="button" className="ga98-report-nav-quick-btn" disabled title="Templates coming soon">Use Template</button>
      </div>
    </div>
  );
}
