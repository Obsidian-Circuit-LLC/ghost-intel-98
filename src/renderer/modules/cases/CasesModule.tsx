/**
 * Cases module — dashboard list + detail pane in one window.
 * Drag-and-drop is wired into the detail pane (MVP-4).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CaseRecord, CaseSummary, CasePriority, CaseStatus } from '@shared/types';
import { CaseDetail } from './CaseDetail';

export function CasesModule(): JSX.Element {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseRecord | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState('');

  const refreshList = useCallback(async () => {
    const list = await window.api.cases.list();
    setCases(list);
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void window.api.cases.read(selectedId).then(setDetail).catch(() => setDetail(null));
  }, [selectedId]);

  const visible = useMemo(() => {
    return cases.filter((c) => {
      if (!showArchived && c.archived) return false;
      if (!filter.trim()) return true;
      const q = filter.toLowerCase();
      return (
        c.title.toLowerCase().includes(q) ||
        c.reference.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [cases, filter, showArchived]);

  async function createCase(): Promise<void> {
    const title = prompt('Case title?');
    if (!title) return;
    const reference = prompt('Case reference (optional):') ?? '';
    const created = await window.api.cases.create({ title, reference });
    await refreshList();
    setSelectedId(created.id);
  }

  async function renameSelected(): Promise<void> {
    if (!selectedId || !detail) return;
    const next = prompt('New title:', detail.title);
    if (!next) return;
    await window.api.cases.rename(selectedId, next);
    await refreshList();
    setDetail(await window.api.cases.read(selectedId));
  }

  async function archiveSelected(archive: boolean): Promise<void> {
    if (!selectedId) return;
    await window.api.cases.archive(selectedId, archive);
    await refreshList();
    setDetail(await window.api.cases.read(selectedId));
  }

  async function deleteSelected(): Promise<void> {
    if (!selectedId || !detail) return;
    if (!confirm(`Move "${detail.title}" to Shred?`)) return;
    await window.api.cases.delete(selectedId);
    setSelectedId(null);
    setDetail(null);
    await refreshList();
  }

  async function updateField<K extends keyof CaseRecord>(key: K, value: CaseRecord[K]): Promise<void> {
    if (!selectedId) return;
    const patch = { [key]: value } as Partial<CaseRecord>;
    const next = await window.api.cases.update(selectedId, patch);
    setDetail(next);
    await refreshList();
  }

  return (
    <div className="ga98-split" style={{ height: '100%' }}>
      <div className="ga98-pane">
        <div className="ga98-stack" style={{ padding: 0 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => void createCase()}>New</button>
            <button disabled={!selectedId} onClick={() => void renameSelected()}>Rename</button>
            <button disabled={!selectedId} onClick={() => void deleteSelected()}>Delete</button>
          </div>
          <input
            className="ga98-text"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <label style={{ fontSize: 11 }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
          <ul className="ga98-list">
            {visible.length === 0 && <li style={{ color: '#666' }}>No cases. Click <b>New</b>.</li>}
            {visible.map((c) => (
              <li key={c.id} data-selected={c.id === selectedId} onClick={() => setSelectedId(c.id)}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <b>{c.title}</b>
                  {c.reference ? <span style={{ opacity: 0.7 }}> [{c.reference}]</span> : null}
                </span>
                <span style={{ fontSize: 10 }}>{priorityBadge(c.priority)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="ga98-pane">
        {detail ? (
          <CaseDetail
            record={detail}
            onChange={refreshList}
            onArchive={() => void archiveSelected(!detail.archived)}
            onUpdateField={updateField}
            onRefresh={async () => {
              if (!selectedId) return;
              setDetail(await window.api.cases.read(selectedId));
            }}
          />
        ) : (
          <p style={{ color: '#666' }}>Select a case, or click New.</p>
        )}
      </div>
    </div>
  );
}

function priorityBadge(p: CasePriority): string {
  const map: Record<CasePriority, string> = { low: '·', medium: '•', high: '⬤', critical: '★' };
  return map[p];
}

// Reference unused CaseStatus type to satisfy strict lint
export type _UnusedCaseStatus = CaseStatus;
