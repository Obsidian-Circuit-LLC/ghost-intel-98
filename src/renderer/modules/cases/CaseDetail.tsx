/**
 * Case detail pane — every field the case schema knows about, plus
 * the drag-and-drop attachments zone (MVP-4) and the per-case notes shortcut.
 */

import { useCallback, useEffect, useState, type DragEvent } from 'react';
import type { AttachmentMeta, CaseRecord, CasePriority, CaseStatus, ExtractedAttachmentMeta } from '@shared/types';
import type { SavedGeoEvent } from '@shared/post-mvp-types';
import { useWindows } from '../../state/store';
import { playError } from '../../audio/synth';
import { confirmDialog, promptDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';
import { EntitiesSection } from './EntitiesSection';
import { BioImagesSection } from './BioImagesSection';
import { ChatSharePicker, type ShareTarget } from '../../components/ChatSharePicker';

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
  const [tlFilter, setTlFilter] = useState('all');
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
      toast.error('Could not resolve dropped file paths. Drag from a real folder (not a browser tab).');
      return;
    }
    try {
      const imported = await window.api.files.importDropped(record.id, payload);
      await onRefresh();
      await onChange();
      if (imported.length === payload.length) toast.success(`Imported ${imported.length} file${imported.length === 1 ? '' : 's'}.`);
      else toast.warn(`Imported ${imported.length} of ${payload.length} — see the case timeline for details.`);
    } catch (err) {
      playError();
      toast.error(`Import failed: ${(err as Error).message}`);
    }
  }, [record.id, onRefresh, onChange]);

  async function exportAs(fn: () => Promise<string | null>): Promise<void> {
    try {
      const saved = await fn();
      if (saved) toast.success(`Saved ${saved}.`);
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    }
  }

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
          <button onClick={() => open({ module: 'whiteboard', title: `Whiteboard — ${record.title}`, props: { caseId: record.id }, width: 960, height: 680 })}>
            Open whiteboard…
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
              <AttachmentRow key={a.fileName} caseId={record.id} att={a} onRefresh={onRefresh} />
            ))}
          </ul>
        )}
      </fieldset>

      <BioImagesSection caseId={record.id} images={record.bioImages ?? []} onRefresh={onRefresh} />

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

      <EntitiesSection caseId={record.id} entities={record.entities ?? []} attachments={record.attachments} onRefresh={onRefresh} />

      <GeoEventsSection caseId={record.id} />

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
        <label style={{ fontSize: 11 }}>
          Filter:&nbsp;
          <select className="ga98-text" value={tlFilter} onChange={(e) => setTlFilter(e.target.value)}>
            <option value="all">All events</option>
            {Array.from(new Set(record.timeline.map((e) => e.kind))).sort().map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <ul className="ga98-list" style={{ maxHeight: 160, overflow: 'auto' }}>
          {record.timeline.slice().reverse().filter((ev) => tlFilter === 'all' || ev.kind === tlFilter).map((ev) => (
            <li key={ev.id}>
              <span style={{ width: 130, fontSize: 11, opacity: 0.7 }}>{new Date(ev.at).toLocaleString()}</span>
              <span style={{ width: 70, fontSize: 11, opacity: 0.7 }}>[{ev.kind}]</span>
              <span style={{ flex: 1 }}>{ev.message}</span>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset>
        <legend>Export</legend>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button onClick={() => void exportAs(() => window.api.export.summaryPdf(record.id))}>Summary → PDF</button>
          <button onClick={() => void exportAs(() => window.api.export.summaryHtml(record.id))}>Summary → HTML</button>
          <button onClick={() => void exportAs(() => window.api.export.timelineCsv(record.id))}>Timeline → CSV</button>
          <button disabled={(record.entities ?? []).length === 0} onClick={() => void exportAs(() => window.api.export.entitiesCsv(record.id))}>Entities → CSV</button>
          <button disabled={record.links.length === 0} onClick={() => void exportAs(() => window.api.export.linksCsv(record.id))}>Links → CSV</button>
          <button disabled={record.attachments.length === 0} onClick={() => void exportAs(() => window.api.export.attachmentsCsv(record.id))}>Attachments → CSV</button>
        </div>
      </fieldset>
    </div>
  );
}

function fileGlyph(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return '📕';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff'].includes(ext)) return '🖼';
  if (ext === 'docx' || ext === 'doc') return '📘';
  if (['csv', 'tsv', 'xlsx', 'xls'].includes(ext)) return '📊';
  if (ext === 'json' || ext === 'xml') return '🧾';
  if (ext === 'eml' || ext === 'msg') return '✉';
  if (['txt', 'md', 'log', 'html', 'htm'].includes(ext)) return '📄';
  return '📎';
}

/** Self-loading list of GeoINT events saved into this case (cycle 2). */
function GeoEventsSection({ caseId }: { caseId: string }): JSX.Element {
  const [events, setEvents] = useState<SavedGeoEvent[]>([]);
  const reload = useCallback(async () => { setEvents(await window.api.geoint.listCaseEvents(caseId)); }, [caseId]);
  useEffect(() => { void reload(); }, [reload]);

  return (
    <fieldset>
      <legend>GeoINT events</legend>
      {events.length === 0
        ? <p style={{ fontSize: 11, color: '#555', margin: 0 }}>No saved events.</p>
        : <ul className="ga98-list">
            {events.map((ev) => {
              const http = typeof ev.link === 'string' && /^https?:\/\//i.test(ev.link);
              return (
                <li key={ev.id}>
                  <span style={{ flex: 1 }}>
                    <b>{ev.title}</b>
                    <div style={{ fontSize: 10, opacity: 0.7 }}>
                      {ev.place ?? (ev.lat != null ? `${ev.lat}, ${ev.lon}` : '—')} · {(ev.published ?? ev.savedAt).slice(0, 10)}
                      {http ? <> · <a href={ev.link} target="_blank" rel="noopener noreferrer">open</a></> : null}
                    </div>
                  </span>
                  <button onClick={async () => { await window.api.geoint.removeCaseEvent(caseId, ev.id); await reload(); }}>×</button>
                </li>
              );
            })}
          </ul>}
    </fieldset>
  );
}

function AttachmentRow({ caseId, att, onRefresh }: {
  caseId: string;
  att: AttachmentMeta;
  onRefresh(): void | Promise<void>;
}): JSX.Element {
  const [showDetails, setShowDetails] = useState(false);
  const [meta, setMeta] = useState<ExtractedAttachmentMeta | null>(null);
  const [showGps, setShowGps] = useState(false);
  const [sharing, setSharing] = useState(false);

  async function shareTo(t: ShareTarget): Promise<void> {
    setSharing(false);
    try {
      await window.api.chat.shareAttachment(t.id, caseId, att.fileName);
      toast.success(`Sharing ${att.originalName} to ${t.name}…`);
      void window.api.cases.addTimeline(caseId, { kind: 'view', message: `Shared ${att.originalName} to a chat contact` }).then(() => onRefresh());
    } catch (e) { toast.error(`Share failed: ${(e as Error).message}`); }
  }

  async function toggleDetails(): Promise<void> {
    const next = !showDetails;
    setShowDetails(next);
    if (next && !meta) {
      try { setMeta(await window.api.files.extractAttachmentMeta(caseId, att.fileName)); }
      catch (err) { toast.error(`Could not read metadata: ${(err as Error).message}`); }
    }
  }

  function view(): void {
    useWindows.getState().open({
      module: 'doc-viewer',
      title: att.originalName,
      props: { caseId, fileName: att.fileName, originalName: att.originalName },
      width: 900,
      height: 680
    });
    void window.api.cases.addTimeline(caseId, { kind: 'view', message: `Viewed ${att.originalName}` }).then(() => onRefresh());
  }

  return (
    <li style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span aria-hidden="true">{fileGlyph(att.originalName)}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {att.originalName}{' '}
          <span style={{ opacity: 0.6 }}>({Math.ceil(att.size / 1024)} KB{att.importedAt ? ` · ${new Date(att.importedAt).toLocaleDateString()}` : ''})</span>
        </span>
        <button onClick={view}>View</button>
        <button onClick={() => void window.api.files.revealAttachment(caseId, att.fileName)}>Reveal</button>
        <button onClick={async () => {
          const next = await promptDialog('New name (keep the extension):', att.originalName, 'Rename attachment');
          if (!next || next === att.originalName) return;
          try { await window.api.files.renameAttachment(caseId, att.fileName, next); await onRefresh(); toast.success('Renamed.'); }
          catch (err) { toast.error(`Rename failed: ${(err as Error).message}`); }
        }}>Rename</button>
        <button onClick={() => void toggleDetails()} title="File metadata">{showDetails ? '▾' : 'ⓘ'}</button>
        <button onClick={() => setSharing(true)} title="Share this attachment to a chat contact (1:1)">📤</button>
        <button onClick={async () => {
          const ok = await confirmDialog(`Send ${att.originalName} to Shred?`, 'Shred attachment');
          if (!ok) return;
          try { await window.api.files.deleteAttachment(caseId, att.fileName); await onRefresh(); toast.success('Sent to Shred.'); }
          catch (err) { toast.error(`Shred failed: ${(err as Error).message}`); }
        }}>Shred</button>
      </div>
      {showDetails && meta && (
        <div style={{ fontSize: 11, background: '#f4f4f4', border: '1px solid #d0d0d0', margin: '4px 0 0 22px', padding: 6 }}>
          <div>Type: {meta.fileType} · Size: {meta.size} bytes</div>
          {meta.modifiedAt && <div>Modified: {new Date(meta.modifiedAt).toLocaleString()}</div>}
          {meta.originalPath && <div>Original path: <code>{meta.originalPath}</code></div>}
          {meta.exif && <div>EXIF: {Object.entries(meta.exif).map(([k, v]) => `${k}=${v}`).join(' · ')}</div>}
          {meta.emlHeaders && <div>Email headers: {meta.emlHeaders.length}</div>}
          {meta.gps && (
            <div>
              {showGps
                ? <span>GPS: {meta.gps.lat.toFixed(5)}, {meta.gps.lon.toFixed(5)}</span>
                : <button onClick={() => setShowGps(true)}>Show location</button>}
            </div>
          )}
        </div>
      )}
      {sharing && (
        <ChatSharePicker
          title={`Share "${att.originalName}" to…`}
          allowGroups={false}
          onPick={(t) => void shareTo(t)}
          onClose={() => setSharing(false)}
        />
      )}
    </li>
  );
}
