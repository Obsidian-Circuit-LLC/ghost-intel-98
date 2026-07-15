/** ReportEditor — the report's fixed header plus its block body. Task 5 landed the header: a
 *  banner slot (upload → encrypted putAsset, preview, Remove), a From <select> of saved contacts
 *  with a "Manage contacts" affordance, a To recipient <input>, and a title <input>. Task 6 adds
 *  the body's rich-text blocks: "+ Text" appends a block, each block renders as a <TextBlock>
 *  whose html is already `sanitizeReportHtml`-clean by the time it reaches `patch` (TextBlock's own
 *  security spine). Editing is controlled (onChange lifts every keystroke to the module, which owns
 *  the Report), and a 600ms debounced autosave persists the working report through
 *  window.api.reports.save — the same debounce cadence as the whiteboard. Photo blocks arrive in
 *  Task 8. */
import { useEffect, useRef } from 'react';
import type { Report, Contact, ReportBlock } from '@shared/reports-types';
import { TextBlock } from './blocks/TextBlock';

export interface ReportEditorProps {
  report: Report;
  /** ref → data URL cache for the banner preview (resolved from the encrypted store). */
  assets: Record<string, string>;
  contacts: Contact[];
  onChange: (r: Report) => void;
  /** Debounced-persist hook — the module writes to the encrypted store + refreshes its list. */
  onAutosave: (r: Report) => void;
  onUploadBanner: (file: File) => void;
  onRemoveBanner: () => void;
  onManageContacts: () => void;
}

const AUTOSAVE_MS = 600;

export function ReportEditor(props: ReportEditorProps): JSX.Element {
  const { report, assets, contacts, onChange, onAutosave, onUploadBanner, onRemoveBanner, onManageContacts } = props;

  // Debounced autosave: after the report stops changing for AUTOSAVE_MS, persist it. Skip the first
  // run (the report was just loaded, not edited) so opening a report doesn't immediately rewrite it.
  const firstRun = useRef(true);
  const latest = useRef(report);
  latest.current = report;
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    const t = setTimeout(() => { onAutosave(latest.current); }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [report, onAutosave]);

  const bannerUrl = report.bannerRef ? assets[report.bannerRef] : undefined;

  function patch(p: Partial<Report>): void { onChange({ ...report, ...p }); }

  function addTextBlock(): void {
    const block: ReportBlock = { id: crypto.randomUUID(), kind: 'text', html: '' };
    patch({ blocks: [...report.blocks, block] });
  }

  function updateTextBlock(id: string, html: string): void {
    patch({ blocks: report.blocks.map((b) => (b.id === id && b.kind === 'text' ? { ...b, html } : b)) });
  }

  return (
    <div className="ga98-report-editor">
      <div className="ga98-report-header">
        <label className="ga98-report-title-field">
          <span>Title</span>
          <input
            aria-label="Report title"
            value={report.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </label>

        <div className="ga98-report-banner">
          {bannerUrl ? (
            <>
              <img className="ga98-report-banner-img" src={bannerUrl} alt="Report banner" />
              <button onClick={onRemoveBanner}>Remove banner</button>
            </>
          ) : (
            <label className="ga98-report-banner-upload">
              <span>Upload banner</span>
              <input
                aria-label="Upload banner"
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadBanner(f); e.target.value = ''; }}
              />
            </label>
          )}
        </div>

        <div className="ga98-report-from">
          <label>
            <span>From</span>
            <select
              aria-label="From contact"
              value={report.fromContactId ?? ''}
              onChange={(e) => patch({ fromContactId: e.target.value || undefined })}
            >
              <option value="">— none —</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name || 'Unnamed'}{c.org ? ` (${c.org})` : ''}</option>
              ))}
            </select>
          </label>
          <button onClick={onManageContacts}>Manage contacts</button>
        </div>

        <label className="ga98-report-to">
          <span>To</span>
          <input
            aria-label="To recipient"
            value={report.to}
            onChange={(e) => patch({ to: e.target.value })}
          />
        </label>
      </div>

      <div className="ga98-report-body">
        <div className="ga98-report-body-toolbar">
          <button type="button" onClick={addTextBlock}>+ Text</button>
        </div>
        {report.blocks.map((b) => (
          b.kind === 'text'
            ? <TextBlock key={b.id} block={b} onChange={(html) => updateTextBlock(b.id, html)} />
            : null /* image blocks render via Task 8's ImageBlock */
        ))}
      </div>
    </div>
  );
}
