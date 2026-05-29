/**
 * Cases module — dashboard list + detail pane in one window.
 * Drag-and-drop is wired into the detail pane (MVP-4).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CaseRecord, CaseSummary, CasePriority, CaseStatus, AppSettings } from '@shared/types';
import { CaseDetail } from './CaseDetail';
import { confirmDialog, promptDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';
import { shortcutBus, type ShortcutEventDetail } from '../../shell/Shortcuts';
import { useSettings } from '../../state/store';

const PRIORITY_ORDER: Record<CasePriority, number> = { critical: 3, high: 2, medium: 1, low: 0 };
const STATUS_ORDER: Record<CaseStatus, number> = { new: 4, open: 3, pending: 2, closed: 1, archived: 0 };

/** Every cmp expression is written in "natural descending" orientation (b first =
 *  positive) so the final `dir === 'asc' ? -cmp : cmp` flip works uniformly.
 *  title uses fixed 'en' locale + base sensitivity so cross-locale rendering is stable. */
function compareCases(a: CaseSummary, b: CaseSummary, by: AppSettings['caseSortBy'], dir: AppSettings['caseSortDir']): number {
  let cmp = 0;
  switch (by) {
    case 'updatedAt': cmp = b.updatedAt.localeCompare(a.updatedAt); break;
    case 'createdAt': cmp = b.createdAt.localeCompare(a.createdAt); break;
    case 'title':     cmp = b.title.localeCompare(a.title, 'en', { sensitivity: 'base' }); break;
    case 'priority':  cmp = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]; break;
    case 'status':    cmp = STATUS_ORDER[b.status] - STATUS_ORDER[a.status]; break;
  }
  return dir === 'asc' ? -cmp : cmp;
}

export function CasesModule({ initialCaseId }: { initialCaseId?: string } = {}): JSX.Element {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialCaseId ?? null);
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

  const sortBy = useSettings((s) => s.settings?.caseSortBy ?? 'updatedAt');
  const sortDir = useSettings((s) => s.settings?.caseSortDir ?? 'desc');
  const patchSettings = useSettings((s) => s.patch);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return cases
      .filter((c) => {
        if (!showArchived && c.archived) return false;
        if (!q) return true;
        // Null-safe: a legacy case row missing tags/reference must not throw and kill the
        // whole filter (Array.filter has no per-element isolation). Build one haystack from
        // every summary field the list endpoint exposes.
        const hay = [c.title, c.reference, c.status, c.priority, ...(c.tags ?? [])]
          .filter((v): v is string => typeof v === 'string')
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => compareCases(a, b, sortBy, sortDir));
  }, [cases, filter, showArchived, sortBy, sortDir]);

  const createCase = useCallback(async (): Promise<void> => {
    const title = await promptDialog('Case title?', '', 'New case', 'e.g. Smith v. Acme');
    if (!title) return;
    const reference = await promptDialog('Case reference (optional)', '', 'New case', 'e.g. INV-2026-001');
    try {
      const created = await window.api.cases.create({ title, reference: reference ?? '' });
      await refreshList();
      setSelectedId(created.id);
      toast.success(`Case "${created.title}" created.`);
    } catch (err) {
      toast.error(`Could not create case: ${(err as Error).message}`);
    }
  }, [refreshList]);

  async function renameSelected(): Promise<void> {
    if (!selectedId || !detail) return;
    const next = await promptDialog('New title:', detail.title, 'Rename case');
    if (!next) return;
    try {
      await window.api.cases.rename(selectedId, next);
      await refreshList();
      setDetail(await window.api.cases.read(selectedId));
      toast.success('Renamed.');
    } catch (err) {
      toast.error(`Rename failed: ${(err as Error).message}`);
    }
  }

  async function archiveSelected(archive: boolean): Promise<void> {
    if (!selectedId) return;
    try {
      await window.api.cases.archive(selectedId, archive);
      await refreshList();
      setDetail(await window.api.cases.read(selectedId));
      toast.success(archive ? 'Archived.' : 'Unarchived.');
    } catch (err) {
      toast.error(`${archive ? 'Archive' : 'Unarchive'} failed: ${(err as Error).message}`);
    }
  }

  async function deleteSelected(): Promise<void> {
    if (!selectedId || !detail) return;
    const ok = await confirmDialog(`Move "${detail.title}" to Shred? It can be restored from there until you Purge.`, 'Delete case');
    if (!ok) return;
    try {
      await window.api.cases.delete(selectedId);
      setSelectedId(null);
      setDetail(null);
      await refreshList();
      toast.success('Sent to Shred.');
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  }

  // Wire the Ctrl/Cmd+N shortcut while this module is focused.
  useEffect(() => {
    function onShortcut(e: Event): void {
      const detail = (e as CustomEvent<ShortcutEventDetail>).detail;
      if (detail.moduleKey !== 'cases') return;
      if (detail.action === 'new') void createCase();
    }
    shortcutBus.addEventListener('shortcut', onShortcut);
    return () => shortcutBus.removeEventListener('shortcut', onShortcut);
  }, [createCase]);


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
            <button onClick={() => void createCase()} title="Ctrl/Cmd+N">New</button>
            <button disabled={!selectedId} onClick={() => void renameSelected()}>Rename</button>
            <button disabled={!selectedId} onClick={() => void deleteSelected()}>Delete</button>
          </div>
          <input
            className="ga98-text"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
            <label>Sort:</label>
            <select className="ga98-text" value={sortBy} onChange={(e) => void patchSettings({ caseSortBy: e.target.value as AppSettings['caseSortBy'] })}>
              <option value="updatedAt">Updated</option>
              <option value="createdAt">Created</option>
              <option value="title">Title</option>
              <option value="priority">Priority</option>
              <option value="status">Status</option>
            </select>
            <button
              title={`Sort direction: ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
              onClick={() => void patchSettings({ caseSortDir: sortDir === 'asc' ? 'desc' : 'asc' })}
              style={{ minWidth: 28 }}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
          <label style={{ fontSize: 11 }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
          <ul className="ga98-list">
            {visible.length === 0 && <li style={{ color: '#666' }}>No cases. Click <b>New</b>.</li>}
            {visible.map((c) => (
              <li key={c.id} data-selected={c.id === selectedId} onClick={() => setSelectedId(c.id)}>
                {c.primaryBioThumb && (
                  <img src={c.primaryBioThumb} alt="" style={{ width: 20, height: 20, objectFit: 'cover', marginRight: 4, border: '1px solid #808080' }} />
                )}
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
