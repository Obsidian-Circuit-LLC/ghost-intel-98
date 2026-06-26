/**
 * ReportsPanel — Task 12 port.
 *
 * Port transforms from .searchlight-source/src/renderer/components/Reports/ReportsPanel.tsx:
 * 1. useAppStore → useSearchlightStore; UrlCheckResult → SweepResult.
 * 2. isFound(): source uses r.found ?? r.statusCode===200; SweepResult has a first-class
 *    `found: boolean` field — use that directly.
 * 3. jsPDF / jszip PDF path REMOVED (operator decision — deps not installed).
 * 4. Export via browser Blob download (anchor + URL.createObjectURL + revokeObjectURL).
 *    No window.api.files.*, no new IPC.
 * 5. HTML report is built as a downloadable string — NOT injected into the DOM.
 * 6. sfx removed (not in searchlight surface).
 * 7. Type of "error" field: ProbeErrorType (string | null), not just string — guarded.
 */

import { useState, useMemo } from 'react';
import type { SweepResult } from '@shared/searchlight/types';
import { useSearchlightStore } from '../store';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isFound(r: SweepResult): boolean {
  return r.found;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const safeHref = (u: string): string => (/^https?:\/\//i.test(u) ? u : '#');

// ─── HTML export ──────────────────────────────────────────────────────────────
function generateHTML(caseName: string, results: SweepResult[]): string {
  const found = results.filter(isFound);
  const rows = results
    .map(
      (r) => `
    <tr class="${isFound(r) ? 'found' : r.error ? 'error' : ''}">
      <td class="status">${r.error ? esc(String(r.error)) : Number(r.statusCode)}</td>
      <td>${esc(r.siteName)}</td>
      <td><a href="${esc(safeHref(r.url))}" target="_blank" rel="noopener noreferrer">${esc(r.url)}</a></td>
      <td>${esc(r.username)}</td>
      <td>${Number(r.elapsed)}ms</td>
      <td>${esc(r.category)}</td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Ghost Intel Report: ${esc(caseName)}</title>
<style>
  body{background:#050510;color:#e8f0ff;font-family:'Share Tech Mono',monospace;margin:0;padding:20px}
  h1{font-family:Orbitron,monospace;color:#2d8cff;letter-spacing:.15em}
  .meta{color:#445577;font-size:12px;margin-bottom:20px}
  .stats{display:flex;gap:30px;margin:20px 0;padding:15px;background:#0a0a1a;border:1px solid rgba(26,111,255,.2);border-radius:4px}
  .stat-val{font-size:28px;font-weight:700;color:#00ff88;font-family:Orbitron,monospace}
  .stat-lbl{font-size:10px;color:#445577;letter-spacing:.15em}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{padding:8px 12px;text-align:left;color:#445577;border-bottom:1px solid rgba(26,111,255,.2);font-size:9px;letter-spacing:.15em}
  td{padding:7px 12px;border-bottom:1px solid rgba(26,111,255,.06)}
  a{color:#2d8cff;text-decoration:none}
  tr.found .status{color:#00ff88;font-weight:700}
  tr.error .status{color:#ff3344}
  tr:hover{background:rgba(26,111,255,.04)}
</style></head><body>
<h1>SEARCHLIGHT</h1>
<div class="meta">CASE: ${esc(caseName)} · GENERATED: ${new Date().toISOString()} · TOTAL: ${results.length}</div>
<div class="stats">
  <div><div class="stat-val">${results.length}</div><div class="stat-lbl">TOTAL CHECKED</div></div>
  <div><div class="stat-val" style="color:#00ff88">${found.length}</div><div class="stat-lbl">PROFILES FOUND</div></div>
  <div><div class="stat-val" style="color:#ff8800">${results.filter((r) => [301, 302].includes(r.statusCode)).length}</div><div class="stat-lbl">REDIRECTS</div></div>
  <div><div class="stat-val" style="color:#ff3344">${results.filter((r) => !!r.error).length}</div><div class="stat-lbl">ERRORS</div></div>
</div>
<table><thead><tr><th>STATUS</th><th>SITE</th><th>URL</th><th>USERNAME</th><th>TIME</th><th>CATEGORY</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
}

// ─── CSV ──────────────────────────────────────────────────────────────────────
function generateCSV(results: SweepResult[]): string {
  const header = 'Site,URL,Username,Status Code,Status Message,Error,Found,Elapsed (ms),Category';
  const rows = results.map((r) =>
    [
      r.siteName,
      r.url,
      r.username,
      r.statusCode,
      r.statusMessage,
      r.error ?? '',
      isFound(r) ? 'YES' : 'NO',
      r.elapsed,
      r.category,
    ]
      .map((v) => {
        // neutralize spreadsheet formula injection (=, +, -, @, tab, CR lead chars)
        let s = String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return `"${s.replace(/"/g, '""')}"`;
      })
      .join(',')
  );
  return [header, ...rows].join('\n');
}

