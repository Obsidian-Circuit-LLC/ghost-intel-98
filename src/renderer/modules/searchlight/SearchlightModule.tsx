import { useState } from 'react';
import './searchlight.css';

type Tab = 'dashboard' | 'sweep' | 'graph' | 'whiteboard' | 'reports' | 'cases';
const TABS: { key: Tab; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' }, { key: 'sweep', label: 'Sweep' }, { key: 'graph', label: 'Graph' },
  { key: 'whiteboard', label: 'Whiteboard' }, { key: 'reports', label: 'Reports' }, { key: 'cases', label: 'Cases' }
];

export function SearchlightModule({ caseId: _caseId }: { caseId?: string }): JSX.Element {
  const [tab, setTab] = useState<Tab>('sweep');
  return (
    <div className="sl-root">
      <div className="sl-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key}
            className={`sl-tab${tab === t.key ? ' sl-tab-active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <div className="sl-body">
        {/* Panels wired in Tasks 9–12 */}
        <div className="sl-placeholder">{tab} — coming up</div>
      </div>
    </div>
  );
}
