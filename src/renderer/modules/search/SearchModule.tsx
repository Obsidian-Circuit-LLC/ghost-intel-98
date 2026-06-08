/**
 * Cross-case search. Literal substring query over every case's metadata, entities, tasks, links,
 * reminders, note bodies, and text-attachment contents. Click a result to open that case;
 * export the result set to a text file.
 */
import { useState } from 'react';
import type { SearchHit, SearchResult } from '@shared/types';
import { useWindows } from '../../state/store';
import { toast } from '../../state/toasts';

export function SearchModule(): JSX.Element {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(): Promise<void> {
    if (!q.trim()) return;
    setBusy(true);
    try { setResults(await window.api.search.query(q.trim())); }
    catch (err) { toast.error(`Search failed: ${(err as Error).message}`); }
    finally { setBusy(false); }
  }

  async function exportResults(): Promise<void> {
    if (!results) return;
    const text = results.map((r) =>
      `# ${r.caseTitle} (${r.caseId})\n${r.hits.map((h) => `  [${h.field}] ${h.snippet}`).join('\n')}`
    ).join('\n\n');
    try {
      const saved = await window.api.export.text(`search-${q.trim().slice(0, 30)}.txt`, `Search: ${q}\n\n${text}`);
      if (saved) toast.success(`Saved ${saved}.`);
    } catch (err) { toast.error(`Export failed: ${(err as Error).message}`); }
  }

  /** Deep-link a result hit to the exact case / note / file it came from. */
  function navigateToHit(r: SearchResult, h: SearchHit): void {
    const open = useWindows.getState().open;
    if (h.kind === 'note' && h.noteName) {
      open({ module: 'notepad', title: `Notepad 98 — ${h.noteName}`, props: { caseId: r.caseId, initialNoteName: h.noteName } });
    } else if (h.kind === 'file' && h.fileName) {
      open({ module: 'doc-viewer', title: h.originalName ?? h.fileName, props: { caseId: r.caseId, fileName: h.fileName, originalName: h.originalName ?? h.fileName }, width: 900, height: 680 });
    } else {
      open({ module: 'cases', title: `My Cases — ${r.caseTitle}`, props: { caseId: r.caseId } });
    }
  }

  const total = results?.reduce((n, r) => n + r.hits.length, 0) ?? 0;

  return (
    <div className="ga98-stack" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <input className="ga98-text" style={{ flex: 1 }} placeholder="Search all cases…" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void run(); }} />
        <button onClick={() => void run()} disabled={busy || !q.trim()}>{busy ? 'Searching…' : 'Search'}</button>
        <button onClick={() => void exportResults()} disabled={!results || results.length === 0}>Export…</button>
      </div>
      {results && (
        <div style={{ fontSize: 11, color: '#444', margin: '6px 0' }}>
          {results.length === 0 ? 'No matches.' : `${total} hit${total === 1 ? '' : 's'} in ${results.length} case${results.length === 1 ? '' : 's'}.`}
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {results?.map((r) => (
          <div key={r.caseId} style={{ marginBottom: 10, border: '1px solid #c0c0c0', background: '#fff' }}>
            <div
              style={{ background: '#000080', color: '#fff', padding: '2px 6px', cursor: 'pointer' }}
              onClick={() => useWindows.getState().open({ module: 'cases', title: `My Cases — ${r.caseTitle}`, props: { caseId: r.caseId } })}
              title="Open this case"
            >
              <b>{r.caseTitle}</b>
            </div>
            <ul style={{ margin: 0, padding: '4px 6px', listStyle: 'none', fontSize: 12 }}>
              {r.hits.map((h, i) => (
                <li
                  key={i}
                  style={{ padding: '2px 4px', cursor: 'pointer', borderRadius: 2 }}
                  onClick={() => navigateToHit(r, h)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#cfe2ff'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  title={h.kind === 'note' ? 'Open this note' : h.kind === 'file' ? 'Open this file' : 'Open this case'}
                >
                  <span style={{ fontSize: 10, opacity: 0.6 }}>[{h.field}]</span> {h.snippet}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
