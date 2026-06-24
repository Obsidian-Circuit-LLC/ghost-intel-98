/**
 * Dashboard — Task 12 port.
 *
 * Port transforms from .searchlight-source/src/renderer/components/Dashboard/Dashboard.tsx:
 * 1. useAppStore → useSearchlightStore; Case → SearchlightCase.
 * 2. isFound: source uses r.found ?? r.statusCode===200; SweepResult.found is a first-class
 *    boolean field — use it directly.
 * 3. onNavigate(tab) prop wired to the SearchlightModule tab setter.
 * 4. sfx removed.
 * 5. No framer-motion, no lucide-react.
 * 6. Stats sourced entirely from the store — no network.
 */

import { useMemo } from 'react';
import { useSearchlightStore } from '../store';

interface DashboardProps {
  onNavigate: (tab: string) => void;
}

export function Dashboard({ onNavigate }: DashboardProps): JSX.Element {
  const cases        = useSearchlightStore((s) => s.cases);
  const activeCaseId = useSearchlightStore((s) => s.activeCaseId);
  const createCase   = useSearchlightStore((s) => s.createCase);
  const setActiveCaseId = useSearchlightStore((s) => s.setActiveCaseId);

  const activeCase = cases.find((c) => c.id === activeCaseId) ?? null;

  const stats = useMemo(() => {
    const allResults = cases.flatMap((c) => c.searches.flatMap((s) => s.results));
    const found      = allResults.filter((r) => r.found).length;
    const total      = allResults.length;
    const searches   = cases.reduce((sum, c) => sum + c.searches.length, 0);
    return { found, total, searches, cases: cases.length };
  }, [cases]);

  const recentCases = useMemo(
    () => [...cases].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5),
    [cases]
  );

  const activeCaseStats = useMemo(() => {
    if (!activeCase) return null;
    const results = activeCase.searches.flatMap((s) => s.results);
    const found   = results.filter((r) => r.found).length;
    return { found, total: results.length };
  }, [activeCase]);

  return (
    <div className="sl-dash-root">
      {/* Header */}
      <div className="sl-dash-header">
        <div className="sl-rp-header-eyebrow">// INTELLIGENCE PLATFORM</div>
        <div className="sl-dash-title">
          GHOST INTEL{' '}
          <span className="sl-dash-title-accent">USERNAME SWEEPER</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="sl-dash-stats-row">
        {[
          { label: 'ACTIVE CASES',   value: stats.cases,   cls: 'sl-stat-blue',   icon: '◧' },
          { label: 'TOTAL SWEEPS',   value: stats.searches, cls: 'sl-stat-cyan',   icon: '◈' },
          { label: 'PROFILES FOUND', value: stats.found,   cls: 'sl-stat-green',  icon: '●' },
          { label: 'TOTAL CHECKED',  value: stats.total,   cls: 'sl-stat-mid',    icon: '◌' },
        ].map(({ label, value, cls, icon }) => (
          <div key={label} className="sl-dash-stat-card">
            <div className={`sl-dash-stat-icon ${cls}`}>{icon}</div>
            <div className={`sl-dash-stat-val ${cls}`}>
              {value.toLocaleString()}
            </div>
            <div className="sl-dash-stat-lbl">{label}</div>
          </div>
        ))}
      </div>

      {/* Active case + Recent cases */}
      <div className="sl-rp-grid-2">

        {/* Active case */}
        <div className="sl-rp-panel">
          <div className="sl-dash-panel-hdr">
            <span className="sl-rp-section-label" style={{ marginBottom: 0 }}>ACTIVE CASE</span>
            {activeCase && (
              <span className="sl-dash-operational-badge">OPERATIONAL</span>
            )}
          </div>

          {activeCase ? (
            <div>
              <div className="sl-dash-active-name">{activeCase.name}</div>
              {activeCase.description && (
                <div className="sl-dash-active-desc">{activeCase.description}</div>
              )}
              <div className="sl-rp-stats-grid" style={{ marginBottom: 14 }}>
                {[
                  { label: 'SWEEPS',         val: activeCase.searches.length       },
                  { label: 'PROFILES FOUND', val: activeCaseStats?.found ?? 0      },
                  { label: 'URLS CHECKED',   val: activeCaseStats?.total ?? 0      },
                  { label: 'GRAPH NODES',    val: activeCase.graphNodes.length     },
                ].map(({ label, val }) => (
                  <div key={label} className="sl-rp-stat-box">
                    <div className="sl-rp-stat-val sl-stat-blue">{val}</div>
                    <div className="sl-rp-stat-lbl">{label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="sl-sweep-btn sl-sweep-btn-primary"
                  onClick={() => onNavigate('sweep')}
                >
                  ◈ START SWEEP
                </button>
                <button
                  className="sl-sweep-btn"
                  onClick={() => onNavigate('graph')}
                >
                  ⬡ GRAPH
                </button>
              </div>
            </div>
          ) : (
            <div className="sl-dash-no-case">
              <div className="sl-dash-no-case-icon">◧</div>
              <div className="sl-dash-no-case-text">NO ACTIVE CASE</div>
              <button
                className="sl-sweep-btn sl-sweep-btn-primary"
                onClick={() => {
                  const name = `CASE-${Date.now().toString(36).toUpperCase()}`;
                  const newCase = createCase(name, 'New investigation');
                  setActiveCaseId(newCase.id);
                  onNavigate('cases');
                }}
              >
                + CREATE NEW CASE
              </button>
            </div>
          )}
        </div>

        {/* Recent cases */}
        <div className="sl-rp-panel">
          <div className="sl-dash-panel-hdr">
            <span className="sl-rp-section-label" style={{ marginBottom: 0 }}>RECENT CASES</span>
            <button
              className="sl-sweep-btn sl-sweep-btn-primary"
              onClick={() => onNavigate('cases')}
            >
              VIEW ALL
            </button>
          </div>

          {recentCases.length === 0 ? (
            <div className="sl-dash-recent-empty">NO CASES FOUND</div>
          ) : (
            <div className="sl-dash-recent-list">
              {recentCases.map((c) => {
                const results  = c.searches.flatMap((s) => s.results);
                const found    = results.filter((r) => r.found).length;
                const isActive = c.id === activeCaseId;
                return (
                  <button
                    key={c.id}
                    className={`sl-dash-recent-row${isActive ? ' sl-dash-recent-row-active' : ''}`}
                    onClick={() => {
                      setActiveCaseId(c.id);
                      onNavigate('sweep');
                    }}
                  >
                    <div>
                      <div
                        className="sl-dash-recent-name"
                        style={{ color: isActive ? '#00e5ff' : undefined }}
                      >
                        {c.name}
                      </div>
                      <div className="sl-dash-recent-meta">
                        {new Date(c.updatedAt).toLocaleDateString()} · {c.searches.length} sweeps
                      </div>
                    </div>
                    <div
                      className="sl-dash-recent-found"
                      style={{ color: found > 0 ? '#00ff88' : '#30405a' }}
                    >
                      {found}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="sl-dash-quick-actions">
        {[
          { label: 'NEW SWEEP',     desc: 'Search a username',       icon: '◈', tab: 'sweep',   cls: 'sl-stat-blue'  },
          { label: 'GRAPH VIEW',    desc: 'Relationship map',         icon: '⬡', tab: 'graph',   cls: 'sl-stat-purple'},
          { label: 'MANAGE CASES',  desc: 'Organize & collaborate',   icon: '◧', tab: 'cases',   cls: 'sl-stat-cyan'  },
          { label: 'EXPORT REPORT', desc: 'Generate findings',        icon: '≣', tab: 'reports', cls: 'sl-stat-green' },
        ].map(({ label, desc, icon, tab, cls }) => (
          <button
            key={label}
            className="sl-dash-qa-btn"
            onClick={() => onNavigate(tab)}
          >
            <div className={`sl-dash-qa-icon ${cls}`}>{icon}</div>
            <div className="sl-dash-qa-label">{label}</div>
            <div className="sl-dash-qa-desc">{desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
