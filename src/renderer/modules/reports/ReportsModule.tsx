/** ReportsModule — the Chain-of-Custody report generator shell. It owns persistence (talks to
 *  window.api.reports.* — the encrypted main-process store — and resolves banner/image asset refs to
 *  data URLs cached in `assets` for the live preview) and hosts the Win98 app shell: a menu bar +
 *  toolbar over a body row of the left Explorer nav tree and a center view that swaps between the
 *  landing <ReportsDashboard> (when no report is open) and the <ReportEditor>. A central `dispatch`
 *  maps every menu/toolbar/tile/quick-action id to a handler. Export (PDF/DOCX) is main-side by id;
 *  the renderer never builds the export buffer. Contacts are managed through the <ContactBook>
 *  overlay. The default author for a freshly-seeded report comes from settings.reports.author. */
import { useCallback, useEffect, useState } from 'react';
import type { Report, Contact, Descriptor, ReportBlock, ReportTemplate } from '@shared/reports-types';
import { ReportEditor } from './ReportEditor';
import { ReportsDashboard } from './ReportsDashboard';
import { TemplatePreview } from './TemplatePreview';
import { ReportsMenuBar, type ReportsActionId } from './ReportsMenuBar';
import { ReportsToolbar } from './ReportsToolbar';
import { ReportsNavTree } from './ReportsNavTree';
import { filterReports, duplicateReport, type NavNode } from './reports-filters';
import type { ReportContextAction } from './RecentReportsTable';
import { ContactBook } from './ContactBook';
import { DescriptorLibrary } from './DescriptorLibrary';
import { IntroductionLibrary } from './IntroductionLibrary';
import { CasePhotoPicker, type CasePhotoPick } from './CasePhotoPicker';
import { loadAttachmentBytes } from '../../lib/attachmentBytes';
import { promptDialog } from '../../state/dialogs';
import { toast } from '../../state/toasts';

function uid(): string { return crypto.randomUUID(); }
function nowIso(): string { return new Date().toISOString(); }

function seedReport(author: string): Report {
  const stamp = nowIso();
  // Seed one empty text block so "Create New Report" opens straight into a typable document (the
  // editor also self-seeds a text body, but seeding here means the very first persisted revision
  // already carries it).
  return { id: uid(), title: 'Untitled report', createdAt: stamp, updatedAt: stamp, to: '', status: 'draft', author, blocks: [{ id: uid(), kind: 'text', html: '' }] };
}

