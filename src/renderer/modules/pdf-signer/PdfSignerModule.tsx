/** PdfSignerModule — offline PDF signing: pick a `.pdf`, draw/upload a signature via the shared
 *  `SignaturePad`, drag/resize it onto a rendered page, then save a signed copy. Rendering (the
 *  shared `PdfPage`, pdf.js) and the overlay's normalized placement math (`placement.ts`) are pure
 *  and independently tested (T4/T5); this module just wires them to the `pdfsign` IPC surface (T3,
 *  main-side pdf-lib `signPdf`) and the OS save dialog.
 *
 *  The source PDF is read TRANSIENTLY via `pdfsign:read` — capped at `MAX_PDF_SIGN_BYTES` main-side
 *  — and never written to the vault; only the signed copy the operator names in the save dialog
 *  ever hits disk. The signature image is capped/validated main-side too (`ensureAssetInput`, via
 *  `parseSignatureDataUrl`), so an oversize/malformed data URL is rejected before `signPdf` runs.
 */
import { useState } from 'react';
import { PdfPage, type PdfPageInfo } from './pdf-page';
import { toNormalized, fromNormalized, type NormalizedPlacement } from './placement';
import { SignaturePad, scaleToBitmap } from '../invoices/SignaturePad';
import { toast } from '../../state/toasts';

/** Sane starting spot for a freshly-captured signature: lower-left-ish, a fifth of the page wide.
 *  The operator drags/resizes from here — nothing here is load-bearing beyond "on the page". */
const DEFAULT_PLACEMENT: NormalizedPlacement = { xFrac: 0.1, yFrac: 0.82, wFrac: 0.22 };

