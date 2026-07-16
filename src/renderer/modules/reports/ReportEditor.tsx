/** ReportEditor — the report's three-column "Report Template Generator" shell. Left rail hosts the
 *  reusable-text library affordances (contacts / descriptors / introductions); the center column is a
 *  global toolbar (block-add actions + zoom) over a fixed-width white "paper" page (banner, date,
 *  From/To header, then the rich-text / table / image blocks) with a status bar (word + page count +
 *  zoom); the right rail is <RightRail> (descriptor preview, live document outline, image
 *  properties). Editing stays controlled (onChange lifts every keystroke to the module, which owns
 *  the Report); a 600ms debounced autosave persists the working report through the module's
 *  onAutosave. Text-block html is already `sanitizeReportHtml`-clean by the time it reaches `patch`
 *  (TextBlock's own security spine) — the editor never re-parses block html as untrusted markup. */
import { useEffect, useRef, useState } from 'react';
import type { Report, Contact, Descriptor, ReportBlock } from '@shared/reports-types';
import { TextBlock } from './blocks/TextBlock';
import { ImageBlock } from './blocks/ImageBlock';
import { TableBlock } from './blocks/TableBlock';
import { RightRail } from './panels/RightRail';
import { ContactBook } from './ContactBook';
import { extractOutline, wordCount, estimatePageCount } from './outline';

export interface ReportEditorProps {
  report: Report;
  /** ref → data URL cache for the banner preview (resolved from the encrypted store). */
  assets: Record<string, string>;
  contacts: Contact[];
  /** The report's descriptor library — handed down to every TextBlock for its right-click insert menu. */
  descriptors: Descriptor[];
  /** The report's reusable-introduction library — also insertable from every TextBlock's right-click menu. */
  introductions: Descriptor[];
  onChange: (r: Report) => void;
  /** Debounced-persist hook — the module writes to the encrypted store + refreshes its list. */
  onAutosave: (r: Report) => void;
  onUploadBanner: (file: File) => void;
  onRemoveBanner: () => void;
  onManageContacts: () => void;
  onManageDescriptors: () => void;
  /** Open the reusable-introductions library overlay. */
  onManageIntroductions: () => void;
  /** Encrypt + append one image file (from "+ Photo" or a drag-drop) as a new photo block. The
   *  module owns the putAsset round-trip + asset-cache population; the editor only forwards files. */
  onAddPhoto: (file: File) => void;
  /** Append a new (empty 2×2) table block. Module-owned so every block append goes through the same
   *  working-report owner; the editor only surfaces the "+ Table" affordance. */
  onAddTable: () => void;
  /** Open the "Import from case" picker (module-owned overlay). */
  onImportFromCase: () => void;
  /** Page zoom (1 = 100%); the module owns the state so it survives a re-render of the editor. */
  zoom: number;
  onZoom: (z: number) => void;
}

const IMAGE_MIME = ['image/png', 'image/jpeg'];

const AUTOSAVE_MS = 600;

/** The white page's content height in CSS px (min-height 1056 = US-Letter at 96dpi) — the page-count
 *  denominator so a report that overflows one paper page reads "~2 pages". */
const PAGE_HEIGHT_PX = 1056;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;

function clampZoom(z: number): number { return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100)); }

