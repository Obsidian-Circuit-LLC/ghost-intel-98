/** Renders invoice HTML to a PDF buffer via the same offscreen printToPDF helper the case/INTELREPORT
 *  exports use (fully offline, sandboxed, no JS/node in the render window). `htmlToPdf` in
 *  services/export.ts is already the shared, generic HTML→PDF helper — no wrapper needed there. */
import { htmlToPdf } from '../services/export';

export async function renderInvoicePdf(html: string): Promise<Buffer> {
  return htmlToPdf(html);
}
