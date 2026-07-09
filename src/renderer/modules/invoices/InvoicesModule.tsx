/** Invoices module host — a two-pane workspace: a list of saved invoices (New / Open / Duplicate /
 *  Delete) on the left, and the <InvoiceForm> editor for the selected/new invoice on the right with
 *  Save + Export PDF. Owns persistence: talks to window.api.invoices.* (encrypted main-process store).
 *  Image assets are persisted as encrypted blobs via putAsset and resolved to data URLs (cached in
 *  `assets`) for the live preview; export builds the HTML in the renderer and hands prebuilt HTML to
 *  main (main never imports a renderer module). */
import { useCallback, useEffect, useState } from 'react';
import type { Invoice } from '@shared/invoice-types';
import { InvoiceForm } from './InvoiceForm';
import { renderInvoiceHtml } from './invoice-html';
import { toast } from '../../state/toasts';

function today(): string { return new Date().toISOString().slice(0, 10); }
function nowIso(): string { return new Date().toISOString(); }
function uid(): string { return crypto.randomUUID(); }

function seedInvoice(number: string): Invoice {
  const stamp = nowIso();
  return {
    id: uid(),
    number,
    issueDate: today(),
    currency: 'USD',
    rate: 0,
    sender: { name: '', company: '' },
    client: { name: '', company: '' },
    lines: [{ id: uid(), date: today(), start: '', end: '', description: '' }],
    createdAt: stamp,
    updatedAt: stamp,
  };
}

export function InvoicesModule(): JSX.Element {
  const [list, setList] = useState<Invoice[]>([]);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setList(await window.api.invoices.list());
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Resolve every asset ref an invoice references (logos + signature) into the local data-URL cache
  // so the live preview embeds them exactly as the exported PDF will.
  const loadAssetsFor = useCallback(async (inv: Invoice): Promise<Record<string, string>> => {
    const refs = [inv.sender.logoRef, inv.client.logoRef, inv.signature?.signatureRef]
      .filter((r): r is string => Boolean(r));
    const map: Record<string, string> = {};
    for (const ref of refs) {
      const a = await window.api.invoices.getAsset(ref);
      if (a) map[ref] = a.dataUrl;
    }
    return map;
  }, []);

  async function newInvoice(): Promise<void> {
    const number = await window.api.invoices.nextNumber();
    setAssets({});
    setInvoice(seedInvoice(number));
  }

  async function openInvoice(inv: Invoice): Promise<void> {
    setInvoice(inv);
    setAssets(await loadAssetsFor(inv));
  }

  async function duplicate(id: string): Promise<void> {
    const dup = await window.api.invoices.duplicate(id);
    await refresh();
    await openInvoice(dup);
  }

  async function remove(id: string): Promise<void> {
    await window.api.invoices.remove(id);
    if (invoice?.id === id) { setInvoice(null); setAssets({}); }
    await refresh();
  }

  async function save(): Promise<void> {
    if (!invoice) return;
    setBusy(true);
    try {
      const saved = await window.api.invoices.save({ ...invoice, updatedAt: nowIso() });
      setInvoice(saved);
      await refresh();
      toast.success(`Saved invoice ${saved.number}`);
    } finally { setBusy(false); }
  }

  async function exportPdf(): Promise<void> {
    if (!invoice) return;
    setBusy(true);
    try {
      const resolved = await loadAssetsFor(invoice);
      const filename = await window.api.invoices.exportPdf(renderInvoiceHtml(invoice, resolved));
      if (filename) toast.success(`Exported ${filename}`);
    } finally { setBusy(false); }
  }

  async function exportDocx(): Promise<void> {
    if (!invoice) return;
    setBusy(true);
    try {
      const resolved = await loadAssetsFor(invoice);
      const filename = await window.api.invoices.exportDocx({ invoice, assets: resolved });
      if (filename) toast.success(`Exported ${filename}`);
    } finally { setBusy(false); }
  }

  async function uploadLogo(which: 'sender' | 'client', file: File): Promise<void> {
    if (!invoice) return;
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const ref = await window.api.invoices.putAsset(bytes, mime);
    const a = await window.api.invoices.getAsset(ref);
    if (a) setAssets((prev) => ({ ...prev, [ref]: a.dataUrl }));
    setInvoice((prev) => (prev ? { ...prev, [which]: { ...prev[which], logoRef: ref } } : prev));
  }

  // Signature capture (draw or upload) arrives as a data URL. Mirror the logo path: decode to bytes,
  // persist as an encrypted asset via putAsset, cache the resolved data URL, and stamp
  // signature.signatureRef + signedDate so the captured image flows into the preview and the PDF.
  async function captureSignature(dataUrl: string): Promise<void> {
    if (!invoice) return;
    const m = /^data:([^;,]+)[^,]*?(;base64)?,([\s\S]*)$/.exec(dataUrl);
    if (!m) return;
    const mime = m[1] === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const bytes = Array.from(bin, (ch) => ch.charCodeAt(0));
    const ref = await window.api.invoices.putAsset(bytes, mime);
    const a = await window.api.invoices.getAsset(ref);
    if (a) setAssets((prev) => ({ ...prev, [ref]: a.dataUrl }));
    setInvoice((prev) => (prev ? { ...prev, signature: { ...prev.signature, signatureRef: ref, signedDate: prev.issueDate } } : prev));
  }

  return (
    <div className="ga98-invoices">
      <div className="ga98-invoices-list">
        <div className="ga98-invoices-toolbar">
          <button onClick={() => { void newInvoice(); }}>New invoice</button>
        </div>
        <ul>
          {list.map((inv) => (
            <li key={inv.id} className={invoice?.id === inv.id ? 'selected' : undefined}>
              <button className="ga98-invoices-open" onClick={() => { void openInvoice(inv); }}>
                #{inv.number} — {inv.client.name || inv.client.company || 'Untitled'}
              </button>
              <button aria-label="Duplicate invoice" onClick={() => { void duplicate(inv.id); }}>⧉</button>
              <button aria-label="Delete invoice" onClick={() => { void remove(inv.id); }}>✕</button>
            </li>
          ))}
          {list.length === 0 ? <li className="ga98-invoices-empty">No invoices yet.</li> : null}
        </ul>
      </div>

      <div className="ga98-invoices-editor">
        {invoice ? (
          <>
            <div className="ga98-invoices-actions">
              <button disabled={busy} onClick={() => { void save(); }}>Save</button>
              <button disabled={busy} onClick={() => { void exportPdf(); }}>Export PDF</button>
              <button disabled={busy} onClick={() => { void exportDocx(); }}>Export DOCX</button>
            </div>
            <InvoiceForm
              invoice={invoice}
              assets={assets}
              onChange={setInvoice}
              onUploadLogo={(which, file) => { void uploadLogo(which, file); }}
              onCaptureSignature={(dataUrl) => { void captureSignature(dataUrl); }}
            />
          </>
        ) : (
          <div className="ga98-invoices-placeholder">Select an invoice or create a new one.</div>
        )}
      </div>
    </div>
  );
}
