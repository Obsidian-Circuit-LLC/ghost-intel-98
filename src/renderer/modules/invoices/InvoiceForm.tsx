/** Invoice editor + live preview. Identity blocks (sender/client name/company + logo upload), the
 *  currency/rate/tax controls, the editable <LineItemTable>, a live totals block, optional notes, and
 *  a <SignaturePad>; a bordered pane shows the exact printable HTML (preview == PDF output). Purely
 *  presentational — every edit emits a fresh Invoice up via onChange; the parent owns persistence.
 *  renderInvoiceHtml is HTML-escaped by construction, so dangerouslySetInnerHTML here is safe. */
import type { Invoice, Party } from '@shared/invoice-types';
import { LineItemTable } from './LineItemTable';
import { SignaturePad } from './SignaturePad';
import { computeTotals, formatMoney } from './calc';
import { renderInvoiceHtml } from './invoice-html';

const CURRENCIES = ['USD', 'GBP', 'EUR', 'CAD', 'AUD', 'JPY'];

export function InvoiceForm(
  { invoice, assets, onChange, onUploadLogo, onCaptureSignature }:
  { invoice: Invoice; assets: Record<string, string>; onChange: (inv: Invoice) => void; onUploadLogo: (which: 'sender' | 'client', file: File) => void; onCaptureSignature: (dataUrl: string, mime: 'image/png' | 'image/jpeg') => void }
): JSX.Element {
  const t = computeTotals(invoice.lines, invoice.rate, invoice.taxPct);
  const setParty = (which: 'sender' | 'client', patch: Partial<Party>): void =>
    onChange({ ...invoice, [which]: { ...invoice[which], ...patch } });

  const partyBlock = (which: 'sender' | 'client', label: string): JSX.Element => {
    const p = invoice[which];
    return (
      <fieldset className="ga98-invoice-party">
        <legend>{label}</legend>
        <label className="field-row">Name
          <input className="ga98-text" aria-label={`${label} name`} value={p.name}
            onChange={(e) => setParty(which, { name: e.target.value })} />
        </label>
        <label className="field-row">Company
          <input className="ga98-text" aria-label={`${label} company`} value={p.company}
            onChange={(e) => setParty(which, { company: e.target.value })} />
        </label>
        <label className="field-row">Logo
          <input type="file" accept="image/png,image/jpeg" aria-label={`Upload ${label} logo`}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadLogo(which, f); }} />
        </label>
        <div className="ga98-invoice-logo-box">
          {p.logoRef && assets[p.logoRef]
            ? <>
                <img src={assets[p.logoRef]} alt={`${label} logo`} className="ga98-invoice-logo-img" />
                <button type="button" aria-label={`Remove ${label} logo`} className="ga98-invoice-img-remove"
                  onClick={() => setParty(which, { logoRef: undefined })}>✕</button>
              </>
            : <span className="ga98-invoice-logo-empty">No logo</span>}
        </div>
      </fieldset>
    );
  };

  return (
    <div className="ga98-invoice-form">
      <div className="ga98-invoice-parties">
        {partyBlock('sender', 'From')}
        {partyBlock('client', 'To')}
      </div>

      <div className="field-row ga98-invoice-meta">
        <label className="field-row">Number
          <input className="ga98-text" aria-label="Number" value={invoice.number}
            onChange={(e) => onChange({ ...invoice, number: e.target.value })} />
        </label>
        <label className="field-row">Issue date
          <input type="date" className="ga98-text" aria-label="Issue date" value={invoice.issueDate}
            onChange={(e) => onChange({ ...invoice, issueDate: e.target.value })} />
        </label>
        <label className="field-row">Currency
          <select className="ga98-text" aria-label="Currency" value={invoice.currency}
            onChange={(e) => onChange({ ...invoice, currency: e.target.value })}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="field-row">Rate
          <input type="number" className="ga98-text" aria-label="Rate" value={invoice.rate}
            onChange={(e) => onChange({ ...invoice, rate: Number(e.target.value) })} />
        </label>
        <label className="field-row">Tax %
          <input type="number" className="ga98-text" aria-label="Tax %" value={invoice.taxPct ?? ''}
            onChange={(e) => onChange({ ...invoice, taxPct: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </label>
      </div>

      <LineItemTable lines={invoice.lines} rate={invoice.rate} currency={invoice.currency}
        onChange={(lines) => onChange({ ...invoice, lines })} />

      <div className="ga98-invoice-totals">
        <div>Total hours: {t.totalHours}</div>
        <div>Subtotal: {formatMoney(t.subtotal, invoice.currency)}</div>
        {invoice.taxPct ? <div>Tax: {formatMoney(t.tax, invoice.currency)}</div> : null}
        <div><b>Total: {formatMoney(t.total, invoice.currency)}</b></div>
      </div>

      <label className="field-row">Notes
        <textarea className="ga98-text" aria-label="Notes" value={invoice.notes ?? ''}
          onChange={(e) => onChange({ ...invoice, notes: e.target.value })} />
      </label>

      <div className="ga98-invoice-signature">
        <div>Signer name
          <input className="ga98-text" aria-label="Signer name" value={invoice.signature?.signerName ?? ''}
            onChange={(e) => onChange({ ...invoice, signature: { ...invoice.signature, signerName: e.target.value } })} />
        </div>
        <div className="ga98-invoice-sig-box">
          {invoice.signature?.signatureRef && assets[invoice.signature.signatureRef]
            ? <>
                <img src={assets[invoice.signature.signatureRef]} alt="Signature" className="ga98-invoice-sig-img" />
                <button type="button" aria-label="Remove signature" className="ga98-invoice-img-remove"
                  onClick={() => onChange({ ...invoice, signature: { ...invoice.signature, signatureRef: undefined } })}>✕ Remove signature</button>
              </>
            : <span className="ga98-invoice-logo-empty">No signature</span>}
        </div>
        <SignaturePad onCapture={(dataUrl, mime) => {
          // Hand the captured image up to the host, which encrypts it via putAsset, caches the data URL,
          // and stamps signature.signatureRef + signedDate so it flows into the preview and the PDF.
          onCaptureSignature(dataUrl, mime);
        }} />
      </div>

      <div className="ga98-invoice-preview" dangerouslySetInnerHTML={{ __html: renderInvoiceHtml(invoice, assets) }} />
    </div>
  );
}
