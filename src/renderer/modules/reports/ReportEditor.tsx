/** ReportEditor — the report's fixed header plus its block body. Task 5 landed the header: a
 *  banner slot (upload → encrypted putAsset, preview, Remove), a From <select> of saved contacts
 *  with a "Manage contacts" affordance, a To recipient <input>, and a title <input>. Task 6 adds
 *  the body's rich-text blocks: "+ Text" appends a block, each block renders as a <TextBlock>
 *  whose html is already `sanitizeReportHtml`-clean by the time it reaches `patch` (TextBlock's own
 *  security spine). Editing is controlled (onChange lifts every keystroke to the module, which owns
 *  the Report), and a 600ms debounced autosave persists the working report through
 *  window.api.reports.save — the same debounce cadence as the whiteboard. Photo blocks arrive in
 *  Task 8. */
import { useEffect, useRef, useState } from 'react';
import type { Report, Contact, Descriptor, ReportBlock } from '@shared/reports-types';
import { TextBlock } from './blocks/TextBlock';
import { ImageBlock } from './blocks/ImageBlock';
import { TableBlock } from './blocks/TableBlock';

export interface ReportEditorProps {
  report: Report;
  /** ref → data URL cache for the banner preview (resolved from the encrypted store). */
  assets: Record<string, string>;
  contacts: Contact[];
  /** The report's descriptor library — handed down to every TextBlock for its right-click insert menu. */
  descriptors: Descriptor[];
  onChange: (r: Report) => void;
  /** Debounced-persist hook — the module writes to the encrypted store + refreshes its list. */
  onAutosave: (r: Report) => void;
  onUploadBanner: (file: File) => void;
  onRemoveBanner: () => void;
  onManageContacts: () => void;
  onManageDescriptors: () => void;
  /** Encrypt + append one image file (from "+ Photo" or a drag-drop) as a new photo block. The
   *  module owns the putAsset round-trip + asset-cache population; the editor only forwards files. */
  onAddPhoto: (file: File) => void;
  /** Append a new (empty 2×2) table block. Module-owned so every block append goes through the same
   *  working-report owner; the editor only surfaces the "+ Table" affordance. */
  onAddTable: () => void;
  /** Open the "Import from case" picker (module-owned overlay). */
  onImportFromCase: () => void;
}

const IMAGE_MIME = ['image/png', 'image/jpeg'];

const AUTOSAVE_MS = 600;

export function ReportEditor(props: ReportEditorProps): JSX.Element {
  const { report, assets, contacts, descriptors, onChange, onAutosave, onUploadBanner, onRemoveBanner, onManageContacts, onManageDescriptors, onAddPhoto, onAddTable, onImportFromCase } = props;
  const [dragOver, setDragOver] = useState(false);

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

  function updateImageBlock(id: string, p: Partial<Extract<ReportBlock, { kind: 'image' }>>): void {
    patch({ blocks: report.blocks.map((b) => (b.id === id && b.kind === 'image' ? { ...b, ...p } : b)) });
  }

  function updateTableBlock(id: string, cells: string[][]): void {
    patch({ blocks: report.blocks.map((b) => (b.id === id && b.kind === 'table' ? { ...b, cells } : b)) });
  }

  function removeBlock(id: string): void {
    patch({ blocks: report.blocks.filter((b) => b.id !== id) });
  }

  // Drag-drop images onto the body → same encrypt-and-append path as "+ Photo". Only png/jpeg (the
  // report asset store's supported mimes) are taken; anything else is ignored rather than stored as
  // an unrenderable blob.
  function onBodyDrop(e: React.DragEvent): void {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => IMAGE_MIME.includes(f.type));
    for (const f of files) onAddPhoto(f);
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

      <div
        className={`ga98-report-body${dragOver ? ' ga98-report-body-dragover' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onBodyDrop}
      >
        <div className="ga98-report-body-toolbar">
          <button type="button" onClick={addTextBlock}>+ Text</button>
          <label className="ga98-report-addphoto">
            <span>+ Photo</span>
            <input
              aria-label="Add photo"
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onAddPhoto(f); e.target.value = ''; }}
            />
          </label>
          <button type="button" onClick={onAddTable}>+ Table</button>
          <button type="button" onClick={onImportFromCase}>Import from case</button>
          <button type="button" onClick={onManageDescriptors}>Manage descriptors</button>
        </div>
        {report.blocks.map((b) => {
          if (b.kind === 'text') {
            return (
              <TextBlock
                key={b.id}
                block={b}
                onChange={(html) => updateTextBlock(b.id, html)}
                descriptors={descriptors}
              />
            );
          }
          if (b.kind === 'table') {
            return (
              <TableBlock
                key={b.id}
                block={b}
                onChange={(cells) => updateTableBlock(b.id, cells)}
                onRemove={() => removeBlock(b.id)}
              />
            );
          }
          return (
            <ImageBlock
              key={b.id}
              block={b}
              src={assets[b.assetRef]}
              onChange={(p) => updateImageBlock(b.id, p)}
              onRemove={() => removeBlock(b.id)}
            />
          );
        })}
        {report.blocks.length === 0 ? (
          <div className="ga98-report-body-empty">Add a text block or a photo to begin.</div>
        ) : null}
      </div>
    </div>
  );
}
