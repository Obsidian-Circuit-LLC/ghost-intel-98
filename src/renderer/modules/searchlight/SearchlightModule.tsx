import { useEffect, useState } from 'react';
import { useSearchlightStore } from './store';
import { SweepPanel } from './panels/SweepPanel';
import { GraphView } from './panels/GraphView';
import { ReportsPanel } from './panels/ReportsPanel';
import { CasesPanel } from './panels/CasesPanel';
import { Dashboard } from './panels/Dashboard';
import './searchlight.css';

type Tab = 'dashboard' | 'sweep' | 'graph' | 'reports' | 'cases';
const TABS: { key: Tab; label: string }[] = [
  { key: 'dashboard',  label: 'Dashboard' },
  { key: 'sweep',      label: 'Sweep' },
  { key: 'graph',      label: 'Graph' },
  { key: 'reports',    label: 'Reports' },
  { key: 'cases',      label: 'Cases' },
];

export function SearchlightModule({ caseId: _caseId }: { caseId?: string }): JSX.Element {
  const [tab, setTab] = useState<Tab>('dashboard');
  const hydrate = useSearchlightStore((s) => s.hydrate);
  const [hydrated, setHydrated] = useState(false);
  // null = not yet loaded; false = show intro; true = intro done
  const [introDone, setIntroDone] = useState<boolean | null>(null);

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

  useEffect(() => {
    window.api.settings.read().then((st) => setIntroDone(!!st.hasSeenSearchlightIntro));
  }, []);

  const dismissIntro = (): void => {
    window.api.settings.update({ hasSeenSearchlightIntro: true });
    setIntroDone(true);
  };

  return (
    <div className="sl-root">
      {introDone === false && (
        <div className="sl-intro-overlay">
          <div className="sl-intro-card">
            <div className="sl-intro-logo">G</div>
            <h2>Searchlight</h2>
            <p className="sl-intro-sub">Intelligence Workstation</p>
            <p className="sl-intro-title">Opening Searchlight</p>
            <p>Be sure to verify your results.</p>
            <p className="sl-intro-fine">Automated checks are not a substitute for manual verification.</p>
            <button className="sl-intro-proceed" onClick={dismissIntro}>UNDERSTOOD — PROCEED</button>
          </div>
        </div>
      )}
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
        ) : tab === 'dashboard' ? (
          <Dashboard onNavigate={(t) => setTab(t as Tab)} />
        ) : tab === 'sweep' ? (
          <SweepPanel />
        ) : tab === 'graph' ? (
          <GraphView />
        ) : tab === 'reports' ? (
          <ReportsPanel />
        ) : tab === 'cases' ? (
          <CasesPanel />
        ) : (
          <div className="sl-placeholder">{tab}</div>
        )}
      </div>
    </div>
  );
}