export function PdfSignerModule(): JSX.Element {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [sourceName, setSourceName] = useState<string | undefined>(undefined);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [pageInfo, setPageInfo] = useState<PdfPageInfo | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [placement, setPlacement] = useState<NormalizedPlacement>(DEFAULT_PLACEMENT);
  const [busy, setBusy] = useState(false);

  async function openPdf(): Promise<void> {
    try {
      const paths = await window.api.files.pickOpen({ filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      const path = paths[0];
      if (!path) return;
      const bytes = await window.api.pdfsign.read(path);
      setPdfBytes(bytes);
      setSourceName(path.split(/[\\/]/).pop());
      setPageIndex(0);
      setPageInfo(null);
      setPlacement(DEFAULT_PLACEMENT);
    } catch (err) {
      toast.error(`Could not open PDF: ${(err as Error).message}`);
    }
  }

  function onPageLoaded(info: PdfPageInfo): void {
    setPageInfo(info);
    setPageCount(info.pageCount);
  }

  function onSignatureCapture(dataUrl: string): void {
    setSignatureDataUrl(dataUrl);
  }

  // Drag the overlay: the pointer's client coords are mapped into the rendered PAGE CANVAS's own
  // bitmap space via `scaleToBitmap` (the same helper SignaturePad uses for its own canvas), so the
  // stored fractions always track the canvas the operator sees, not whatever CSS size stretched it.
  function startDrag(e: React.PointerEvent<HTMLImageElement>): void {
    e.preventDefault();
    const canvas = e.currentTarget.parentElement?.querySelector('canvas');
    if (!canvas || !pageInfo) return;
    const rect = canvas.getBoundingClientRect();
    const start = scaleToBitmap(e.clientX, e.clientY, rect, pageInfo.viewportWidth, pageInfo.viewportHeight);
    const origin = fromNormalized(placement, pageInfo.viewportWidth, pageInfo.viewportHeight);
    const dx = start.x - origin.left;
    const dy = start.y - origin.top;

    function onMove(ev: PointerEvent): void {
      const p = scaleToBitmap(ev.clientX, ev.clientY, rect, pageInfo!.viewportWidth, pageInfo!.viewportHeight);
      const next = toNormalized(
        { left: p.x - dx, top: p.y - dy, width: origin.width, height: 0 },
        pageInfo!.viewportWidth,
        pageInfo!.viewportHeight
      );
      setPlacement((prev) => ({ ...next, wFrac: prev.wFrac }));
    }
    function onUp(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Resize from the bottom-right handle — width tracks the pointer's x relative to the overlay's
  // (fixed) left edge; aspect ratio is left to the <img>'s natural width/height (never stored here,
  // matching placement.ts's design — see its module doc).
  function startResize(e: React.PointerEvent<HTMLSpanElement>): void {
    e.preventDefault();
    e.stopPropagation();
    const canvas = e.currentTarget.parentElement?.querySelector('canvas');
    if (!canvas || !pageInfo) return;
    const rect = canvas.getBoundingClientRect();
    const origin = fromNormalized(placement, pageInfo.viewportWidth, pageInfo.viewportHeight);

    function onMove(ev: PointerEvent): void {
      const p = scaleToBitmap(ev.clientX, ev.clientY, rect, pageInfo!.viewportWidth, pageInfo!.viewportHeight);
      const width = Math.max(1, p.x - origin.left);
      const next = toNormalized({ left: origin.left, top: origin.top, width, height: 0 }, pageInfo!.viewportWidth, pageInfo!.viewportHeight);
      setPlacement((prev) => ({ ...prev, wFrac: next.wFrac }));
    }
    function onUp(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  async function signAndSave(): Promise<void> {
    if (!pdfBytes || !signatureDataUrl || busy) return;
    setBusy(true);
    try {
      const result = await window.api.pdfsign.sign({
        pdfBytes,
        signatureDataUrl,
        placement: { page: pageIndex, xFrac: placement.xFrac, yFrac: placement.yFrac, wFrac: placement.wFrac },
        sourceName
      });
      if (result.saved) toast.success('Signed PDF saved.');
    } catch (err) {
      toast.error(`Could not sign PDF: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const overlayPx = pageInfo ? fromNormalized(placement, pageInfo.viewportWidth, pageInfo.viewportHeight) : null;
  const canSign = Boolean(pdfBytes) && Boolean(signatureDataUrl) && !busy;

  return (
    <div className="ga98-pdfsign">
      <div className="ga98-pdfsign-toolbar">
        <button onClick={() => void openPdf()}>Open PDF…</button>
        {pdfBytes && pageCount > 1 ? (
          <span className="ga98-pdfsign-pagenav">
            <button disabled={pageIndex === 0} onClick={() => setPageIndex((n) => Math.max(0, n - 1))}>◀</button>
            <span>Page {pageIndex + 1} / {pageCount}</span>
            <button disabled={pageIndex >= pageCount - 1} onClick={() => setPageIndex((n) => Math.min(pageCount - 1, n + 1))}>▶</button>
          </span>
        ) : null}
        <button disabled={!canSign} onClick={() => void signAndSave()}>Sign &amp; Save</button>
      </div>
      <div className="ga98-pdfsign-body">
        <div className="ga98-pdfsign-stage" style={{ position: 'relative', display: 'inline-block' }}>
          {pdfBytes ? (
            <PdfPage bytes={pdfBytes} pageIndex={pageIndex} scale={1} onLoaded={onPageLoaded} onError={(m) => toast.error(m)} />
          ) : (
            <div className="ga98-pdfsign-empty">Open a PDF to begin.</div>
          )}
          {signatureDataUrl && overlayPx ? (
            <>
              <img
                src={signatureDataUrl}
                alt="Signature placement"
                className="ga98-pdfsign-overlay"
                draggable={false}
                onPointerDown={startDrag}
                style={{
                  position: 'absolute',
                  left: overlayPx.left,
                  top: overlayPx.top,
                  width: overlayPx.width,
                  height: 'auto',
                  cursor: 'move',
                  touchAction: 'none'
                }}
              />
              <span
                className="ga98-pdfsign-overlay-handle"
                role="separator"
                aria-label="Resize signature"
                onPointerDown={startResize}
                style={{
                  // The module ships no stylesheet, so the handle's hit area must be inline —
                  // an empty absolutely-positioned span collapses to 0x0 (invisible, no pointer
                  // target), which makes startResize unreachable. 12x12 matches the app's other
                  // resize grips; straddle the overlay's right edge.
                  position: 'absolute',
                  left: overlayPx.left + overlayPx.width - 6,
                  top: overlayPx.top - 6,
                  width: 12,
                  height: 12,
                  background: '#000',
                  border: '1px solid #fff',
                  boxSizing: 'border-box',
                  cursor: 'nwse-resize',
                  touchAction: 'none'
                }}
              />
            </>
          ) : null}
        </div>
        <div className="ga98-pdfsign-sigpane">
          <SignaturePad onCapture={onSignatureCapture} />
        </div>
      </div>
    </div>
  );
}
