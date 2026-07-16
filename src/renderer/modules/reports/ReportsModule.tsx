/** ReportsModule — the Chain-of-Custody report generator host: a saved-reports list (New / Open /
 *  Delete) beside the <ReportEditor>. Owns persistence — talks to window.api.reports.* (the
 *  encrypted main-process store) and resolves banner/image asset refs to data URLs (cached in
 *  `assets`) for the live preview. Export (PDF/DOCX) is main-side by id; the renderer never builds
 *  the export buffer. Contacts are managed through the <ContactBook> overlay. */
import { useCallback, useEffect, useState } from 'react';
import type { Report, Contact, Descriptor, ReportBlock } from '@shared/reports-types';
import { ReportEditor } from './ReportEditor';
import { ContactBook } from './ContactBook';
import { DescriptorLibrary } from './DescriptorLibrary';
import { IntroductionLibrary } from './IntroductionLibrary';
import { CasePhotoPicker, type CasePhotoPick } from './CasePhotoPicker';
import { loadAttachmentBytes } from '../../lib/attachmentBytes';
import { toast } from '../../state/toasts';

function uid(): string { return crypto.randomUUID(); }
function nowIso(): string { return new Date().toISOString(); }

function seedReport(): Report {
  const stamp = nowIso();
  return { id: uid(), title: 'Untitled report', createdAt: stamp, updatedAt: stamp, to: '', status: 'draft', author: 'Investigator', blocks: [] };
}

