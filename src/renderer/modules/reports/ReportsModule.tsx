/** ReportsModule — the Chain-of-Custody report generator host: a saved-reports list (New / Open /
 *  Delete) beside the <ReportEditor>. Owns persistence — talks to window.api.reports.* (the
 *  encrypted main-process store) and resolves banner/image asset refs to data URLs (cached in
 *  `assets`) for the live preview. Export (PDF/DOCX) is main-side by id; the renderer never builds
 *  the export buffer. Contacts are managed through the <ContactBook> overlay. */
import { useCallback, useEffect, useState } from 'react';
import type { Report, Contact } from '@shared/reports-types';
import { ReportEditor } from './ReportEditor';
import { ContactBook } from './ContactBook';
import { toast } from '../../state/toasts';

function uid(): string { return crypto.randomUUID(); }
function nowIso(): string { return new Date().toISOString(); }

function seedReport(): Report {
  const stamp = nowIso();
  return { id: uid(), title: 'Untitled report', createdAt: stamp, updatedAt: stamp, to: '', blocks: [] };
}

export function ReportsModule(): JSX.Element {
  const [list, setList] = useState<Report[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [showContacts, setShowContacts] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setList(await window.api.reports.list());
  }, []);
  const refreshContacts = useCallback(async (): Promise<void> => {
    setContacts(await window.api.reports.contacts.list());
  }, []);

  useEffect(() => { void refresh(); void refreshContacts(); }, [refresh, refreshContacts]);

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
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const ref = await window.api.reports.putAsset(bytes, mime);
    const a = await window.api.reports.getAsset(ref);
    if (a) setAssets((prev) => ({ ...prev, [ref]: a.dataUrl }));
    setReport((prev) => (prev ? { ...prev, bannerRef: ref } : prev));
  }

  function removeBanner(): void {
    setReport((prev) => (prev ? { ...prev, bannerRef: undefined } : prev));
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
                onChange={setReport}
                onAutosave={(r) => { void autosave(r); }}
                onUploadBanner={(f) => { void uploadBanner(f); }}
                onRemoveBanner={removeBanner}
                onManageContacts={() => setShowContacts(true)}
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
    </div>
  );
}
