/**
 * Case detail pane — every field the case schema knows about, plus
 * the drag-and-drop attachments zone (MVP-4) and the per-case notes shortcut.
 */

import { useCallback, useState, type DragEvent } from 'react';
import type { CaseRecord, CasePriority, CaseStatus } from '@shared/types';
import { useWindows } from '../../state/store';
import { playError } from '../../audio/synth';

interface Props {
  record: CaseRecord;
  onChange(): void | Promise<void>;
  onArchive(): void;
  onRefresh(): void | Promise<void>;
  onUpdateField<K extends keyof CaseRecord>(key: K, value: CaseRecord[K]): Promise<void>;
}

export function CaseDetail({ record, onChange, onArchive, onRefresh, onUpdateField }: Props): JSX.Element {
  const [dropHot, setDropHot] = useState(false);
  const [titleDraft, setTitleDraft] = useState(record.title);
  const [refDraft, setRefDraft] = useState(record.reference);
  const [descDraft, setDescDraft] = useState(record.description);
  const [tagsDraft, setTagsDraft] = useState(record.tags.join(', '));
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [taskText, setTaskText] = useState('');
  const [remTitle, setRemTitle] = useState('');
  const [remWhen, setRemWhen] = useState('');
  const open = useWindows((s) => s.open);

  const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDropHot(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const payload = files
      .map((f) => ({ sourcePath: window.api.files.getPathForFile(f), originalName: f.name }))
      .filter((p) => p.sourcePath);
    if (payload.length === 0) {
      playError();
      alert('Could not resolve dropped file paths. Drag from a real folder (not a browser).');
      return;
    }
    try {
      await window.api.files.importDropped(record.id, payload);
      await onRefresh();
      await onChange();
    } catch (err) {
      playError();
      alert(`Import failed: ${(err as Error).message}`);
    }
  }, [record.id, onRefresh, onChange]);

  return (
    <div className="ga98-stack" style={{ padding: 0 }}>
      <fieldset>
        <legend>Identity</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 4, alignItems: 'center' }}>
          <label>Title:</label>
          <input className="ga98-text" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => titleDraft !== record.title && void onUpdateField('title', titleDraft)} />
          <label>Reference:</label>
          <input className="ga98-text" value={refDraft} onChange={(e) => setRefDraft(e.target.value)}
            onBlur={() => refDraft !== record.reference && void onUpdateField('reference', refDraft)} />
          <label>Status:</label>
          <select className="ga98-text" value={record.status} onChange={(e) => void onUpdateField('status', e.target.value as CaseStatus)}>
            <option value="new">New</option>
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="closed">Closed</option>
            <option value="archived">Archived</option>
          </select>
          <label>Priority:</label>
          <select className="ga98-text" value={record.priority} onChange={(e) => void onUpdateField('priority', e.target.value as CasePriority)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <label>Tags:</label>
          <input className="ga98-text" value={tagsDraft} onChange={(e) => setTagsDraft(e.target.value)}
            onBlur={() => void onUpdateField('tags', tagsDraft.split(',').map((t) => t.trim()).filter(Boolean))} />
          <label style={{ alignSelf: 'flex-start' }}>Description:</label>
          <textarea className="ga98-text" rows={4} value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={() => descDraft !== record.description && void onUpdateField('description', descDraft)} />
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          <button onClick={onArchive}>{record.archived ? 'Unarchive' : 'Archive'}</button>
          <button onClick={() => open({ module: 'notepad', title: `Notepad 98 — ${record.title}`, props: { caseId: record.id } })}>
            Open Notepad…
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Attachments</legend>
        <div
          className="ga98-dropzone"
          data-hot={dropHot}
          onDragOver={(e) => { e.preventDefault(); setDropHot(true); }}
          onDragLeave={() => setDropHot(false)}
          onDrop={handleDrop}
        >
          Drag files from Windows here to attach them to this case.
        </div>
        {record.attachments.length === 0 ? (
          <p style={{ color: '#666' }}>No attachments yet.</p>
        ) : (
          <ul className="ga98-list">
            {record.attachments.map((a) => (
              <li key={a.fileName}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.originalName} <span style={{ opacity: 0.6 }}>({Math.ceil(a.size / 1024)} KB)</span>
                </span>
                <button onClick={() => void window.api.files.revealAttachment(record.id, a.fileName)}>Reveal</button>
                <button onClick={async () => {
                  if (!confirm(`Send ${a.originalName} to Shred?`)) return;
                  await window.api.files.deleteAttachment(record.id, a.fileName);
                  await onRefresh();
                }}>Shred</button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset>
        <legend>Web links</legend>
        <div style={{ display: 'flex', gap: 4 }}>
          <input className="ga98-text" placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} style={{ flex: 1 }} />
          <input className="ga98-text" placeholder="Title (optional)" value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} style={{ flex: 1 }} />
          <button disabled={!linkUrl.trim()} onClick={async () => {
            await window.api.cases.addLink(record.id, linkUrl.trim(), linkTitle.trim() || linkUrl.trim());
            setLinkUrl(''); setLinkTitle('');
            await onRefresh();
          }}>Add</button>
        </div>
        <ul className="ga98-list">
          {record.links.map((l) => (
            <li key={l.id}>
              <a onClick={() => void window.api.system.openExternal(l.url)} style={{ flex: 1, cursor: 'pointer', color: '#000080' }}>
                {l.title}
              </a>
              <button onClick={async () => { await window.api.cases.deleteLink(record.id, l.id); await onRefresh(); }}>×</button>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset>
        <legend>Tasks</legend>
        <div style={{ display: 'flex', gap: 4 }}>
          <input className="ga98-text" value={taskText} onChange={(e) => setTaskText(e.target.value)} placeholder="New task…" style={{ flex: 1 }} />
          <button disabled={!taskText.trim()} onClick={async () => {
            await window.api.cases.addTask(record.id, taskText.trim());
            setTaskText('');
            await onRefresh();
          }}>Add</button>
        </div>
        <ul className="ga98-list">
          {record.tasks.map((t) => (
            <li key={t.id}>
              <input type="checkbox" checked={t.done} onChange={async () => { await window.api.cases.toggleTask(record.id, t.id); await onRefresh(); }} />
              <span style={{ flex: 1, textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</span>
              <button onClick={async () => { await window.api.cases.deleteTask(record.id, t.id); await onRefresh(); }}>×</button>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset>
        <legend>Reminders</legend>
        <div style={{ display: 'flex', gap: 4 }}>
          <input className="ga98-text" placeholder="Title" value={remTitle} onChange={(e) => setRemTitle(e.target.value)} style={{ flex: 1 }} />
          <input className="ga98-text" type="datetime-local" value={remWhen} onChange={(e) => setRemWhen(e.target.value)} />
          <button disabled={!remTitle.trim() || !remWhen} onClick={async () => {
            const fireAt = new Date(remWhen).toISOString();
            await window.api.cases.addReminder(record.id, { title: remTitle.trim(), fireAt, repeat: 'none' });
            setRemTitle(''); setRemWhen('');
            await onRefresh();
          }}>Add</button>
        </div>
        <ul className="ga98-list">
          {record.reminders.map((r) => (
            <li key={r.id}>
              <span style={{ flex: 1 }}>
                {r.title} <span style={{ opacity: 0.7 }}>· {new Date(r.fireAt).toLocaleString()}</span>
                {r.fired ? <span style={{ color: '#080' }}> · fired</span> : null}
              </span>
              <button onClick={async () => { await window.api.cases.deleteReminder(record.id, r.id); await onRefresh(); }}>×</button>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset>
        <legend>Timeline</legend>
        <ul className="ga98-list" style={{ maxHeight: 160, overflow: 'auto' }}>
          {record.timeline.slice().reverse().map((ev) => (
            <li key={ev.id}>
              <span style={{ width: 130, fontSize: 11, opacity: 0.7 }}>{new Date(ev.at).toLocaleString()}</span>
              <span style={{ width: 70, fontSize: 11, opacity: 0.7 }}>[{ev.kind}]</span>
              <span style={{ flex: 1 }}>{ev.message}</span>
            </li>
          ))}
        </ul>
      </fieldset>
    </div>
  );
}
