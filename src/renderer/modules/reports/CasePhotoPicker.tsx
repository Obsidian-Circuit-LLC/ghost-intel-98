/** CasePhotoPicker — the "Import from case" overlay for a report's photo blocks. Lists the
 *  operator's cases (cases.list), and on selecting one lists that case's image attachments
 *  (files.listAttachments, filtered to the store-supported still-image types). The operator ticks
 *  the photos to pull; "Add selected" hands the chosen {caseId, fileName, originalName} tuples back
 *  to the module, which reads each attachment's bytes (loadAttachmentBytes) and re-encrypts them
 *  into the report store via reports.putAsset — a within-case copy, never a move, and only for the
 *  attachments the operator explicitly selected.
 *
 *  Only png/jpeg are offered: the report asset store persists exactly those two mimes (banner path),
 *  so surfacing a webp/gif here would import a blob the preview + export can't render. */
import { useEffect, useState } from 'react';
import type { CaseSummary, AttachmentMeta } from '@shared/types';

/** A still-image attachment the report store can round-trip (png/jpeg only — see file header). */
const IMPORTABLE_EXT = ['png', 'jpg', 'jpeg'];
function isImportableImage(name: string): boolean {
  return IMPORTABLE_EXT.includes((name.split('.').pop() ?? '').toLowerCase());
}

export interface CasePhotoPick {
  caseId: string;
  fileName: string;
  originalName: string;
}

export interface CasePhotoPickerProps {
  onAdd: (picks: CasePhotoPick[]) => void;
  /** Upload from computer: hands a raw File straight to the same add-photo path the "+ Photo"
   *  toolbar button uses (addPhoto/addPhotoBytes), bypassing the case-attachment list entirely. */
  onUploadFile: (file: File) => void;
  onClose: () => void;
}

export function CasePhotoPicker(props: CasePhotoPickerProps): JSX.Element {
  const { onAdd, onUploadFile, onClose } = props;
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [caseId, setCaseId] = useState<string>('');
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => { void window.api.cases.list().then(setCases); }, []);

  async function chooseCase(id: string): Promise<void> {
    setCaseId(id);
    setSelected(new Set());
    setAttachments([]);
    if (!id) return;
    setLoading(true);
    try {
      const list = await window.api.files.listAttachments(id);
      setAttachments(list.filter((a) => isImportableImage(a.originalName || a.fileName)));
    } finally { setLoading(false); }
  }

  function toggle(fileName: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fileName)) next.delete(fileName); else next.add(fileName);
      return next;
    });
  }

  function addSelected(): void {
    const picks: CasePhotoPick[] = attachments
      .filter((a) => selected.has(a.fileName))
      .map((a) => ({ caseId, fileName: a.fileName, originalName: a.originalName || a.fileName }));
    if (picks.length > 0) onAdd(picks);
    onClose();
  }

  function uploadFromComputer(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    if (!f) return;
    onUploadFile(f);
    onClose();
  }

  return (
    <div className="ga98-report-overlay" role="dialog" aria-label="Import photos from a case" onMouseDown={onClose}>
      <div className="ga98-report-casepicker" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ga98-report-casepicker-head">
          <span>Import photos from a case</span>
          <button type="button" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <label className="ga98-report-casepicker-select">
          <span>Case</span>
          <select aria-label="Case" value={caseId} onChange={(e) => { void chooseCase(e.target.value); }}>
            <option value="">— select a case —</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>{c.title || c.reference || c.id}</option>
            ))}
          </select>
        </label>

        <label className="ga98-report-casepicker-upload">
          <span>Upload from computer</span>
          <input
            aria-label="Upload photo from computer"
            type="file"
            accept="image/png,image/jpeg"
            onChange={uploadFromComputer}
          />
        </label>

        <div className="ga98-report-casepicker-list">
          {loading ? (
            <div className="ga98-report-casepicker-empty">Loading…</div>
          ) : !caseId ? (
            <div className="ga98-report-casepicker-empty">Pick a case to see its photos.</div>
          ) : attachments.length === 0 ? (
            <div className="ga98-report-casepicker-empty">No importable photos in this case.</div>
          ) : attachments.map((a) => (
            <label key={a.fileName} className="ga98-report-casepicker-item">
              <input
                type="checkbox"
                aria-label={`Select ${a.originalName || a.fileName}`}
                checked={selected.has(a.fileName)}
                onChange={() => toggle(a.fileName)}
              />
              <span>{a.originalName || a.fileName}</span>
            </label>
          ))}
        </div>

        <div className="ga98-report-casepicker-actions">
          <button type="button" onClick={addSelected} disabled={selected.size === 0}>
            Add selected{selected.size ? ` (${selected.size})` : ''}
          </button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