export function ReportsModule(): JSX.Element {
  const [list, setList] = useState<Report[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [descriptors, setDescriptors] = useState<Descriptor[]>([]);
  const [introductions, setIntroductions] = useState<Descriptor[]>([]);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [showContacts, setShowContacts] = useState(false);
  const [showDescriptors, setShowDescriptors] = useState(false);
  const [showIntroductions, setShowIntroductions] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setList(await window.api.reports.list());
  }, []);
  const refreshContacts = useCallback(async (): Promise<void> => {
    setContacts(await window.api.reports.contacts.list());
  }, []);
  const refreshDescriptors = useCallback(async (): Promise<void> => {
    setDescriptors(await window.api.reports.descriptors.list());
  }, []);
  const refreshIntroductions = useCallback(async (): Promise<void> => {
    setIntroductions(await window.api.reports.introductions.list());
  }, []);

  useEffect(() => {
    void refresh(); void refreshContacts(); void refreshDescriptors(); void refreshIntroductions();
  }, [refresh, refreshContacts, refreshDescriptors, refreshIntroductions]);

  // Resolve every asset ref a report references (banner + image blocks) into the local data-URL
  // cache so the preview embeds them exactly as the exported PDF/DOCX will.
  const loadAssetsFor = useCallback(async (r: Report): Promise<Record<string, string>> => {
    const refs = new Set<string>();
    if (r.bannerRef) refs.add(r.bannerRef);
    for (const b of r.blocks) if (b.kind === 'image') refs.add(b.assetRef);
    const map: Record<string, string> = {};
    for (const ref of refs) {
      const a = await window.api.reports.getAsset(ref);
      if (a) map[ref] = a.dataUrl;
    }
    return map;
  }, []);

  async function newReport(): Promise<void> {
    const seed = seedReport();
    const saved = await window.api.reports.save(seed);
    setAssets({});
    setReport(saved);
    await refresh();
  }

  async function openReport(r: Report): Promise<void> {
    setReport(r);
    setAssets(await loadAssetsFor(r));
  }

  async function removeReport(id: string): Promise<void> {
    await window.api.reports.remove(id);
    if (report?.id === id) { setReport(null); setAssets({}); }
    await refresh();
  }

  // Debounced-autosave sink from the editor: persist the working report + quietly refresh the list.
  const autosave = useCallback(async (r: Report): Promise<void> => {
    const saved = await window.api.reports.save({ ...r, updatedAt: nowIso() });
    setList((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
  }, []);

  async function uploadBanner(file: File): Promise<void> {
    if (!report) return;
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      const ref = await window.api.reports.putAsset(bytes, mime);
      const a = await window.api.reports.getAsset(ref);
      if (a) setAssets((prev) => ({ ...prev, [ref]: a.dataUrl }));
      setReport((prev) => (prev ? { ...prev, bannerRef: ref } : prev));
    } catch {
      toast.error('Could not set banner — image must be a PNG/JPEG under 25 MB.');
    }
  }

  function removeBanner(): void {
    setReport((prev) => (prev ? { ...prev, bannerRef: undefined } : prev));
  }

  // Encrypt one image's bytes into the report asset store, cache its preview URL, and append a photo
  // block. Shared by "+ Photo", drag-drop, and import-from-case so every photo path goes through the
  // same encrypt-at-rest putAsset (bytes never sit in the report JSON — only the assetRef does).
  const addPhotoBytes = useCallback(async (bytes: number[], mime: string): Promise<void> => {
    const ref = await window.api.reports.putAsset(bytes, mime);
    const a = await window.api.reports.getAsset(ref);
    if (a) setAssets((prev) => ({ ...prev, [ref]: a.dataUrl }));
    const block: ReportBlock = { id: uid(), kind: 'image', assetRef: ref, widthPct: 60, caption: '' };
    setReport((prev) => (prev ? { ...prev, blocks: [...prev.blocks, block] } : prev));
  }, []);

  // Append an empty 2×2 table block to the working report. The rectangular grid is what the
  // validator's table branch expects; the per-cell editor keeps it rectangular from here on.
  function addTable(): void {
    const block: ReportBlock = { id: uid(), kind: 'table', cells: [['', ''], ['', '']] };
    setReport((prev) => (prev ? { ...prev, blocks: [...prev.blocks, block] } : prev));
  }

  async function addPhoto(file: File): Promise<void> {
    if (!report) return;
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      await addPhotoBytes(bytes, mime);
    } catch {
      toast.error('Could not add photo — image must be a PNG/JPEG under 25 MB.');
    }
  }

  // Import selected case photos: read each attachment's bytes from ITS case (loadAttachmentBytes is
  // path-confined per-case in main) and re-encrypt them as report assets. A single unreadable pick
  // is toasted and skipped, never aborting the rest.
  async function importCasePhotos(picks: CasePhotoPick[]): Promise<void> {
    if (!report) return;
    for (const p of picks) {
      try {
        const bytes = await loadAttachmentBytes(p.caseId, p.fileName);
        const mime = /\.jpe?g$/i.test(p.originalName || p.fileName) ? 'image/jpeg' : 'image/png';
        await addPhotoBytes(Array.from(bytes), mime);
      } catch {
        toast.error(`Could not import ${p.originalName || p.fileName}`);
      }
    }
  }

  async function exportPdf(): Promise<void> {
    if (!report) return;
    setBusy(true);
    try { const f = await window.api.reports.exportPdf(report.id); if (f) toast.success(`Exported ${f}`); }
    finally { setBusy(false); }
  }
  async function exportDocx(): Promise<void> {
    if (!report) return;
    setBusy(true);
    try { const f = await window.api.reports.exportDocx(report.id); if (f) toast.success(`Exported ${f}`); }
    finally { setBusy(false); }
  }

  function useContact(id: string): void {
    setReport((prev) => (prev ? { ...prev, fromContactId: id } : prev));
    setShowContacts(false);
  }

  return (
    <div className="ga98-reports">
      <div className="ga98-reports-body">
        <div className="ga98-reports-list">
          <div className="ga98-reports-toolbar">
            <button onClick={() => { void newReport(); }}>New report</button>
          </div>
          <ul>
            {list.map((r) => (
              <li key={r.id} className={report?.id === r.id ? 'selected' : undefined}>
                <button className="ga98-reports-open" onClick={() => { void openReport(r); }}>
                  {r.title || 'Untitled report'}
                </button>
                <button aria-label="Delete report" onClick={() => { void removeReport(r.id); }}>✕</button>
              </li>
            ))}
            {list.length === 0 ? <li className="ga98-reports-empty">No reports yet.</li> : null}
          </ul>
        </div>

        <div className="ga98-reports-editor">
          {report ? (
            <>
              <div className="ga98-reports-actions">
                <button disabled={busy} onClick={() => { void exportPdf(); }}>Export PDF</button>
                <button disabled={busy} onClick={() => { void exportDocx(); }}>Export DOCX</button>
              </div>
              <ReportEditor
                report={report}
                assets={assets}
                contacts={contacts}
                descriptors={descriptors}
                introductions={introductions}
                onChange={setReport}
                onAutosave={(r) => { void autosave(r); }}
                onUploadBanner={(f) => { void uploadBanner(f); }}
                onRemoveBanner={removeBanner}
                onManageContacts={() => setShowContacts(true)}
                onManageDescriptors={() => setShowDescriptors(true)}
                onManageIntroductions={() => setShowIntroductions(true)}
                onAddPhoto={(f) => { void addPhoto(f); }}
                onAddTable={addTable}
                onImportFromCase={() => setShowImport(true)}
                zoom={zoom}
                onZoom={setZoom}
              />
            </>
          ) : (
            <div className="ga98-reports-placeholder">Select a report or create a new one.</div>
          )}
        </div>
      </div>

      {showContacts ? (
        <ContactBook
          onUse={useContact}
          onClose={() => { setShowContacts(false); void refreshContacts(); }}
        />
      ) : null}

      {showDescriptors ? (
        <DescriptorLibrary
          onClose={() => { setShowDescriptors(false); void refreshDescriptors(); }}
        />
      ) : null}

      {showIntroductions ? (
        <IntroductionLibrary
          onClose={() => { setShowIntroductions(false); void refreshIntroductions(); }}
        />
      ) : null}

      {showImport ? (
        <CasePhotoPicker
          onAdd={(picks) => { void importCasePhotos(picks); }}
          onClose={() => setShowImport(false)}
        />
      ) : null}
    </div>
  );
}