// ─── JSON ─────────────────────────────────────────────────────────────────────
function generateJSON(caseName: string, results: SweepResult[]): string {
  return JSON.stringify(
    {
      tool: 'Searchlight',
      case: caseName,
      generated: new Date().toISOString(),
      summary: {
        total: results.length,
        found: results.filter(isFound).length,
        errors: results.filter((r) => !!r.error).length,
      },
      results,
    },
    null,
    2
  );
}

// ─── TXT ──────────────────────────────────────────────────────────────────────
function generateTXT(caseName: string, results: SweepResult[]): string {
  const found = results.filter(isFound);
  return [
    '═══════════════════════════════════════════════════════════',
    'SEARCHLIGHT — INVESTIGATION REPORT',
    '═══════════════════════════════════════════════════════════',
    `CASE: ${caseName}`,
    `DATE: ${new Date().toISOString()}`,
    `TOTAL CHECKED: ${results.length}  |  PROFILES FOUND: ${found.length}`,
    '',
    '─── CONFIRMED PROFILES (FOUND) ────────────────────────────',
    ...found.map((r) => `  [${r.statusCode}] ${r.siteName.padEnd(25)} ${r.url}`),
    '',
    '─── ALL RESULTS ────────────────────────────────────────────',
    ...results.map(
      (r) =>
        `  [${String(r.error ?? r.statusCode).padEnd(5)}] ${r.siteName.padEnd(25)} ${r.url}`
    ),
    '',
    '═══════════════════════════════════════════════════════════',
    'END OF REPORT',
  ].join('\n');
}

// ─── Blob download helper ─────────────────────────────────────────────────────
function blobDownload(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
    const ts = Date.now();
    const slug = name.replace(/\s+/g, '_');

    if (format === 'pdf') {
      const html = generateHTML(name, allResults);
      await window.api.searchlight.exportPdf({ html, filename: `searchlight_${slug}_${ts}.pdf` });
      return;
    }

    const map: Record<'html' | 'csv' | 'json' | 'txt', { content: string; filename: string; mime: string }> = {
      html: {
        content: generateHTML(name, allResults),
        filename: `ghost_intel_${slug}_${ts}.html`,
        mime: 'text/html',
      },
      csv: {
        content: generateCSV(allResults),
        filename: `ghost_intel_${slug}_${ts}.csv`,
        mime: 'text/csv',
      },
      json: {
        content: generateJSON(name, allResults),
        filename: `ghost_intel_${slug}_${ts}.json`,
        mime: 'application/json',
      },
      txt: {
        content: generateTXT(name, allResults),
        filename: `ghost_intel_${slug}_${ts}.txt`,
        mime: 'text/plain',
      },
    };
    const { content, filename, mime } = map[format];
    blobDownload(content, filename, mime);
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
              { label: 'TOTAL CHECKED',  val: allResults.length, cls: 'sl-stat-blue'  },
              { label: 'PROFILES FOUND', val: foundCount,         cls: 'sl-stat-green' },
              { label: 'REDIRECTS',      val: redirectCount,      cls: 'sl-stat-orange'},
              { label: 'ERRORS',         val: errorCount,         cls: 'sl-stat-red'   },
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
                    className={`sl-sweep-row${isFound(r) ? ' sl-row-found' : ''}`}
                  >
                    <td className="sl-sweep-td">
                      <span
                        className="sl-status-code"
                        style={{
                          color: isFound(r)
                            ? '#00ff88'
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
