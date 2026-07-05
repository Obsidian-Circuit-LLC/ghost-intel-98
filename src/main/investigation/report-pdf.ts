/**
 * SP-7 INTELREPORT PDF renderer. A thin composition over the pure Win98 HTML builder and the
 * shared, security-hardened offscreen `htmlToPdf` render path in services/export.ts — the same
 * fully-offline printToPDF used for case exports. No LLM, no egress: the report's facts are already
 * assembled and its narrative (if any) already injected upstream; this only paints and prints.
 */
import { htmlToPdf } from '../services/export';
import { buildIntelReportHtml } from './report-html';
import type { IntelReport } from '@shared/investigation-report';

export async function renderIntelReportPdf(report: IntelReport): Promise<Buffer> {
  return htmlToPdf(buildIntelReportHtml(report));
}
