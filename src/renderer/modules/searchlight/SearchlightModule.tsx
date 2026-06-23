import { useEffect, useState } from 'react';
import { useSearchlightStore } from './store';
import { SweepPanel } from './panels/SweepPanel';
import { GraphView } from './panels/GraphView';
import './searchlight.css';

type Tab = 'dashboard' | 'sweep' | 'graph' | 'whiteboard' | 'reports' | 'cases';
const TABS: { key: Tab; label: string }[] = [
  { key: 'dashboard',  label: 'Dashboard' },
  { key: 'sweep',      label: 'Sweep' },
  { key: 'graph',      label: 'Graph' },
  { key: 'whiteboard', label: 'Whiteboard' },
  { key: 'reports',    label: 'Reports' },
  { key: 'cases',      label: 'Cases' },
];

export function SearchlightModule({ caseId: _caseId }: { caseId?: string }): JSX.Element {
  const [tab, setTab] = useState<Tab>('sweep');
  const hydrate = useSearchlightStore((s) => s.hydrate);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hydrate().then(() => {
      if (!cancelled) setHydrated(true);
    }).catch((err) => {
      // Non-fatal: the store may be empty on first launch
      console.warn('[Searchlight] hydrate failed:', err);
      if (!cancelled) setHydrated(true);
    });
    return () => { cancelled = true; };
  }, [hydrate]);

  return (
    <div className="sl-root">
      <div className="sl-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`sl-tab${tab === t.key ? ' sl-tab-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="sl-body">
        {!hydrated ? (
          <div className="sl-placeholder">Loading cases…</div>
        ) : tab === 'sweep' ? (
          <SweepPanel />
        ) : tab === 'graph' ? (
          <GraphView />
        ) : (
          <div className="sl-placeholder">{tab} — coming in Tasks 11–12</div>
        )}
      </div>
    </div>
  );
}