export function ReportsModule(): JSX.Element {
  const [list, setList] = useState<Report[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [descriptors, setDescriptors] = useState<Descriptor[]>([]);
  const [introductions, setIntroductions] = useState<Descriptor[]>([]);
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templatePreviewHtml, setTemplatePreviewHtml] = useState('');
  // Whether the Templates library is the active center view. It isn't a report NavNode (which drives
  // the Dashboard filter), so it rides its own flag; opening a report or any nav node clears it.
  const [templatesView, setTemplatesView] = useState(false);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [showContacts, setShowContacts] = useState(false);
  const [showDescriptors, setShowDescriptors] = useState(false);
  const [showIntroductions, setShowIntroductions] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  // Shell state: which nav node the Dashboard filters by, which recent-table row is selected, and the
  // default author seeded onto a new report (loaded from settings.reports.author on mount).
  const [navNode, setNavNode] = useState<NavNode>('dashboard');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [author, setAuthor] = useState('Investigator');

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
  // Templates access is optional-chained/try-wrapped so an older preload or a bare test stub (which
  // may not expose reports.templates) simply keeps an empty library rather than crashing the shell.
  const refreshTemplates = useCallback(async (): Promise<void> => {
    try { setTemplates((await window.api.reports.templates?.list?.()) ?? []); }
    catch { /* keep the empty library */ }
  }, []);

  useEffect(() => {
    void refresh(); void refreshContacts(); void refreshDescriptors(); void refreshIntroductions(); void refreshTemplates();
  }, [refresh, refreshContacts, refreshDescriptors, refreshIntroductions, refreshTemplates]);

  // Load the default report author from settings.reports.author (deep-merged, so it survives an
  // upgrade). Defensive: the read is optional-chained and try/wrapped so a settings API that isn't
  // present (older preload, a bare test stub) simply keeps the 'Investigator' default rather than
  // crashing the shell.
  useEffect(() => {
    void (async () => {
      try {
        const s = await window.api.settings?.read?.();
        const a = s?.reports?.author;
        if (typeof a === 'string' && a.trim().length > 0) setAuthor(a.trim());
      } catch { /* keep the 'Investigator' default */ }
    })();
  }, []);

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
    const seed = seedReport(author);
    const saved = await window.api.reports.save(seed);
    setAssets({});
    setReport(saved);
    await refresh();
  }

  async function openReport(r: Report): Promise<void> {
    setReport(r);
    setAssets(await loadAssetsFor(r));
  }

  function openReportById(id: string): void {
    const r = list.find((x) => x.id === id);
    if (r) void openReport(r);
  }

  async function removeReport(id: string): Promise<void> {
    await window.api.reports.remove(id);
    if (report?.id === id) { setReport(null); setAssets({}); }
    // Clear the dashboard selection if it pointed at the deleted report, otherwise the Export/Print
    // tile + "Open Selected Report" stay enabled pointing at a now-nonexistent id (exportPdf on a
    // dead id / a silent no-op open).
    if (selectedId === id) setSelectedId(null);
    await refresh();
  }

  // Persist a copy of the given report under a fresh id (Save As / Duplicate). Uses the pure
  // duplicateReport transform (fresh id, "(copy)" title, status reset to draft) so every duplicate
  // path is identical.
  async function duplicateReportById(id: string): Promise<void> {
    const r = list.find((x) => x.id === id);
    if (!r) return;
    await window.api.reports.save(duplicateReport(r, uid(), nowIso()));
    await refresh();
  }

  // Select a template in the library: ask main to build its buildReportHtml (assets resolved
  // main-side) and drop it into the sandboxed preview iframe. previewTemplate is optional-chained so
  // an older preload/test stub degrades to a blank preview instead of throwing.
  async function selectTemplate(id: string): Promise<void> {
    setSelectedTemplateId(id);
    try { setTemplatePreviewHtml((await window.api.reports.previewTemplate?.(id)) ?? ''); }
    catch { setTemplatePreviewHtml(''); }
  }

  // Deep-copy a report/template body's assets so the clone owns independent bytes: every banner +
  // image ref is re-encrypted via copyAsset (fresh uuid) and every block gets a fresh id. This is
  // what makes a template survive deletion of its source report (and vice-versa). A ref that fails
  // to copy falls back to the original so the body is never left dangling.
  async function copyBody(src: { bannerRef?: string; blocks: ReportBlock[] }): Promise<{ bannerRef?: string; blocks: ReportBlock[] }> {
    const bannerRef = src.bannerRef ? (await window.api.reports.copyAsset(src.bannerRef)) ?? src.bannerRef : undefined;
    const blocks: ReportBlock[] = [];
    for (const b of src.blocks) {
      if (b.kind === 'image') {
        const copied = await window.api.reports.copyAsset(b.assetRef);
        blocks.push({ ...b, id: uid(), assetRef: copied ?? b.assetRef });
      } else {
        blocks.push({ ...b, id: uid() });
      }
    }
    return { bannerRef, blocks };
  }

  // Save the open report as a reusable template. Prompts for a name via the themed promptDialog
  // (never window.prompt — a no-op in Electron), deep-copies the banner + image assets so the
  // template owns independent bytes, persists it, and refreshes the library.
  async function saveAsTemplate(): Promise<void> {
    if (!report) return;
    const name = await promptDialog('Template name:', report.title || 'Untitled template', 'Save as Template');
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const stamp = nowIso();
    const { bannerRef, blocks } = await copyBody(report);
    const template: ReportTemplate = {
      id: uid(), name: trimmed, createdAt: stamp, updatedAt: stamp,
      bannerRef, fromContactId: report.fromContactId, to: report.to, reportDate: report.reportDate,
      caseNumber: report.caseNumber, referenceNumber: report.referenceNumber,
      classification: report.classification, signature: report.signature,
      blocks
    };
    await window.api.reports.templates.save(template);
    await refreshTemplates();
    toast.success(`Saved template “${trimmed}”.`);
  }

  // Clone a template into a fresh draft report and open it in the editor. Its banner + image assets
  // are deep-copied (copyBody) so the report and template own separate bytes; block ids are
  // regenerated so the new document is independent. The default author comes from settings, exactly
  // like a blank new report.
  async function createFromTemplate(t: ReportTemplate): Promise<void> {
    const stamp = nowIso();
    const { bannerRef, blocks } = await copyBody(t);
    const seed: Report = {
      id: uid(), title: t.name || 'Untitled report', createdAt: stamp, updatedAt: stamp,
      bannerRef, fromContactId: t.fromContactId, to: t.to, reportDate: t.reportDate,
      caseNumber: t.caseNumber, referenceNumber: t.referenceNumber, classification: t.classification,
      signature: t.signature, status: 'draft', author,
      blocks
    };
    const saved = await window.api.reports.save(seed);
    await openReport(saved);
    await refresh();
  }

  // Flip a report to archived from the dashboard context menu (no need to open it). Keep the open
  // editor in sync if it happens to be the same report.
  async function archiveReport(id: string): Promise<void> {
    const r = list.find((x) => x.id === id);
    if (!r) return;
    const saved = await window.api.reports.save({ ...r, status: 'archived', updatedAt: nowIso() });
    if (report?.id === id) setReport(saved);
    await refresh();
  }

  // Export any report by id (main-side) — used by the dashboard Export/Print tile + row context menu,
  // which act on a selected report without first opening it into the editor.
  async function exportReportById(id: string): Promise<void> {
    setBusy(true);
    try { const f = await window.api.reports.exportPdf(id); if (f) toast.success(`Exported ${f}`); }
    finally { setBusy(false); }
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

  // Return to the Dashboard (close the editor) on a given nav node — used by "Close Report",
  // "Dashboard", "Open Report…" and the nav-tree node clicks.
  function showDashboard(node: NavNode): void {
    // Flush the editor's pending debounced autosave before unmounting it: nulling `report` unmounts
    // <ReportEditor>, whose effect cleanup clearTimeout()s the queued 600ms save, so the last edit
    // (already lifted into `report` via onChange) would otherwise never reach the store.
    if (report) void autosave(report);
    setReport(null);
    setAssets({});
    setTemplatesView(false);
    setNavNode(node);
  }

  // Open the Templates library center view (close any open editor first, flushing its pending save
  // the same way showDashboard does).
  function showTemplatesLibrary(): void {
    if (report) void autosave(report);
    setReport(null);
    setAssets({});
    setTemplatesView(true);
  }

  // Central action dispatcher — every menu item, toolbar button and dashboard tile routes its
  // ReportsActionId here. Editor-only ids (save/export/print/edit ops + Save-as-Template) are gated
  // `disabled` by the menu/toolbar when no report is open; the guards below are belt-and-suspenders.
  function dispatch(id: ReportsActionId): void {
    switch (id) {
      case 'new': void newReport(); break;
      case 'open': showDashboard('all'); break;
      case 'dashboard': showDashboard('dashboard'); break;
      case 'refresh': void refresh(); break;
      case 'save': if (report) { void autosave(report); toast.success('Report saved.'); } break;
      case 'saveAs': if (report) void duplicateReportById(report.id); break;
      case 'exportPdf': void exportPdf(); break;
      case 'exportDocx': void exportDocx(); break;
      case 'print': window.print(); break;
      case 'close': showDashboard(navNode); break;
      case 'contacts': setShowContacts(true); break;
      case 'options': toast.info('Reports options live in Start ▸ Settings.'); break;
      case 'about': toast.info('Ghost Intel 98 — Report Generator'); break;
      // Native rich-text ops on the focused contentEditable block (real behaviour, not a no-op).
      case 'undo': document.execCommand('undo'); break;
      case 'redo': document.execCommand('redo'); break;
      case 'cut': document.execCommand('cut'); break;
      case 'copy': document.execCommand('copy'); break;
      case 'paste': document.execCommand('paste'); break;
      // Templates: save the open report as a template, or open the library to pick one.
      case 'templateSave': if (report) void saveAsTemplate(); break;
      case 'templateLibrary': case 'templateUse': showTemplatesLibrary(); break;
    }
  }

  // Nav-tree node selection: switch the Dashboard filter and return to the Dashboard view.
  function onNavSelect(node: NavNode): void { showDashboard(node); }

  // Recent-table row context menu (Open/Rename/Duplicate/Export/Archive/Delete). Rename has no
  // standalone dialog in this shell (Electron's window.prompt is a no-op), so it opens the report
  // into the editor where the title field lives — a real edit path, never a dead handler.
  function onReportContext(id: string, action: ReportContextAction): void {
    switch (action) {
      case 'open': case 'rename': openReportById(id); break;
      case 'duplicate': void duplicateReportById(id); break;
      case 'export': void exportReportById(id); break;
      case 'archive': void archiveReport(id); break;
      case 'delete': void removeReport(id); break;
    }
  }

  const hasOpenReport = report !== null;
  const showTemplates = !hasOpenReport && templatesView;
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  return (
    <div className="ga98-report-appshell">
      <ReportsMenuBar hasOpenReport={hasOpenReport} onAction={dispatch} />
      <ReportsToolbar hasOpenReport={hasOpenReport} onAction={dispatch} />

      <div className="ga98-report-appbody">
        <ReportsNavTree
          active={navNode}
          onSelect={onNavSelect}
          onNewReport={() => { void newReport(); }}
          onManageContacts={() => setShowContacts(true)}
          onViewTemplates={showTemplatesLibrary}
          templatesActive={showTemplates}
        />

        <div className="ga98-report-appmain">
          {showTemplates ? (
            <div className="ga98-report-dashboard">
              <div className="ga98-report-panel">
                <div className="ga98-report-titlebar">
                  <span>Templates</span>
                  <span className="ga98-report-titlebar-x" aria-hidden="true">×</span>
                </div>
                <div className="ga98-report-panel-body ga98-report-tpl-view">
                  <div className="ga98-report-tpl-list">
                    {templates.length === 0 ? (
                      <div className="ga98-report-tpl-empty">No templates yet. Open a report and choose “Save as Template.”</div>
                    ) : (
                      templates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          data-tpl={t.id}
                          className={`ga98-report-tpl-row${selectedTemplateId === t.id ? ' ga98-report-tpl-row-active' : ''}`}
                          onClick={() => { void selectTemplate(t.id); }}
                        >
                          <span className="ga98-report-tpl-row-name">{t.name}</span>
                          {t.category ? <span className="ga98-report-tpl-row-cat">{t.category}</span> : null}
                        </button>
                      ))
                    )}
                  </div>
                  {selectedTemplate ? (
                    <TemplatePreview
                      html={templatePreviewHtml}
                      templateName={selectedTemplate.name}
                      onSelect={() => { void createFromTemplate(selectedTemplate); }}
                    />
                  ) : (
                    <div className="ga98-report-panel ga98-report-tpl-preview">
                      <div className="ga98-report-titlebar">
                        <span>Preview</span>
                        <span className="ga98-report-titlebar-x" aria-hidden="true">×</span>
                      </div>
                      <div className="ga98-report-panel-body ga98-report-tpl-preview-empty">
                        Select a template to preview it.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : report ? (
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
          ) : (
            <ReportsDashboard
              reports={filterReports(list, navNode)}
              author={author}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onOpen={openReportById}
              onContext={onReportContext}
              onNewReport={() => { void newReport(); }}
              onManageContacts={() => setShowContacts(true)}
              onUseTemplate={showTemplatesLibrary}
              onExportSelected={() => { if (selectedId) void exportReportById(selectedId); }}
              onViewAll={() => setNavNode('all')}
            />
          )}
        </div>
      </div>

      <div className="ga98-statusbar ga98-report-statusbar-shell">
        <span className="ga98-report-statusbar-field">{busy ? 'Working…' : hasOpenReport ? `Editing: ${report?.title || 'Untitled report'}` : 'Ready'}</span>
        <span className="ga98-report-statusbar-field">{list.length} report{list.length === 1 ? '' : 's'}</span>
        <span className="ga98-report-statusbar-field">Current Workspace: Default</span>
        <span className="ga98-report-statusbar-field ga98-report-statusbar-enc">🔒 ENCRYPTED</span>
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