export function ReportEditor(props: ReportEditorProps): JSX.Element {
  const {
    report, assets, contacts, descriptors, introductions, onChange, onAutosave, onUploadBanner, onRemoveBanner,
    onManageContacts, onManageDescriptors, onManageIntroductions, onAddPhoto, onAddTable,
    onImportFromCase, zoom, onZoom
  } = props;
  const [dragOver, setDragOver] = useState(false);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  // Which header field a "Choose…" click opened the ContactBook popup for — null when it's closed.
  // The one popup instance serves both fields; `onUse` below reads this to decide which id to patch.
  const [contactTarget, setContactTarget] = useState<'from' | 'to' | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const pageRef = useRef<HTMLDivElement | null>(null);
  // The id of the report whose text body we've already auto-focused. Keyed on report identity (not a
  // one-shot boolean) so an in-editor report swap — File▸New / any setReport that keeps this instance
  // mounted (non-null → non-null, no remount) — re-focuses the *new* report's body. A plain boolean
  // would latch true on report A and leave report B's freshly-mounted body unfocused, silently
  // breaking type-immediately on the create-while-open path.
  const focusedReportId = useRef<string | null>(null);

  // Word-processor feel: a report always has a typable text body. If none of the blocks is a text
  // block, seed one empty text block at the front (once — guarded by `.some`, so re-renders after
  // the seed don't loop or double-seed). This lifts through onChange, exactly the way an edit does,
  // so the module's setReport owns the seeded block and autosave persists it.
  useEffect(() => {
    if (!report.blocks.some((b) => b.kind === 'text')) {
      const seed: ReportBlock = { id: crypto.randomUUID(), kind: 'text', html: '' };
      onChange({ ...report, blocks: [seed, ...report.blocks] });
    }
  }, [report, onChange]);

  // Focus the first text body once it exists (after the seed round-trips, or immediately for a
  // report that already has one) so the operator can type straight away. Guarded in try/catch —
  // headless/jsdom focus is a no-op there but must not throw.
  useEffect(() => {
    if (focusedReportId.current === report.id) return;
    const el = pageRef.current?.querySelector<HTMLElement>('.ga98-report-textblock-body');
    if (el) {
      focusedReportId.current = report.id;
      try { el.focus(); } catch { /* focus unsupported in this environment; non-fatal */ }
    }
  }, [report]);

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

  // Re-measure the page's rendered height whenever the blocks or zoom change, so the status bar's
  // page estimate tracks content growth. scrollHeight is the un-zoomed content height (transform:
  // scale doesn't change layout height), so the estimate is zoom-independent, as intended.
  useEffect(() => {
    const el = pageRef.current;
    setPageCount(estimatePageCount(el ? el.scrollHeight : 0, PAGE_HEIGHT_PX));
  }, [report, zoom]);

  const bannerUrl = report.bannerRef ? assets[report.bannerRef] : undefined;
  const outline = extractOutline(report.blocks);
  const words = wordCount(report.blocks);
  const selectedImage = report.blocks.find(
    (b): b is Extract<ReportBlock, { kind: 'image' }> => b.kind === 'image' && b.id === selectedImageId
  ) ?? null;

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
    if (id === selectedImageId) setSelectedImageId(null);
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

  function onOutlineJump(id: string): void {
    const el = document.getElementById(`ga98-report-block-${id}`);
    if (el) el.scrollIntoView({ block: 'start' });
  }

  function openContextMenu(e: React.MouseEvent): void {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }
  function runCtx(fn: () => void): void { fn(); setCtxMenu(null); }

  // Fills whichever field (`from` or `to`) the ContactBook popup was opened for — the popup itself
  // doesn't know which header field asked for it, so this reads the target set by "Choose…".
  function useContactFor(id: string): void {
    if (contactTarget === 'to') patch({ toContactId: id });
    else if (contactTarget === 'from') patch({ fromContactId: id });
    setContactTarget(null);
  }

  const fromContact = contacts.find((c) => c.id === report.fromContactId);
  const toContact = contacts.find((c) => c.id === report.toContactId);

  // "To" combobox — typing a value that matches a saved contact's display name exactly resolves to
  // that contact (structured recipient); anything else is carried as free text, same as the legacy
  // `to` string, so a walk-in with no saved Contact record is still a valid recipient.
  function contactDisplayName(c: Contact): string {
    return `${c.name || 'Unnamed'}${c.org ? ` (${c.org})` : ''}`;
  }
  function onToInputChange(value: string): void {
    const match = contacts.find((c) => contactDisplayName(c) === value);
    if (match) patch({ toContactId: match.id, to: '' });
    else patch({ to: value, toContactId: undefined });
  }
  const toInputValue = report.toContactId ? (toContact ? contactDisplayName(toContact) : '') : report.to;

  return (
    <div className="ga98-report-shell ga98-report-editor">
      <div className="ga98-report-leftrail">
        <section>
          <div className="ga98-report-panel-title">Libraries</div>
          <button type="button" onClick={onManageContacts}>Contacts…</button>
          <button type="button" onClick={onManageDescriptors}>Descriptors…</button>
          <button type="button" onClick={onManageIntroductions}>Introductions…</button>
        </section>
        <section>
          <div className="ga98-report-panel-title">Descriptors</div>
          {descriptors.length === 0 ? (
            <div className="ga98-report-descriptorlib-empty">None yet.</div>
          ) : (
            descriptors.map((d) => (
              <div key={d.id} className="ga98-report-descriptor-name">{d.name || 'Untitled'}</div>
            ))
          )}
        </section>
      </div>

      <div className="ga98-report-center">
        <div className="ga98-report-toolbar">
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
          <span className="ga98-report-toolbar-spacer" />
          <button type="button" aria-label="Zoom out" onClick={() => onZoom(clampZoom(zoom - ZOOM_STEP))}>−</button>
          <span className="ga98-report-zoom-label">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => onZoom(clampZoom(zoom + ZOOM_STEP))}>+</button>
        </div>

        <div
          className={`ga98-report-pagescroll${dragOver ? ' ga98-report-body-dragover' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onBodyDrop}
        >
          <div
            className="ga98-report-page"
            ref={pageRef}
            style={{ ['--ga98-report-zoom' as string]: String(zoom) }}
            onContextMenu={openContextMenu}
          >
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

            <div className="ga98-report-header">
              <label className="ga98-report-title-field">
                <span>Title</span>
                <input
                  aria-label="Report title"
                  value={report.title}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </label>

              <label className="ga98-report-date">
                <span>Date</span>
                <input
                  aria-label="Report date"
                  type="date"
                  value={report.reportDate ?? ''}
                  onChange={(e) => patch({ reportDate: e.target.value || undefined })}
                />
              </label>

              <label className="ga98-report-status-field">
                <span>Status</span>
                <select
                  aria-label="Report status"
                  value={report.status}
                  onChange={(e) => patch({ status: e.target.value as Report['status'] })}
                >
                  <option value="draft">Draft</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </select>
              </label>

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
                <button type="button" aria-label="Choose From contact" onClick={() => setContactTarget('from')}>Choose…</button>
                {fromContact ? <span className="ga98-report-from-org">{fromContact.org}</span> : null}
              </div>

              <div className="ga98-report-to">
                <label>
                  <span>To</span>
                  <input
                    aria-label="To recipient"
                    list="report-to-contacts"
                    value={toInputValue}
                    onChange={(e) => onToInputChange(e.target.value)}
                  />
                </label>
                <datalist id="report-to-contacts">
                  {contacts.map((c) => (
                    <option key={c.id} value={contactDisplayName(c)} />
                  ))}
                </datalist>
                <button type="button" aria-label="Choose To contact" onClick={() => setContactTarget('to')}>Choose…</button>
                {toContact ? <span className="ga98-report-to-org">{toContact.org}</span> : null}
              </div>

              <div className="ga98-report-metafields">
                <label className="ga98-report-meta-field">
                  <span>Case #</span>
                  <input
                    aria-label="Case #"
                    value={report.caseNumber ?? ''}
                    onChange={(e) => patch({ caseNumber: e.target.value || undefined })}
                  />
                </label>
                <label className="ga98-report-meta-field">
                  <span>Reference #</span>
                  <input
                    aria-label="Reference #"
                    value={report.referenceNumber ?? ''}
                    onChange={(e) => patch({ referenceNumber: e.target.value || undefined })}
                  />
                </label>
                <label className="ga98-report-meta-field">
                  <span>Classification</span>
                  <input
                    aria-label="Classification"
                    value={report.classification ?? ''}
                    onChange={(e) => patch({ classification: e.target.value || undefined })}
                  />
                </label>
                <label className="ga98-report-meta-field">
                  <span>Signature</span>
                  <input
                    aria-label="Signature"
                    value={report.signature ?? ''}
                    onChange={(e) => patch({ signature: e.target.value || undefined })}
                  />
                </label>
              </div>
            </div>

            <div className="ga98-report-body">
              {report.blocks.map((b) => {
                if (b.kind === 'text') {
                  return (
                    <div key={b.id} id={`ga98-report-block-${b.id}`} className="ga98-report-block">
                      <TextBlock
                        block={b}
                        onChange={(html) => updateTextBlock(b.id, html)}
                        descriptors={descriptors}
                        introductions={introductions}
                      />
                    </div>
                  );
                }
                if (b.kind === 'table') {
                  return (
                    <div key={b.id} id={`ga98-report-block-${b.id}`} className="ga98-report-block">
                      <TableBlock
                        block={b}
                        onChange={(cells) => updateTableBlock(b.id, cells)}
                        onRemove={() => removeBlock(b.id)}
                      />
                    </div>
                  );
                }
                return (
                  <div key={b.id} id={`ga98-report-block-${b.id}`} className="ga98-report-block">
                    <ImageBlock
                      block={b}
                      src={assets[b.assetRef]}
                      selected={b.id === selectedImageId}
                      onSelect={() => setSelectedImageId(b.id)}
                      onChange={(p) => updateImageBlock(b.id, p)}
                      onRemove={() => removeBlock(b.id)}
                    />
                  </div>
                );
              })}
              {report.blocks.length === 0 ? (
                <div className="ga98-report-body-empty">Add a text block or a photo to begin.</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="ga98-report-statusbar">
          <span>Words: {words}</span>
          <span>~{pageCount} {pageCount === 1 ? 'page' : 'pages'}</span>
          <span>{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      <RightRail
        descriptors={descriptors}
        outline={outline}
        selectedImage={selectedImage}
        onOutlineJump={onOutlineJump}
        onImagePatch={(p) => { if (selectedImageId) updateImageBlock(selectedImageId, p); }}
      />

      {ctxMenu ? (
        <>
          <div className="ga98-report-ctxmenu-backdrop" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }} />
          <div className="ga98-report-ctxmenu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button type="button" onClick={() => runCtx(addTextBlock)}>Add text</button>
            <button type="button" onClick={() => runCtx(onAddTable)}>Insert table</button>
            <button type="button" onClick={() => runCtx(onImportFromCase)}>Insert image</button>
            <button type="button" onClick={() => runCtx(onManageDescriptors)}>Add descriptor…</button>
            <button type="button" onClick={() => runCtx(onManageIntroductions)}>Add introduction…</button>
          </div>
        </>
      ) : null}

      {contactTarget ? (
        <ContactBook onUse={useContactFor} onClose={() => setContactTarget(null)} />
      ) : null}
    </div>
  );
}
