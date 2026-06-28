/**
 * Pure HTML/CSV/JSON/TXT report generators extracted from ReportsPanel.tsx so
 * they can be unit-tested without React/store dependencies.
 *
 * Task 13 adds maybe-tier support:
 *  - generateHTML: row class "maybe", CSS tr.maybe .status, MAYBE stat box.
 *
 * XSS invariants:
 *  - All string interpolations in HTML output pass through esc() or safeHref().
 *  - No new RegExp on dynamic input.
 */

import type { SweepResult } from '@shared/searchlight/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const safeHref = (u: string): string => (/^https?:\/\//i.test(u) ? u : '#');

function isFound(r: SweepResult): boolean {
  return r.found;
}

// ─── HTML export ──────────────────────────────────────────────────────────────

export function generateHTML(caseName: string, results: SweepResult[]): string {
  const found = results.filter(isFound);
  const maybeCount = results.filter((r) => r.status === 'maybe').length;

  const rows = results
    .map((r) => {
      const rowClass = r.status === 'maybe' ? 'maybe' : isFound(r) ? 'found' : r.error ? 'error' : '';
      return `
    <tr class="${rowClass}">
      <td class="status">${r.error ? esc(String(r.error)) : Number(r.statusCode)}</td>
      <td>${esc(r.siteName)}</td>
      <td><a href="${esc(safeHref(r.url))}" target="_blank" rel="noopener noreferrer">${esc(r.url)}</a></td>
      <td>${esc(r.username)}</td>
      <td>${Number(r.elapsed)}ms</td>
      <td>${esc(r.category)}</td>
    </tr>`;
    })
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
  tr.maybe .status{color:#d8a83a;font-weight:700}
  tr.error .status{color:#ff3344}
  tr:hover{background:rgba(26,111,255,.04)}
</style></head><body>
<h1>SEARCHLIGHT</h1>
<div class="meta">CASE: ${esc(caseName)} · GENERATED: ${new Date().toISOString()} · TOTAL: ${results.length}</div>
<div class="stats">
  <div><div class="stat-val">${results.length}</div><div class="stat-lbl">TOTAL CHECKED</div></div>
  <div><div class="stat-val" style="color:#00ff88">${found.length}</div><div class="stat-lbl">PROFILES FOUND</div></div>
  <div><div class="stat-val" style="color:#d8a83a">${maybeCount}</div><div class="stat-lbl">MAYBE</div></div>
  <div><div class="stat-val" style="color:#ff8800">${results.filter((r) => [301, 302].includes(r.statusCode)).length}</div><div class="stat-lbl">REDIRECTS</div></div>
  <div><div class="stat-val" style="color:#ff3344">${results.filter((r) => !!r.error).length}</div><div class="stat-lbl">ERRORS</div></div>
</div>
<table><thead><tr><th>STATUS</th><th>SITE</th><th>URL</th><th>USERNAME</th><th>TIME</th><th>CATEGORY</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

export function generateCSV(results: SweepResult[]): string {
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

export function generateJSON(caseName: string, results: SweepResult[]): string {
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

export function generateTXT(caseName: string, results: SweepResult[]): string {
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
