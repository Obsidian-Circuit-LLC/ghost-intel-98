/**
 * ReportsPanel — Task 12 port.
 *
 * Port transforms from .searchlight-source/src/renderer/components/Reports/ReportsPanel.tsx:
 * 1. useAppStore → useSearchlightStore; UrlCheckResult → SweepResult.
 * 2. isFound(): source uses r.found ?? r.statusCode===200; SweepResult has a first-class
 *    `found: boolean` field — use that directly.
 * 3. jsPDF / jszip PDF path REMOVED (operator decision — deps not installed).
 * 4. Export via window.api.searchlight.saveReport → native platform save-file dialog
 *    (main-process showSaveDialog + atomic write). No Blob/URL.createObjectURL.
 * 5. HTML report is built as a string — NOT injected into the DOM.
 * 6. sfx removed (not in searchlight surface).
 * 7. Type of "error" field: ProbeErrorType (string | null), not just string — guarded.
 */

import { useState, useMemo } from 'react';
import type { SweepResult } from '@shared/searchlight/types';
import { useSearchlightStore } from '../store';
import { generateHTML, generateCSV, generateJSON, generateTXT } from '../report-gen';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isFound(r: SweepResult): boolean {
  return r.found;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ReportsPanel(): JSX.Element {
  const cases = useSearchlightStore((s) => s.cases);
  const activeCaseId = useSearchlightStore((s) => s.activeCaseId);
  const activeCase = cases.find((c) => c.id === activeCaseId) ?? null;

  const [filterFound, setFilterFound] = useState(false);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());

  const allResults = useMemo(() => {
    if (!activeCase) return [];
    const jobs =
      selectedJobIds.size === 0
        ? activeCase.searches
        : activeCase.searches.filter((j) => selectedJobIds.has(j.id));
    let results = jobs.flatMap((j) => j.results);
    if (filterFound) results = results.filter(isFound);
    return results;
  }, [activeCase, selectedJobIds, filterFound]);

  const toggleJob = (id: string) => {
    setSelectedJobIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) {
        n.delete(id);
      } else {
        n.add(id);
      }
      return n;
    });
  };

  const exportAs = async (format: 'html' | 'csv' | 'json' | 'txt' | 'pdf') => {
    if (!activeCase || !allResults.length) return;
    const name = activeCase.name;
    const slug = name.replace(/\s+/g, '_');

    if (format === 'pdf') {
      const html = generateHTML(name, allResults);
      await window.api.searchlight.exportPdf({ html, filename: `searchlight_${slug}.pdf` });
      return;
    }

    const map: Record<'html' | 'csv' | 'json' | 'txt', { content: string; defaultName: string }> = {
      html: { content: generateHTML(name, allResults),  defaultName: `ghost_intel_${slug}.html` },
      csv:  { content: generateCSV(allResults),          defaultName: `ghost_intel_${slug}.csv`  },
      json: { content: generateJSON(name, allResults),   defaultName: `ghost_intel_${slug}.json` },
      txt:  { content: generateTXT(name, allResults),    defaultName: `ghost_intel_${slug}.txt`  },
    };
    const { content, defaultName } = map[format];
    await window.api.searchlight.saveReport({ content, defaultName });
  };

  if (!activeCaseId || !activeCase) {
    return (
      <div className="sl-rp-empty">
        <div className="sl-rp-empty-icon">≣</div>
        <div className="sl-rp-empty-text">NO ACTIVE CASE</div>
      </div>
    );
  }

  const foundCount = allResults.filter(isFound).length;
  const maybeCount = allResults.filter((r) => r.status === 'maybe').length;
  const redirectCount = allResults.filter((r) => [301, 302, 307, 308].includes(r.statusCode)).length;
  const errorCount = allResults.filter((r) => !!r.error || r.statusCode >= 500).length;

  return (
    <div className="sl-rp-root">
      {/* Header */}
      <div className="sl-rp-header">
        <div className="sl-rp-header-eyebrow">// REPORT GENERATION</div>
        <div className="sl-rp-header-title">INTELLIGENCE REPORTS</div>
        <div className="sl-rp-header-case">
          CASE: <span className="sl-rp-case-name">{activeCase.name.toUpperCase()}</span>
        </div>
      </div>

      <div className="sl-rp-grid-2">
        {/* Stats */}
        <div className="sl-rp-panel">
          <div className="sl-rp-section-label">CASE SUMMARY</div>
          <div className="sl-rp-stats-grid">
            {[
              { label: 'TOTAL CHECKED',  val: allResults.length, cls: 'sl-stat-blue'         },
              { label: 'PROFILES FOUND', val: foundCount,         cls: 'sl-stat-green'        },
              { label: 'MAYBE',          val: maybeCount,         cls: 'sl-stat-amber'        },
              { label: 'REDIRECTS',      val: redirectCount,      cls: 'sl-stat-orange'       },
              { label: 'ERRORS',         val: errorCount,         cls: 'sl-stat-red'          },
            ].map(({ label, val, cls }) => (
              <div key={label} className="sl-rp-stat-box">
                <div className={`sl-rp-stat-val ${cls}`}>{val}</div>
                <div className="sl-rp-stat-lbl">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Export */}
        <div className="sl-rp-panel">
          <div className="sl-rp-section-label">EXPORT REPORT</div>
          <label className="sl-rp-check-label">
            <input
              type="checkbox"
              checked={filterFound}
              onChange={(e) => setFilterFound(e.target.checked)}
            />
            <span>FOUND PROFILES ONLY</span>
          </label>
          <div className="sl-rp-export-count">
            {allResults.length} RESULTS WILL BE EXPORTED
          </div>
          <div className="sl-rp-export-grid">
            {(
              [
                { format: 'html' as const, label: 'HTML REPORT',     icon: '⊞', desc: 'Styled visual report' },
                { format: 'csv'  as const, label: 'CSV SPREADSHEET', icon: '≡', desc: 'Comma-separated'      },
                { format: 'json' as const, label: 'JSON DATA',        icon: '{}',desc: 'Structured data'      },
                { format: 'txt'  as const, label: 'TXT REPORT',       icon: '≣', desc: 'Plain text'           },
                { format: 'pdf'  as const, label: 'PDF REPORT',       icon: '⎙', desc: 'Printable document'   },
              ] as const
            ).map(({ format, label, icon, desc }) => (
              <button
                key={format}
                className="sl-sweep-btn sl-rp-export-btn"
                onClick={() => exportAs(format)}
                disabled={!allResults.length}
              >
                <span style={{ fontSize: 15 }}>{icon}</span>
                <span style={{ fontSize: 11 }}>{label}</span>
                <span style={{ fontSize: 9, opacity: 0.7, textTransform: 'none', fontWeight: 400 }}>{desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Sweep selector */}
      {activeCase.searches.length > 0 && (
        <div className="sl-rp-panel" style={{ marginTop: 16 }}>
          <div className="sl-rp-section-label">
            SELECT SWEEPS TO INCLUDE
            <span className="sl-rp-sweep-hint">(ALL BY DEFAULT)</span>
          </div>
          <div className="sl-rp-sweep-chips">
            {activeCase.searches.map((j) => {
              const isSel = selectedJobIds.size === 0 || selectedJobIds.has(j.id);
              const jFound = j.results.filter(isFound).length;
              return (
                <button
                  key={j.id}
                  className={`sl-rp-chip${isSel ? ' sl-rp-chip-active' : ''}`}
                  onClick={() => toggleJob(j.id)}
                >
                  {j.username}
                  <span className="sl-rp-chip-count">{jFound}/{j.results.length}</span>
                  <span style={{ color: j.status === 'completed' ? '#00ff88' : '#ffc800', fontSize: 9 }}>
                    {j.status === 'completed' ? '●' : '◌'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Preview */}
      {allResults.length > 0 && (
        <div className="sl-rp-panel" style={{ marginTop: 16 }}>
          <div className="sl-rp-section-label">
            REPORT PREVIEW ({allResults.length} RECORDS)
          </div>
          <div style={{ overflow: 'auto', maxHeight: 320 }}>
            <table className="sl-sweep-table">
              <thead>
                <tr className="sl-sweep-thead-row">
                  {['STATUS', 'FOUND', 'SITE', 'USERNAME', 'URL'].map((h) => (
                    <th key={h} className="sl-sweep-th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allResults.slice(0, 100).map((r) => (
                  <tr
                    key={r.id}
                    className={`sl-sweep-row${isFound(r) ? ' sl-row-found' : r.status === 'maybe' ? ' sl-row-maybe' : ''}`}
                  >
                    <td className="sl-sweep-td">
                      <span
                        className="sl-status-code"
                        style={{
                          color: isFound(r)
                            ? '#00ff88'
                            : r.status === 'maybe'
                            ? '#d8a83a'
                            : r.error
                            ? '#ff4444'
                            : '#5a6480',
                        }}
                      >
                        {r.error ? 'ERR' : r.statusCode}
                      </span>
                    </td>
                    <td className="sl-sweep-td">
                      {isFound(r) && <span className="sl-match-badge">● YES</span>}
                      {r.status === 'maybe' && <span className="sl-match-maybe">◐ MAYBE</span>}
                    </td>
                    <td className="sl-sweep-td">
                      <span className={`sl-site-name${isFound(r) ? ' sl-site-found' : ''}`}>
                        {r.siteName}
                      </span>
                    </td>
                    <td className="sl-sweep-td" style={{ color: '#00e5ff', fontSize: 10, fontFamily: 'Share Tech Mono, monospace' }}>
                      {r.username}
                    </td>
                    <td className="sl-sweep-td sl-url-cell">
                      <span className={`sl-url-link${isFound(r) ? ' sl-url-found' : ''}`}>
                        {r.url}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {allResults.length > 100 && (
              <div className="sl-rp-preview-overflow">
                ... and {allResults.length - 100} more (all included in export)
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
